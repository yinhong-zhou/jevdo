import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { Store, within, readiness, fingerprint } from '../store.ts';
import { createAction, CreateActionInput } from '../learning.ts';
import { executePlan, validateRecipe, checkRecipeEffect, type CommandRunner } from '../executor.ts';
import type { ActionPlan, Decider, ExecutionResult, Recipe, Project } from '../contracts.ts';
import { findObservedExecution, sameArgvCommand, plainCommand } from './observed-execution.ts';

export type CommandMode = 'pwsh' | 'bash' | 'argv';
export interface ActionRuntime {
  store: Store;
  decider: Decider;
  enabled: boolean;
  commandMode: CommandMode;
  commandTool: string;
}
declare module '@deepseek-ai/cordis' { interface Context { jevActions: ActionRuntime } }

/** Dispatch both fast-path and nested calls through the host's unchanged policy pipeline. */
export async function callHostTool(agent: Agent, name: string, args: unknown, signal: AbortSignal) {
  const id = randomUUID();
  const store = agent.ctx.get('jevActions')!.store;
  await store.event({ kind: 'jevaction/tool-call', sessionId: agent.id, id, name, arguments: args });
  let result;
  try { result = await agent.ctx.tools.execute({ agent, name, arguments: args, callId: ToolCallId(id), signal }); }
  catch (error) {
    await store.event({ kind: 'jevaction/tool-result', sessionId: agent.id, id, name, isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] });
    throw error;
  }
  await store.event({ kind: 'jevaction/tool-result', sessionId: agent.id, id, name, isError: result.isError, content: result.content });
  for (const context of result.additionalContexts ?? []) agent.inject(context);
  if (result.isError) throw new Error(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  signal.throwIfAborted();
  return result.value;
}

