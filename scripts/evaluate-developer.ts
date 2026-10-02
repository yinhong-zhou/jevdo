import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadConfig } from '../src/config.ts';
import { Store, readiness } from '../src/store.ts';
import { JevDecider } from '../src/decision.ts';
import { CompatibleChatModel, type ChatModel } from '../src/model.ts';
import { createHost, runTurn } from '../src/dsh/host.ts';
import { ExperimentBudget } from './subset-budget.ts';
import { CASES, EXTRA_CASES, PROMPTS, createDeveloperProject, cleanupDeveloperProject, prepareDeveloperCase, verifyDeveloperCase, type DeveloperCase } from './developer-fixtures.ts';
import { captureSources } from './capture-sources.ts';
import { verifyTurnRequirements } from './developer-requirements.ts';

const revision = process.argv.find(a => a.startsWith('--revision='))?.slice(11) ?? 'v3';
assert.match(revision, /^v[2-9][0-9]*$/);
const reports = join(ROOT, `reports/developer-workflows-${revision}`);
const scratch = join(ROOT, `.runtime/developer-workflows-${revision}`);
type Group = 'official-clean' | 'required' | 'autonomous';
const TASKS = revision === 'v3' ? ['start-stack','test-build','publish-local','rollback-local'] as const : CASES;
const PROBES: DeveloperCase[] = revision === 'v3'
  ? ['start-and-edit','start-script','start-script-again','test-edit-test','edit-generate-explain','no-save','explain-only','unknown-project']
  : ['start-and-edit', ...EXTRA_CASES, 'backend-failure', 'changed-script'];
const expectedRows = TASKS.length * 7 + PROBES.length * 3;
const sourceFiles = ['src/controller.ts', 'src/decision.ts', 'src/contracts.ts', 'src/dsh/policy.ts', 'src/dsh/runtime.ts',
  'src/vendor/dsh-loop/agent.ts', 'prompts/action-authoring.md', 'benchmarks/developer-workflows/dev.mjs',
  'scripts/developer-fixtures.ts', 'scripts/evaluate-developer.ts', 'scripts/developer-requirements.ts',
  'src/executor.ts', 'src/store.ts', 'src/learning.ts', 'src/tools.ts'];
sourceFiles.push('src/dsh/observed-execution.ts');
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path,
  createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex')])));
