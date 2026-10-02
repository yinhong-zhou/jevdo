/** Cumulative reuse pilot. Reuses existing cold rollouts; never resets the shared paid budget. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, cp, rm, access } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadConfig } from '../src/config.ts';
import { Store, readiness } from '../src/store.ts';
import { createHost, runTurn } from '../src/dsh/host.ts';
import { JevDecider } from '../src/decision.ts';
import { CompatibleChatModel, type ChatModel } from '../src/model.ts';
import { ExperimentBudget } from './subset-budget.ts';
import { TASKS, setupProject, prepareVariant, verifyProject, type Task } from './subset-fixtures.ts';

const oldReports = join(ROOT, 'reports/reuse-subset');
const reports = join(ROOT, 'reports/sequential-subset');
const scratch = join(ROOT, '.runtime/sequential-subset-v1');
const oldScratch = join(ROOT, '.runtime/reuse-subset-v1');
const groups = ['official-clean', 'required', 'autonomous'] as const;
type Group = typeof groups[number];
const previous = JSON.parse(await readFile(join(oldReports, 'results.json'), 'utf8'));
const previousBudget = JSON.parse(await readFile(join(oldReports, 'budget.json'), 'utf8'));
const coldRows: any[] = previous.rows.filter((r: any) => r.phase === 'learning' && !r.excludedForInputBug);
assert.equal(coldRows.length, 6);
const protocol = {
  version: 3, title: 'Fixed-input repeated Action reuse versus a once-measured no-plugin official DSH loop baseline',
  createdAt: new Date().toISOString(), officialBenchmarkScore: false,
  source: '../reuse-subset/protocol.json', sourceTasks: previous.protocol.sourceTasks,
  groups: {
    'official-clean': 'Official DSH loop; no JevAction runtime, Action tools, authoring prompt or Jev. Runs each fixed-input task ONCE from a clean workspace. This single observed reference is compared with all plugin rounds; it is not three independent measurements. Same minimal headless host, adapter and ordinary tools, not the full DSH CLI product.',
    required: 'Jev loop and Action support; the same user prompt explicitly requires saving and validating an Action in every round.',
    autonomous: 'Same Jev loop and Action support; no explicit user save requirement. The plugin authoring prompt is still present.',
  },
  design: { workflows: 3, pluginRounds: 3, baselineRunsPerTask: 1, totalRows: 21, reusedColdRows: 6, newPaidRuns: 15,
    persistence: 'Only plugin groups retain their own scripts and Action store across rounds. No cross-group artifact sharing. Plugin groups do not restore between rounds 2 and 3. The official-clean baseline is measured once per task from scratch.',
    freshSessions: 'Each plugin round creates a new host and empty session. No chat history transfer. Restore identical variant-0 input bytes and delete designated output artifacts only; preserve executable scripts and Action records.',
    initialization: 'Plugin groups restore their original cold snapshots ONCE, at the original paths to preserve fingerprints. The official-clean run begins from README and inputs only, and may create scripts within its one run.',
    inputs: 'Fixed variant 0 in every run. Each group repeats exactly its original cold user prompt. The required-save instruction is the only user-prompt difference between groups. Assert input hashes and verifier targets against the recorded cold trace. No hidden external checker feedback enters model input.',
    order: 'Up to three workflows run concurrently, with isolated workspaces and one shared pre-reservation budget. Within each workflow: one clean baseline, then plugin rounds in order; group order alternates. Reused cold plugin rollouts were recorded earlier, so this is a supplemental pilot, not a simultaneous randomized study.',
    noManualRepairs: true, repeatedSeeds: 1, mainModel: 'deepseek-flash', thinking: 'disabled', temperature: 0,
    maxOutputTokens: 3000, maxSteps: 20, timeoutMs: 240000,
    expectedImprovement: 'Hypothesis to test, never an enforced or guaranteed outcome.',
  },
  success: 'Independent artifact verification AND unmodified inputs AND a completed turn. Correct artifacts at step exhaustion are reported separately.',
  measures: ['Per-round success, latency, main/Jev calls, input/output tokens and conservative cost',
    'Cumulative plugin cost and successes INCLUDING round 1', 'Successful zero-main-model runs', 'Saved and active Actions',
    'A baseline cost multiplied by three, if shown, is an extrapolated reference, not three actual observations or an extra sample count.'],
  cost: { sharedLedger: '../reuse-subset/budget.json', previousUpperCny: previousBudget.upperCny, userLimitCny: 10, stopLimitCny: 9,
    reusedColdCosts: 'Included once in each cumulative curve, not charged a second time to the global ledger.' },
  limitations: ['Three public-spec-derived workflows, small generated inputs; not an official benchmark score.',
    'One rollout per workflow and group; no significance claim.',
    'Exact-repeat reuse only: improvement does not establish robustness to changed inputs or generalization to unseen tasks.',
    'The baseline is sampled once per task to save budget; it does not estimate run-to-run model or timing variance.',
    'Cold plugin rollouts are reused without changing their prompts, recipes or outcomes.',
    'New rollouts run with up to three concurrent workflows; latency includes possible API and machine contention and is descriptive, not a controlled speed benchmark.',
    'The no-plugin control is configured as stateless BETWEEN runs; native DSH can write and reuse persistent files when its workspace is retained. This comparison measures cumulative reusable memory plus routing, not routing alone.',
    'This does not evaluate full native DSH CLI, new-project transfer, or long-term convergence.'],
};
await mkdir(reports, { recursive: true });
if (!process.argv.includes('--live')) {
  await writeFile(join(reports, 'protocol.json'), JSON.stringify(protocol, null, 2));
  console.log(JSON.stringify({ prepared: true, newPaidRuns: 15, liveCalls: 0, previousUpperCny: previousBudget.upperCny }));
  process.exit(0);
}
try { await access(join(reports, 'results.json')); throw new Error('Sequential results already exist; refusing a silent rerun.'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
assert.ok(!previousBudget.stopped && previousBudget.accountedCny < 9);
assert.ok(previousBudget.entries.every((e: any) => e.status !== 'reserved'));
const { options } = await loadConfig();
assert.ok(process.env.DEEPSEEK_API_KEY && options.apiKey, 'Both API keys are required');
assert.equal(new URL(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').hostname, 'api.deepseek.com');
assert.equal(new URL(options.endpoint || 'https://api.typesafe.ai/v1/systemone').hostname, 'api.typesafe.ai');
process.env.DEEPSEEK_MODEL = 'deepseek-flash';
await writeFile(join(oldReports, 'budget-before-sequential.json'), JSON.stringify(previousBudget, null, 2), { flag: 'wx' });
await writeFile(join(reports, 'protocol.json'), JSON.stringify(protocol, null, 2));
const budget = new ExperimentBudget(join(oldReports, 'budget.json'));
budget.entries = previousBudget.entries;
budget.observedDeepseekDebitCny = previousBudget.observedDeepseekDebitCny;
const firstNewEntry = budget.entries.length;
const restoreTransport = budget.installTransport();
const rows: any[] = coldRows.map(r => ({ ...r, group: r.condition, round: 1, inputVariant: 0, reused: true,
  traceFile: `../reuse-subset/${r.traceFile}` }));
const startTime = new Date().toISOString();
async function balance() {
  const response = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Balance check HTTP ${response.status}`);
  const data = await response.json() as any;
  const value = Number(data.balance_infos?.find((b: any) => b.currency === 'CNY')?.total_balance);
  if (!Number.isFinite(value)) throw new Error('Missing CNY balance');
  return value;
}
const startingBalance = await balance();
const previousDebit = budget.observedDeepseekDebitCny;
async function checkpointBalance() {
  const currentBalance = await balance();
  budget.observedDeepseekDebitCny = Math.max(budget.observedDeepseekDebitCny, previousDebit + startingBalance - currentBalance, 0);
  if (budget.accountedCny >= budget.limitCny) budget.stopped = true;
  await budget.save();
}
let pendingResults: Promise<void> = Promise.resolve();
async function saveResults() {
  const snapshot = JSON.stringify({ startTime, updatedAt: new Date().toISOString(), protocol,
    complete: rows.length === 21, stoppedForBudget: budget.stopped, cumulativeBudgetUpperCny: budget.upperCny,
    newPaidUpperCny: budget.entries.slice(firstNewEntry).reduce((s, e) => s + e.upperCny, 0), rows }, null, 2);
  const operation = pendingResults.then(() => writeFile(join(reports, 'results.json'), snapshot));
  pendingResults = operation.catch(() => undefined);
  await operation;
}
async function treeHashes(dir: string, prefix = ''): Promise<Record<string, string>> {
  const entries: [string, string][] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const key = prefix + entry.name;
    if (entry.isDirectory()) entries.push(...Object.entries(await treeHashes(join(dir, entry.name), key + '/')));
    else entries.push([key, createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex')]);
  }
  return Object.fromEntries(entries);
}
async function inputHashes(root: string, task: Task) {
  const files = task === TASKS[0] ? ['reference_date.txt', ...(await readdir(join(root, 'logs'))).map(f => `logs/${f}`)]
    : task === TASKS[1] ? ['data/source_a/users.json', 'data/source_b/users.csv', 'data/source_c/users.parquet'] : ['log.txt'];
  return Object.fromEntries(await Promise.all(files.sort().map(async f => [f, createHash('sha256').update(await readFile(join(root, f))).digest('hex')])));
}
async function library(store: Store) {
  const projects = await store.projects(); const recipes = await store.recipes(); const active: any[] = [];
  for (const recipe of recipes) {
    const project = projects.find(p => p.id === recipe.projectId)!;
    try {
      const current = await store.activeRecipe(recipe.actionId, project.id);
      if (current?.id === recipe.id) active.push({ id: recipe.id, actionId: recipe.actionId, ...(await readiness(store, project, recipe)) });
    } catch { active.push({ id: recipe.id, actionId: recipe.actionId, ready: false }); }
  }
  return { saved: recipes.length, active: active.filter(r => r.ready).length, recipes, activeStates: active };
}
const rootFor = (task: Task, group: Group, variant = 0) => group === 'official-clean' ? join(scratch, `${task}-${group}-round${variant + 1}`) : join(oldScratch, `${task}-${group}`);
async function initialize(task: Task, group: Group, variant = 0) {
  const root = rootFor(task, group, variant);
  if (group === 'official-clean') {
    try { await access(root); throw new Error('Clean control workspace already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await setupProject(join(root, 'workspace'), task, await readFile(join(oldReports, `${task}.instruction.md`), 'utf8'));
    await new Store(join(root, 'store')).addProject({ id: task, name: task, aliases: [task], root: join(root, 'workspace'),
      description: `Current workspace for ${task}; inputs update in batches, output requirements are in README.md.` });
  } else {
    // Only restore once, before round 2. Preserve the previous experiment's final workspace as well.
    for (const leaf of ['workspace', 'store']) {
      const target = resolve(root, leaf), rel = relative(resolve(oldScratch), target);
      assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Restore escaped the prior experiment root');
      await access(join(root, 'cold-snapshot', leaf));
      await cp(target, join(scratch, 'pre-sequential-backup', `${task}-${group}`, leaf), { recursive: true });
      await rm(target, { recursive: true, force: true });
      await cp(join(root, 'cold-snapshot', leaf), target, { recursive: true });
    }
    const cold = rows.find(r => r.task === task && r.group === group && r.round === 1);
    assert.deepEqual(await library(new Store(join(root, 'store'))), cold.afterLibrary, 'Cold Action library changed');
    cold.afterWorkspaceHashes = await treeHashes(join(root, 'workspace'));
    cold.afterStoreHashes = await treeHashes(join(root, 'store'));
  }
}
function promptFor(task: Task, group: Group) {
  const reference = coldRows.find((r: any) => r.task === task && r.condition === (group === 'required' ? 'required' : 'autonomous'));
  assert.ok(reference?.prompt);
  return reference.prompt as string;
}
async function trial(task: Task, group: Group, variant: number) {
  return budget.runTrial(`sequential-${task}-${group}-round${variant + 1}`, () => trialBody(task, group, variant));
}
async function trialBody(task: Task, group: Group, variant: number) {
  // `variant` is the zero-based round index; fixture data stays at variant 0 throughout.
  assert.ok(group !== 'official-clean' || variant === 0, 'The baseline is measured only once per task');
  if (group === 'official-clean') await initialize(task, group, variant);
  const root = rootFor(task, group, variant), cwd = join(root, 'workspace'), home = join(root, 'store');
  const id = `sequential-${task}-${group}-round${variant + 1}`;
  const inheritedWorkspaceHashes = await treeHashes(cwd), inheritedStoreHashes = await treeHashes(home);
  if (variant > 0 && group !== 'official-clean') {
    const last = rows.find(r => r.task === task && r.group === group && r.round === variant);
    assert.deepEqual(inheritedWorkspaceHashes, last.afterWorkspaceHashes, 'Previous round workspace was not retained');
    assert.deepEqual(inheritedStoreHashes, last.afterStoreHashes, 'Previous round Action store was not retained');
  }
  const expected = await prepareVariant(cwd, task, 0), beforeInput = await inputHashes(cwd, task);
  const cold = coldRows.find(r => r.task === task && r.condition === (group === 'required' ? 'required' : 'autonomous'));
  const coldTrace = JSON.parse(await readFile(join(oldReports, cold.traceFile), 'utf8'));
  assert.deepEqual(beforeInput, coldTrace.inputHashes, 'Repeated-task input must be byte-identical to the cold run');
  assert.deepEqual(expected, coldTrace.expected, 'Repeated-task verification targets must not change');
  const store = new Store(home), beforeLibrary = await library(store);
  const arm = group === 'official-clean' ? 'official-clean' : 'jevaction';
  const transport = new CompatibleChatModel({ apiKey: process.env.DEEPSEEK_API_KEY!, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', maxTokens: 3000 });
  const requestAudit: any[] = [];
  const chat: ChatModel = { async complete(messages, tools, signal) {
    const actionTools = tools.filter(t => t.name.startsWith('jevaction_')).map(t => t.name);
    const actionSystemPrompt = messages.some(m => m.role === 'system' && /persistent JevActions|jevaction_create|jevaction_validate/.test(m.content!));
    if (group === 'official-clean') { assert.deepEqual(actionTools, []); assert.equal(actionSystemPrompt, false); }
    requestAudit.push({ actionTools, actionSystemPrompt, toolNames: tools.map(t => t.name) });
    return transport.complete(messages, tools, signal);
  } };
  const host = await createHost({ home, cwd, projectId: task, arm, maxSteps: 20, chat,
    decider: group === 'official-clean' ? { async choose() { throw new Error('Official clean control called Jev'); } }
      : new JevDecider({ ...options, store }) });
  const actionRuntimeInstalled = host.ctx.get('jevActions') !== undefined;
  assert.equal(actionRuntimeInstalled, group !== 'official-clean');
  let result: Awaited<ReturnType<typeof runTurn>> | undefined; let failure: string | undefined;
  const started = Date.now(); const prompt = promptFor(task, group);
  try {
    const handle = await host.create(); result = await runTurn(handle.agent, prompt, 240000);
  } catch (error) { failure = String(error); }
  finally { await host.dispose(); }
  const elapsedMs = result?.elapsedMs ?? Date.now() - started;
  const external = await verifyProject(cwd, expected);
  const inputsUnchanged = JSON.stringify(beforeInput) === JSON.stringify(await inputHashes(cwd, task).catch(() => ({})));
  const afterLibrary = await library(store), entries = budget.entries.filter(e => e.trial === id);
  const learnedIds = new Set([...beforeLibrary.recipes, ...afterLibrary.recipes].map(r => r.actionId));
  const policyActions = result?.actions ?? [], events = result?.events ?? [];
  const actionCalls = policyActions.filter(e => e.kind === 'jevaction/decision' && e.plan?.kind === 'action' && learnedIds.has(e.plan.actionId));
  const main = entries.filter(e => e.service === 'deepseek'), jev = entries.filter(e => e.service === 'jev');
  if (group === 'official-clean') { assert.equal(jev.length, 0); assert.equal(afterLibrary.saved, 0); }
  const row = { id, task, group, round: variant + 1, variant: 0, inputVariant: 0, arm, condition: group, reused: false,
    phase: variant === 0 ? 'learning' : 'warm', prompt,
    success: external.success && inputsUnchanged && result?.outcome?.kind === 'completed', external, inputsUnchanged,
    outcome: result?.outcome, error: failure, elapsedMs, modelCalls: main.length, jevCalls: jev.length,
    mainInputTokens: main.reduce((s, e) => s + (e.inputTokens ?? 0), 0), mainOutputTokens: main.reduce((s, e) => s + (e.outputTokens ?? 0), 0),
    jevInputTokens: jev.reduce((s, e) => s + (e.inputTokens ?? 0), 0), jevOutputTokens: jev.reduce((s, e) => s + (e.outputTokens ?? 0), 0),
    costUpperCny: entries.reduce((s, e) => s + e.upperCny, 0), beforeLibrary, afterLibrary,
    learnedActionSelectionsByJev: actionCalls.map(e => e.plan), actionRuntimeInstalled,
    actionToolCalls: events.filter(e => e.type === 'tool/call' && ['jevaction_create', 'jevaction_validate', 'jevaction_run'].includes(e.data.name)).map(e => e.data),
    afterWorkspaceHashes: await treeHashes(cwd), afterStoreHashes: await treeHashes(home),
    answer: result?.answer, traceFile: `traces/${id}.json` };
  await mkdir(join(reports, 'traces'), { recursive: true });
  await writeFile(join(reports, row.traceFile), JSON.stringify({ ...row, events, policyActions, expected, inputHashes: beforeInput,
    inheritedWorkspaceHashes, inheritedStoreHashes, requestAudit }, null, 2));
  // Preserve each actual final state for independent review; never restore these between rounds.
  for (const leaf of ['workspace', 'store']) await cp(join(root, leaf), join(scratch, 'round-snapshots', id, leaf), { recursive: true });
  rows.push(row); await saveResults(); await checkpointBalance(); await saveResults();
  console.log(JSON.stringify({ id, success: row.success, mainCalls: row.modelCalls, jevCalls: row.jevCalls,
    saved: afterLibrary.saved, active: afterLibrary.active, seconds: +(elapsedMs / 1000).toFixed(2), globalUpperCny: +budget.upperCny.toFixed(4) }));
}
await saveResults();
try {
  const jobs = await Promise.allSettled(TASKS.map(async (task, index) => {
    for (const group of ['required', 'autonomous'] as const) await initialize(task, group);
    if (budget.stopped) return;
    await trial(task, 'official-clean', 0);
    const pluginGroups = ['required', 'autonomous'] as const;
    for (const variant of [1, 2]) for (let n = 0; n < pluginGroups.length; n++) {
      if (budget.stopped) return;
      await trial(task, pluginGroups[(index + variant + n) % pluginGroups.length]!, variant);
    }
  }));
  for (const [index, job] of jobs.entries()) if (job.status === 'rejected') {
    console.error(JSON.stringify({ workflow: TASKS[index], error: String(job.reason) }));
    process.exitCode = 1;
  }
} finally {
  await checkpointBalance().catch(() => undefined); await saveResults(); restoreTransport();
  console.log(JSON.stringify({ complete: rows.length === 21, rows: rows.length, newRuns: rows.filter(r => !r.reused).length,
    globalUpperCny: budget.upperCny, stoppedForBudget: budget.stopped }));
}