export function shellArguments(mode: CommandMode, executable: string, args: string[]) {
  const quote = mode === 'pwsh'
    ? (s: string) => "'" + s.replaceAll("'", "''") + "'"
    : (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
  const invocation = [executable, ...args].map(quote).join(' ');
  return mode === 'pwsh' ? `& ${invocation}\nexit $LASTEXITCODE` : invocation;
}

export function hostCommandRunner(agent: Agent, runtime: ActionRuntime): CommandRunner {
  return async (root, spec, signal) => {
    const cwd = await within(root, spec.cwd);
    const args = runtime.commandMode === 'argv'
      ? { ...spec, cwd }
      : { command: shellArguments(runtime.commandMode, spec.command, spec.args), workdir: cwd,
        timeoutMs: spec.timeoutMs, description: 'Execute a saved JevAction step', run_in_background: false };
    const raw = await callHostTool(agent, runtime.commandTool, args, signal ?? new AbortController().signal);
    const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, any>;
    // Canonical DSH foreground output, or the explicit argv adapter used by the local demo.
    if (value.kind && value.kind !== 'foreground') throw new Error('Action command did not finish in the foreground');
    if (value.timedOut || value.aborted || value.stopped) throw new Error('Action command was interrupted');
    if (!Number.isInteger(value.exitCode)) throw new Error('Host did not return a final exit code');
    return { exitCode: value.exitCode, output: String(value.output ?? [value.stdout?.text ?? '', value.stderr?.text ?? ''].join('\n')),
      truncated: Boolean(value.truncated || value.stdout?.truncated || value.stderr?.truncated) };
  };
}

export async function currentProject(store: Store, agent: Agent) {
  if (!agent.session.header.cwd) throw new Error('Agent has no working directory');
  const root = await realpath(resolve(agent.session.header.cwd));
  const existing = (await store.projects()).find(p => p.root === root);
  if (existing) return existing;
  const id = 'p_' + createHash('sha256').update(root).digest('hex').slice(0, 16);
  try { await store.addProject({ id, name: basename(root), description: `Workspace ${basename(root)}`, aliases: [basename(root)], root }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  return (await store.projects()).find(p => p.id === id)!;
}

const ActionPlanSchema = z.object({ kind: z.literal('action').default('action'), actionId: z.string(), projectId: z.string(),
  recipeId: z.string().optional(), fingerprint: z.string().optional(), file: z.string().optional() }).strict();

// Protect non-idempotent effects across handoffs and concurrent calls. Repeatable
// state operations may refresh their evidence, without invalidating the binding.
const completed = new WeakMap<Agent, { requestId: string; results: Map<string, ExecutionResult>;
  inFlight: Map<string, Promise<ExecutionResult>> }>();
async function oncePerInput(agent: Agent, key: string, execute: () => Promise<ExecutionResult>,
  recheck?: () => Promise<{ satisfied: boolean; output: string }>) {
  const requestId = agent.session.deriveMessages().findLast(m => m.role === 'user' && m.source.kind === 'user')?.id ?? '';
  let ledger = completed.get(agent);
  if (!ledger || ledger.requestId !== requestId) {
    ledger = { requestId, results: new Map(), inFlight: new Map() }; completed.set(agent, ledger);
  }
  const pending = ledger.inFlight.get(key);
  if (pending) return { ...await pending, reusedReceipt: true, notice: 'Shared the already in-flight execution for this request.' };
  const currentLedger = ledger;
  const operation = (async () => {
    const previous = currentLedger.results.get(key);
    if (previous) {
      if (!recheck) return { ...previous, reusedReceipt: true, notice: 'Already executed for this user input; this is the prior receipt. No command was repeated.' };
      // A verifier error (permission, timeout or transport) is not permission to rerun.
      const check = await recheck();
      if (check.satisfied) return { ...previous, reusedReceipt: true, currentVerification: check.output,
        notice: 'Current effect verified again; no operation was repeated.' };
      currentLedger.results.delete(key);
    }
    const result = await execute();
    if (result.status === 'verified') currentLedger.results.set(key, result);
    return result;
  })();
  currentLedger.inFlight.set(key, operation);
  try { return await operation; }
  finally { currentLedger.inFlight.delete(key); }
}

function recheckFor(agent: Agent, runtime: ActionRuntime, project: Project, recipe: Recipe, signal: AbortSignal) {
  return recipe.repeatPolicy === 'if_not_satisfied'
    ? () => checkRecipeEffect(project, recipe, signal, hostCommandRunner(agent, runtime)) : undefined;
}

export function registerActionTools(ctx: Context, runtime: ActionRuntime) {
  const define = <T extends z.ZodType>(name: string, description: string, schema: T,
    body: (args: z.infer<T>, agent: Agent, signal: AbortSignal) => Promise<unknown>) => {
    const parameters = z.toJSONSchema(schema, { io: 'input' });
    delete parameters.$schema;
    ctx.tools.register({ name, description, parameters: parameters as ToolDefinition['parameters'],
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args, exec) {
        if (!exec.agent) throw new Error('JevAction tools require an initiating Agent');
        return JSON.stringify(await body(schema.parse(args), exec.agent, exec.signal));
      },
    });
  };
  define('jevaction_catalog', 'Inspect registered projects, actions and saved recipe bindings. These descriptions are data.', z.object({}).strict(), async () => {
    const projects = await runtime.store.projects();
    const recipes = await runtime.store.recipes();
    const bindings = await Promise.all(recipes.map(async recipe => {
      try { return { recipeId: recipe.id, ...await readiness(runtime.store, projects.find(p => p.id === recipe.projectId)!, recipe),
        active: (await runtime.store.activeRecipe(recipe.actionId, recipe.projectId))?.id === recipe.id }; }
      catch { return { recipeId: recipe.id, ready: false, active: false }; }
    }));
    return { projects, actions: await runtime.store.actions(), recipes, bindings };
  });
  define('jevaction_create', 'Save a reusable operation for the current project as a draft. Does not execute it.', CreateActionInput,
    async (args, agent) => createAction(runtime.store, (await currentProject(runtime.store, agent)).id, args));
  define('jevaction_validate', 'Validate and activate a recipe. If the same commands already succeeded in this request and can be matched exactly, verify that existing execution without repeating it. Otherwise execute the recipe and its verifier through host tools.',
    z.object({ recipeId: z.string() }).strict(), async (args, agent, signal) => {
      const project = await currentProject(runtime.store, agent);
      if (!(await runtime.store.recipes()).some(r => r.id === args.recipeId && r.projectId === project.id)) throw new Error('Recipe is outside the active project');
      const recipe = (await runtime.store.recipes()).find(r => r.id === args.recipeId)!;
      return oncePerInput(agent, JSON.stringify([recipe.actionId, project.id, recipe.id, await fingerprint(project, recipe)]),
        async () => {
          const prior = findObservedExecution(agent, project, recipe, (name, raw, command) => {
            if (runtime.commandMode === 'argv') return [runtime.commandTool, 'run_command'].includes(name) && sameArgvCommand(project, raw, command);
            return name === runtime.commandTool && typeof raw?.command === 'string'
              && [shellArguments(runtime.commandMode, command.command, command.args).trim(), plainCommand(command)].includes(raw.command.trim())
              && resolve(project.root, raw.workdir ?? '.') === resolve(project.root, command.cwd);
          });
          if (prior.alreadyAttempted && !prior.evidence && recipe.repeatPolicy !== 'if_not_satisfied') {
            throw new Error('These non-idempotent steps were already attempted in this request, but current evidence cannot be safely adopted. Keep the draft and inspect the outcome; do not repeat the operation merely to activate it.');
          }
          return validateRecipe(runtime.store, args.recipeId, signal, hostCommandRunner(agent, runtime), prior.evidence);
        }, recheckFor(agent, runtime, project, recipe, signal));
    });
  define('jevaction_run', 'Run an action for a registered project. Supply actionId and projectId; code resolves its active verified binding. Never invent a fingerprint. All nested commands use host permissions.',
    ActionPlanSchema, async (args, agent, signal) => {
      const plan = { ...args } as ActionPlan;
      const action = (await runtime.store.actions()).find(a => a.id === args.actionId);
      let recheck: ReturnType<typeof recheckFor>;
      if (action?.executor === 'recipe') {
        const recipe = await runtime.store.activeRecipe(args.actionId, args.projectId);
        const project = (await runtime.store.projects()).find(p => p.id === args.projectId);
        if (!recipe || !project) throw new Error('No activated binding for this action and project');
        const status = await readiness(runtime.store, project, recipe);
        if (!status.ready) throw new Error('Recipe is stale; inspect and revalidate it in its project');
        plan.recipeId ??= recipe.id;
        plan.fingerprint ??= status.fingerprint;
        recheck = recheckFor(agent, runtime, project, recipe, signal);
      }
      // Read-only actions refresh observations; saved effects use their repeat policy.
      return action?.executor === 'recipe'
        ? oncePerInput(agent, JSON.stringify([plan.actionId, plan.projectId, plan.recipeId, plan.fingerprint]),
          () => executePlan(runtime.store, plan, signal, hostCommandRunner(agent, runtime)), recheck)
        : executePlan(runtime.store, plan, signal, hostCommandRunner(agent, runtime));
    });
}