const protocol = {
  version: 2, revision, createdAt: new Date().toISOString(), title: 'Active Action authoring, effect refresh and mixed developer handoffs',
  officialBenchmarkScore: false, fixtureSource: 'Locally authored executable developer project; no external benchmark attribution.',
  sourceHashes, groups: {
    'official-clean': 'Unmodified pinned DSH loop in the same minimal headless host, no Action runtime, authoring prompt or Jev; one fresh run per scenario, not a full native CLI benchmark.',
    required: 'JevAction; each normal task prompt explicitly requests saving and validating useful operations. Own empty initial library retained between fresh sessions.',
    autonomous: 'JevAction; no per-task user instruction to save. Plugin policy actively encourages maintaining reusable developer operations, with discretion to skip unsuitable actions and an explicit no-save override. Own empty initial library retained between fresh sessions.',
  },
  design: { normalCases: TASKS, pluginRounds: 3, baselineRounds: 1, probesAfterLearning: PROBES, totalRows: expectedRows,
    freshSessionEveryTask: true, mainModel: 'deepseek-flash', jevModel: 'configured Jev model', temperature: 0,
    thinking: 'disabled', maxOutputTokens: 3000, maxSteps: 24, timeoutMs: 240000, concurrentGroups: 3,
    initialization: 'All arms get identical project scripts and README, not saved Actions. Tests measure discovering, registering and reusing existing commands, not inventing the scripts.',
    persistence: 'Plugin groups each retain their library and project scripts across tasks and rounds. The baseline gets a new project per task. No cross-group sharing or hand-seeded Actions.',
    reset: 'Restore the same source/config/schema, reset local deployment pointer, remove designated test/build/generated artifacts and reset owned services before every task. No previous output or chat history can satisfy the next task.',
    preconditions: 'Stop/restart cases begin with both services running; partial-stack begins with backend running; other normal cases begin stopped. Runtime instance IDs, ports and timestamps necessarily vary.',
    order: 'Each group runs sequentially; three isolated groups run concurrently. Plugin groups run the listed normal cases in the same order for three rounds, then the listed probes once. Cross-case transfer within a round is allowed. start-script and start-script-again share exactly the same prompt and initial service state.',
    probes: 'Mixed code edit; existing full-stack script then repeat; changed input schema; edit schema then generate and explain; test before and after source edit; explicit no-save; explain without executing; unknown target project; backend failure; script implementation change.',
    routing: 'Jev choice is used without a confidence veto. Same full assembled model input is supplied to Jev. Invalid responses, stale binding, execution failure and bounded action sequences can still delegate to the model.',
    noManualRepairs: true, rolloutsPerCell: 1,
  },
  success: 'Independent HTTP/process-instance, event-order, file/content assertions AND completed turn AND explicit task constraints (no-save, existing script use, repeated tests, final main-model explanation for explanatory requests). Explanation checks are presence/keyword proxies, not comprehensive semantic grading. Evaluator targets stay outside the workspace.',
  changesFromV1: 'Active authoring prompt and tool-schema guidance; implementation-only watchedFiles can be empty; repeatPolicy allows safe rechecking and rerunning state operations; stronger Jev DONE criteria. Multiple changes tested together, not an attribution ablation. Fixture adds existing full-stack script and source hashes in test event logs; this is not a bit-identical V1 rerun.',
  changesFromV2: revision === 'v3' ? 'Final model ownership after model participation; adopt exactly matching current-request command evidence at activation instead of replaying side effects; honor explicit named script constraints. Focused regression covers four normal workflows and eight handoff/constraint probes, with a new once-per-task no-plugin baseline. V2 broad results and failures are preserved separately.' : null,
  cost: { userLimitCny: null, authorization: 'User removed the monetary cap; retain usage and cost accounting.',
    ratesCnyPerMillion: { mainInput: 2, mainOutput: 8, jevInput: 0.5 }, note: 'Cost estimates at these recorded rates; not a provider invoice. Unreported usage keeps the pre-request estimate.' },
  limitations: ['Small purpose-built project and one rollout per cell; no general benchmark or significance claim.',
    'Existing scripts make tasks approachable to both arms. The clean baseline can use them directly.',
    'Fresh baseline versus persistent plugin library measures cumulative reuse plus routing; not routing alone.',
    'Concurrent latency includes provider and local contention; not a controlled speed test.',
    'Local publication is reproducible filesystem work, not real production deployment.',
    'No baseline variance estimate, cross-project transfer or long-term library maintenance experiment.'],
};
await mkdir(reports, { recursive: true });
try { await access(join(reports, 'results.json')); throw new Error('Results exist; refusing to overwrite or silently repeat paid trials.'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
await writeFile(join(reports, 'protocol.json'), JSON.stringify(protocol, null, 2));
await captureSources(reports, sourceHashes);
if (!process.argv.includes('--live')) { console.log(JSON.stringify({ prepared: true, paidCalls: 0, plannedRows: expectedRows })); process.exit(0); }
const { options } = await loadConfig();
assert.ok(process.env.DEEPSEEK_API_KEY && options.apiKey, 'Both configured API keys are required');
assert.equal(new URL(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').hostname, 'api.deepseek.com');
assert.equal(new URL(options.endpoint || 'https://api.typesafe.ai/v1/systemone').hostname, 'api.typesafe.ai');
protocol.design.jevModel = options.model ?? 'jev-latest';
await writeFile(join(reports, 'protocol.json'), JSON.stringify(protocol, null, 2));
await mkdir(join(reports, 'traces'), { recursive: true });
const budget = new ExperimentBudget(join(reports, 'budget.json'), null);
const restore = budget.installTransport();
const rows: any[] = [], infrastructureErrors: any[] = [];
const startedAt = new Date().toISOString();
let saving: Promise<void> = Promise.resolve();
async function checkpoint() {
  const snapshot = JSON.stringify({ protocol, startedAt, updatedAt: new Date().toISOString(),
    complete: rows.length === expectedRows && !infrastructureErrors.length, costEstimateCny: budget.upperCny, rows, infrastructureErrors }, null, 2);
  const operation = saving.then(() => writeFile(join(reports, 'results.json'), snapshot));
  saving = operation.catch(() => undefined); await operation;
}
async function library(store: Store) {
  const projects = await store.projects(), recipes = await store.recipes();
  const bindings = await Promise.all(recipes.map(async recipe => {
    const project = projects.find(p => p.id === recipe.projectId)!;
    try { return { recipeId: recipe.id, actionId: recipe.actionId,
      active: (await store.activeRecipe(recipe.actionId, project.id))?.id === recipe.id,
      ...await readiness(store, project, recipe) }; }
    catch { return { recipeId: recipe.id, actionId: recipe.actionId, active: false, ready: false }; }
  }));
  return { saved: recipes.length, active: bindings.filter(b => b.active && b.ready).length,
    actions: (await store.actions()).filter(a => a.executor === 'recipe'), recipes, bindings };
}
async function initialize(root: string) {
  try { await access(root); throw new Error('Expected a fresh experiment workspace: ' + root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await createDeveloperProject(join(root, 'project'));
  await new Store(join(root, 'store')).addProject({ id: 'demo', name: 'Developer demo', aliases: ['this project'],
    root: join(root, 'project'), description: 'The current developer project with documented service, build and local release commands.' });
}
async function trial(root: string, group: Group, task: DeveloperCase, round: number, phase: 'repeat' | 'probe') {
  const id = `${group}-r${round}-${task}`;
  return budget.runTrial(id, async () => {
    const cwd = join(root, 'project'), home = join(root, 'store'), store = new Store(home);
    const before = await prepareDeveloperCase(cwd, task), beforeLibrary = await library(store);
    const prompt = PROMPTS[task] + (group === 'required' && phase === 'repeat'
      ? '\n请将其中值得复用的操作保存为 Action，并在完成本次任务时验证激活；已有的有效操作直接复用。' : '');
    const requestAudit: any[] = [], jevPayloads: unknown[] = [];
    const transport = new CompatibleChatModel({ apiKey: process.env.DEEPSEEK_API_KEY!, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', maxTokens: 3000 });
    const chat: ChatModel = { async complete(messages, tools, signal) {
      if (group === 'official-clean') {
        assert.ok(!tools.some(t => t.name.startsWith('jevaction_')));
        assert.doesNotMatch(JSON.stringify(messages.filter(m => m.role === 'system')), /persistent JevActions|jevaction_create/);
      }
      requestAudit.push({ messages, tools }); return transport.complete(messages, tools, signal);
    } };
    const host = await createHost({ home, cwd, projectId: 'demo', arm: group === 'official-clean' ? 'official-clean' : 'jevaction',
      maxSteps: 24, chat, decider: group === 'official-clean' ? { async choose() { throw new Error('Baseline called Jev'); } }
        : new JevDecider({ ...options, store, onPayload(payload) { jevPayloads.push(payload); } }) });
    let result: Awaited<ReturnType<typeof runTurn>> | undefined, error: string | undefined;
    const started = Date.now();
    try { const handle = await host.create(); result = await runTurn(handle.agent, prompt, 240000); }
    catch (e) { error = String(e); }
    finally { await host.dispose(); }
    const external = await verifyDeveloperCase(cwd, task, before), afterLibrary = await library(store);
    const entries = budget.entries.filter(e => e.trial === id), main = entries.filter(e => e.service === 'deepseek'), jev = entries.filter(e => e.service === 'jev');
    if (group === 'official-clean') { assert.equal(jev.length, 0); assert.equal(afterLibrary.saved, 0); }
    const policy = result?.actions ?? [], events = result?.events ?? [];
    const selected = policy.filter(e => e.kind === 'jevaction/decision' && e.plan?.kind === 'action').map(e => e.plan);
    const learnedIds = new Set(afterLibrary.recipes.map(r => r.actionId));
    const requirements = verifyTurnRequirements(task, result, beforeLibrary, afterLibrary);
    const row = { id, group, task, round, phase, prompt, before, beforeLibrary, afterLibrary, external, requirements,
      success: external.success && requirements.success && result?.outcome?.kind === 'completed', outcome: result?.outcome, error,
      elapsedMs: result?.elapsedMs ?? Date.now() - started, modelCalls: main.length, jevCalls: jev.length,
      mainTokens: main.reduce((s,e) => s + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), 0),
      jevTokens: jev.reduce((s,e) => s + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), 0),
      costEstimateCny: entries.reduce((s,e) => s + e.upperCny, 0),
      selectedActions: selected, learnedSelections: selected.filter(p => learnedIds.has(p.actionId)),
      modelActionToolCalls: events.filter(e => e.type === 'tool/call' && e.data.name.startsWith('jevaction_')).map(e => e.data),
      decisions: policy.filter(e => e.kind === 'jevaction/decision'),
      rawChoices: policy.filter(e => e.kind === 'jev_decision_raw'),
      jevFailures: policy.filter(e => e.kind === 'jev_decision_failed'),
      answer: result?.answer, traceFile: `traces/${id}.json` };
    await writeFile(join(reports, row.traceFile), JSON.stringify({ ...row, events, policy, requestAudit, jevPayloads }, null, 2));
    rows.push(row); await checkpoint();
    console.log(JSON.stringify({ id, success: row.success, main: main.length, jev: jev.length,
      learnedSelections: row.learnedSelections.length, saved: afterLibrary.saved, active: afterLibrary.active,
      seconds: +(row.elapsedMs / 1000).toFixed(1), estimateCny: +row.costEstimateCny.toFixed(4) }));
    await cleanupDeveloperProject(cwd);
  });
}
await checkpoint();
try {
  const runs = await Promise.allSettled((['official-clean', 'required', 'autonomous'] as Group[]).map(async group => {
    const root = join(scratch, group);
    if (group !== 'official-clean') await initialize(root);
    try {
      for (let round = 1; round <= (group === 'official-clean' ? 1 : 3); round++) {
        for (const task of TASKS) {
          const target = group === 'official-clean' ? join(root, task) : root;
          if (group === 'official-clean') await initialize(target);
          await trial(target, group, task, round, 'repeat');
        }
        if (group !== 'official-clean') await cp(join(root, 'store'), join(scratch, 'snapshots', `${group}-r${round}`), { recursive: true });
      }
      for (const task of PROBES) {
        const target = group === 'official-clean' ? join(root, task) : root;
        if (group === 'official-clean') await initialize(target);
        await trial(target, group, task, group === 'official-clean' ? 1 : 4, 'probe');
      }
    } finally { if (group !== 'official-clean') await cleanupDeveloperProject(join(root, 'project')); }
  }));
  runs.forEach((run, i) => { if (run.status === 'rejected') {
    infrastructureErrors.push({ group: ['official-clean', 'required', 'autonomous'][i], error: String(run.reason) }); process.exitCode = 1;
  } });
} finally {
  await budget.save(); await checkpoint(); restore();
  console.log(JSON.stringify({ complete: rows.length === expectedRows, rows: rows.length, costEstimateCny: budget.upperCny, infrastructureErrors }));
}
