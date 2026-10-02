import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Store, within, fingerprint, readiness } from './store.ts';
import type { ActionPlan, Command, CommandResult, ExecutionResult, Project, Recipe } from './contracts.ts';

const MAX_OUTPUT = 16000;

export async function runCommand(root: string, spec: Command, signal?: AbortSignal): Promise<CommandResult> {
  signal?.throwIfAborted();
  const cwd = await within(root, spec.cwd);
  return new Promise((resolve, reject) => {
    // Pass argv directly. Shell syntax is only available via an explicitly saved shell executable.
    // Do not forward the host's model credentials to project scripts.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)));
    const child = spawn(spec.command, spec.args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let truncated = false; let timedOut = false; let aborted = false;
    const collect = (data: Buffer) => {
      output += data.toString('utf8');
      if (output.length > MAX_OUTPUT) { output = output.slice(-MAX_OUTPUT); truncated = true; }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    // This executor runs bounded jobs. Managed background services are a separate future adapter.
    const cancel = () => { aborted = true; child.kill(); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, spec.timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    child.on('error', error => { clean(); reject(error); });
    child.on('close', code => {
      clean();
      if (aborted || signal?.aborted) reject(new Error('Execution aborted'));
      else if (timedOut) reject(new Error('Command timed out'));
      else resolve({ exitCode: code, output, truncated });
    });
    if (signal?.aborted) cancel();
  });
}

export async function projectFiles(project: Project, limit = 160) {
  const files: string[] = []; let truncated = false;
  const ignore = new Set(['node_modules', '.git', '.jevaction', '.runtime', 'dist', 'coverage']);
  async function visit(folder: string, depth: number) {
    for (const entry of (await readdir(await within(project.root, folder), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.env') || ignore.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name).replaceAll('\\', '/');
      if (files.length >= limit) { truncated = true; return; }
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory()) {
        if (depth < 3) await visit(path, depth + 1); else truncated = true;
      }
    }
  }
  await visit('.', 0);
  return { files, truncated };
}

export type CommandRunner = typeof runCommand;

export async function checkRecipeEffect(project: Project, recipe: Recipe, signal?: AbortSignal, run: CommandRunner = runCommand) {
  const result = await run(project.root, recipe.verify.command, signal);
  return { satisfied: result.exitCode === 0 && result.output.includes(recipe.verify.contains), output: result.output };
}

async function executeRecipe(project: Project, recipe: Recipe, signal?: AbortSignal, run: CommandRunner = runCommand) {
  const before = await fingerprint(project, recipe);
  const logs: string[] = [];
  for (const command of recipe.steps) {
    const result = await run(project.root, command, signal);
    logs.push(result.output);
    if (result.exitCode !== 0) throw new Error(`Step failed (exit ${result.exitCode}): ${result.output}`);
  }
  const check = await checkRecipeEffect(project, recipe, signal, run);
  if (!check.satisfied) throw new Error(`Verification failed: ${check.output}`);
  if (before !== await fingerprint(project, recipe)) throw new Error('Watched inputs changed during execution; binding needs revalidation');
  return { output: [...logs, check.output].join('\n').slice(-MAX_OUTPUT), fingerprint: before };
}

export async function validateRecipe(store: Store, recipeId: string, signal?: AbortSignal, run: CommandRunner = runCommand): Promise<ExecutionResult> {
  const recipe = (await store.recipes()).find(r => r.id === recipeId);
  if (!recipe) throw new Error('Unknown recipe');
  const project = (await store.projects()).find(p => p.id === recipe.projectId);
  if (!project) throw new Error('Unknown project');
  const start = Date.now(); const id = randomUUID();
  const result = await executeRecipe(project, recipe, signal, run);
  await store.recordReceipt({ recipeId, fingerprint: result.fingerprint, executionId: id, verifiedAt: new Date().toISOString() });
  await store.event({ kind: 'recipe_validated', recipeId, projectId: project.id, executionId: id });
  return { ...result, id, actionId: recipe.actionId, projectId: project.id, status: 'verified', elapsedMs: Date.now() - start };
}

export async function executePlan(store: Store, plan: ActionPlan, signal?: AbortSignal, run: CommandRunner = runCommand): Promise<ExecutionResult> {
  const start = Date.now();
  const base = { id: randomUUID(), actionId: plan.actionId, projectId: plan.projectId };
  let result: ExecutionResult;
  try {
    signal?.throwIfAborted();
    const project = (await store.projects()).find(p => p.id === plan.projectId);
    const action = (await store.actions()).find(a => a.id === plan.actionId);
    if (!project || !action) throw new Error('Unknown project or action');
    let output: string; let digest: string | undefined;
    if (action.executor === 'recipe') {
      const recipe = (await store.recipes()).find(r => r.id === plan.recipeId && r.projectId === project.id && r.actionId === action.id);
      if (!recipe) throw new Error('Recipe does not match selected project/action');
      if ((await store.activeRecipe(action.id, project.id))?.id !== recipe.id) throw new Error('Recipe has been superseded');
      const state = await readiness(store, project, recipe);
      if (!state.ready || state.fingerprint !== plan.fingerprint) throw new Error('Recipe is unverified or stale');
      const execution = await executeRecipe(project, recipe, signal, run);
      output = execution.output; digest = execution.fingerprint;
    } else if (action.executor === 'list') {
      const listing = await projectFiles(project);
      output = JSON.stringify(listing);
    } else {
      const listing = await projectFiles(project);
      if (!plan.file || !listing.files.includes(plan.file)) throw new Error('File is not in the current candidate scope');
      const handle = await open(await within(project.root, plan.file), 'r');
      try {
        const buffer = Buffer.alloc(16001); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        output = JSON.stringify({ file: plan.file, content: buffer.subarray(0, Math.min(bytesRead, 16000)).toString('utf8'), truncated: bytesRead > 16000 });
      } finally { await handle.close(); }
    }
    result = { ...base, status: 'verified', output, elapsedMs: Date.now() - start, ...(digest ? { fingerprint: digest } : {}) };
  } catch (error) {
    if (signal?.aborted) throw error;
    result = { ...base, status: 'failed', output: '', error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - start };
  }
  await store.event({ kind: 'action_executed', ...base, status: result.status, elapsedMs: result.elapsedMs });
  return result;
}
