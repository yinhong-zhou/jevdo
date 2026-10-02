import { mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadConfig } from '../src/config.ts';
import { Store, readiness } from '../src/store.ts';
import { createHost, runTurn, type Arm } from '../src/dsh/host.ts';
import { JevDecider } from '../src/decision.ts';
import { CompatibleChatModel } from '../src/model.ts';
import { ExperimentBudget } from './subset-budget.ts';
import { TASKS, UPSTREAM, REVISION, PYTHON, sourceInstructions, setupProject, prepareVariant, verifyProject, type Task } from './subset-fixtures.ts';

const reports = join(ROOT, 'reports', 'reuse-subset');
const scratch = join(ROOT, '.runtime', 'reuse-subset-v1');
const repairEmptyLog = process.argv.includes('--repair-empty-log');
const conditions = ['required', 'autonomous'] as const;
type Condition = typeof conditions[number];
await mkdir(reports, { recursive: true });
await mkdir(scratch, { recursive: true });
const sources = [];
for (const task of TASKS) {
  const path = join(reports, `${task}.instruction.md`);
  let instruction: string;
  try { instruction = await readFile(path, 'utf8'); }
  catch { instruction = (await sourceInstructions(task)).instruction; await writeFile(path, instruction); }
  sources.push({ task, url: `${UPSTREAM}/blob/${REVISION}/tasks/${task}/instruction.md`,
    sha256: createHash('sha256').update(instruction).digest('hex'), instruction });
}
const licensePath = join(reports, 'UPSTREAM-LICENSE');
try { await readFile(licensePath); } catch {
  const response = await fetch(`https://raw.githubusercontent.com/harbor-framework/terminal-bench-2-1/${REVISION}/LICENSE`);
  if (!response.ok) throw new Error('Cannot retrieve upstream license');
  await writeFile(licensePath, await response.text());
}
const protocol = {
  version: 1, title: 'Public-task-derived Action learning and cross-session reuse pilot',
  officialBenchmarkScore: false, upstream: UPSTREAM, revision: REVISION,
  sourceTasks: sources.map(({ instruction, ...rest }) => rest),
  selection: 'Three portable data-processing workflows chosen before API runs; convenience subset, not a random or representative sample.',
  adaptations: ['Windows workspace paths instead of original container /app paths.',
    'Locally generated small inputs; original benchmark datasets, verifiers and oracle solutions are not used.',
    'Log task reads the reference date from an input file.', 'Regex task additionally runs its pattern on variable logs and writes matches.json.',
    'Merger retains JSON, CSV, Parquet, priority resolution and conflict-report requirements.'],
  design: { workflows: 3, savingConditions: conditions, learningRuns: 6,
    heldoutVariantsPerLearnedSnapshot: 2, routingArms: ['default', 'jevaction'], warmRuns: 24, totalPlannedRuns: 30,
    coldArm: 'jevaction', snapshot: 'Each cold snapshot is restored at identical absolute paths before EVERY warm run. Both arms see identical files, Action records, receipts and authoring prompt.',
    warmMemory: 'Fresh DSH host and empty session; no prior conversations, output artifacts or previous warm improvements carried over.',
    baseline: 'Official DSH Loop WITH the same learned Action tools and library; isolates routing, not total Action vs no-Action benefit.',
    order: 'Learning condition order alternates by workflow; warm routing-arm order alternates by variant/workflow/condition.',
    repeatedSeeds: 1, mainModel: 'deepseek-flash', thinking: 'disabled', temperature: 0, maxOutputTokensPerRequest: 3000,
    maxSteps: { cold: 20, warm: 12 }, timeoutMs: { cold: 240000, warm: 150000 },
    errors: 'All attempts and failures retained. No outcome-driven prompt fixes or reruns. Budget exhaustion is reported.' },
  success: 'External deterministic output checks AND completed turn AND unmodified inputs; independent of the Action self-verifier.',
  actionMeasures: ['Saved recipes', 'Active recipes', 'External cold task success', 'Learned recipe executions on warm tasks', 'Zero-main-model successful warm tasks'],
  cost: { userCeilingCny: 10, stopCeilingCny: 9, inclusion: 'All learning and warm API requests, including failures and retained ambiguous reservations.',
    deepseekRates: 'CNY 2/M input (no cache discount), 8/M output: official peak Flash prices.',
    jevRates: 'Guard uses CNY 0.50/M input, above published USD 0.042/M at conservative USD/CNY=8; output free.',
    caveat: 'Token-based upper estimate, not a Jev invoice. DeepSeek account balance delta is recorded separately; concurrent account use can contaminate that delta.',
    sources: ['https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', 'https://typesafe.ai/blog/introducing-system-one-models-and-jev'] },
  limitations: ['Small synthetic inputs derived from public task specifications, not official Terminal-Bench results.',
    'Within-project workflow reuse; no claim about new-project recipe transfer.', 'Only one learner rollout per condition and workflow.',
    'Local minimal DSH headless host, not full native CLI / Docker benchmark harness.',
    'Both conditions get the existing Action authoring system prompt; autonomous means no explicit USER save requirement.'],
};
if (repairEmptyLog) (protocol as any).dataCorrection = {
  reason: 'Variant 1 of log-summary wrote a zero-event log as one blank line, contradicting the per-line event specification.',
  change: 'Empty logs are now zero-byte files. No prompts, models, learned scripts, Action records or expected counts changed.',
  reruns: 'Only four affected condition × routing pairs are rerun from the same cold snapshots; originals retained and all costs included.',
};
if (!process.argv.includes('--live')) {
  await writeFile(join(reports, 'protocol.json'), JSON.stringify(protocol, null, 2));
  console.log(JSON.stringify({ prepared: true, protocol: join(reports, 'protocol.json'), liveCalls: 0 }));
  process.exit(0);
}
let previousBudget: any;
let previousResults: any;
try {
  previousBudget = JSON.parse(await readFile(join(reports, 'budget.json'), 'utf8'));
  if (previousBudget.entries?.length && !repairEmptyLog) throw new Error('This experiment already made API calls. Refusing to reset its budget or silently rerun.');
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
if (repairEmptyLog) {
  previousResults = JSON.parse(await readFile(join(reports, 'results.json'), 'utf8'));
  if (!previousResults.complete || previousResults.rows.length !== 30 || !previousBudget?.entries?.length)
    throw new Error('Data correction requires the original complete 30-run experiment; repeat corrections are blocked.');
  await writeFile(join(reports, 'results-before-input-correction.json'), JSON.stringify(previousResults, null, 2));
}
await writeFile(join(reports, 'protocol.json'), JSON.stringify(protocol, null, 2));
const { options } = await loadConfig();
if (!process.env.DEEPSEEK_API_KEY || !options.apiKey) throw new Error('Both API keys must be configured');
if (new URL(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').hostname !== 'api.deepseek.com'
  || new URL(options.endpoint || 'https://api.typesafe.ai/v1/systemone').hostname !== 'api.typesafe.ai') throw new Error('Budget applies to the priced official APIs only');
// Override only this process; preserve the user's .env and regular plugin settings.
process.env.DEEPSEEK_MODEL = 'deepseek-flash';
const budget = new ExperimentBudget(join(reports, 'budget.json'));
if (previousBudget) {
  budget.entries = previousBudget.entries;
  budget.observedDeepseekDebitCny = previousBudget.observedDeepseekDebitCny;
  budget.stopped = previousBudget.stopped;
}
await budget.save();
const restoreTransport = budget.installTransport();
const rows: any[] = previousResults?.rows ?? [];
const summaries: any[] = previousResults?.learning ?? [];
const startTime = previousResults?.startTime ?? new Date().toISOString();
if (repairEmptyLog) for (const row of rows) {
  if (row.task === TASKS[0] && row.variant === 1) row.excludedForInputBug = true;
}
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
const startingBalance = await balance(); // Keep absolute balances out of report and terminal.
const previousDebit = budget.observedDeepseekDebitCny;
async function checkpointBalance() {
  budget.observedDeepseekDebitCny = Math.max(budget.observedDeepseekDebitCny, previousDebit + startingBalance - await balance(), 0);
  if (budget.accountedCny >= budget.limitCny) budget.stopped = true;
  await budget.save();
}
async function hashes(root: string, task: Task) {
  const files = task === TASKS[0] ? ['reference_date.txt', ...(await readdir(join(root, 'logs'))).map(f => `logs/${f}`)]
    : task === TASKS[1] ? ['data/source_a/users.json', 'data/source_b/users.csv', 'data/source_c/users.parquet'] : ['log.txt'];
  return Object.fromEntries(await Promise.all(files.sort().map(async f => [f, createHash('sha256').update(await readFile(join(root, f))).digest('hex')])));
}
async function library(store: Store) {
  const projects = await store.projects(); const recipes = await store.recipes();
  const active: any[] = [];
  for (const recipe of recipes) {
    const project = projects.find(p => p.id === recipe.projectId)!;
    try {
      const current = await store.activeRecipe(recipe.actionId, project.id);
      if (current?.id === recipe.id) active.push({ id: recipe.id, actionId: recipe.actionId, ...(await readiness(store, project, recipe)) });
    } catch { active.push({ id: recipe.id, actionId: recipe.actionId, ready: false }); }
  }
  return { saved: recipes.length, active: active.filter(r => r.ready).length, recipes, activeStates: active };
}
async function saveResults() {
  await writeFile(join(reports, 'results.json'), JSON.stringify({ startTime, updated: new Date().toISOString(), protocol,
    complete: rows.filter(r => !r.excludedForInputBug).length === 30, stoppedForBudget: budget.stopped, budgetUpperCny: budget.upperCny,
    observedDeepseekDebitCny: budget.observedDeepseekDebitCny, learning: summaries, rows }, null, 2));
}
async function restoreSnapshot(snapshot: string, root: string) {
  for (const leaf of ['workspace', 'store']) {
    const target = resolve(root, leaf); const rel = relative(resolve(scratch), target);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Snapshot restore escaped experiment root');
    await rm(target, { recursive: true, force: true });
    await cp(join(snapshot, leaf), target, { recursive: true });
  }
}
async function trial(task: Task, condition: Condition, variant: number, arm: Arm, root: string, prompt: string) {
  const id = `${task}-${condition}-${variant === 0 ? 'learn' : `warm${variant}`}-${arm}${repairEmptyLog ? '-inputfix' : ''}`;
  const cwd = join(root, 'workspace'), home = join(root, 'store');
  const expected = await prepareVariant(cwd, task, variant);
  const beforeInput = await hashes(cwd, task);
  budget.trial = id; const before = budget.entries.length;
  const store = new Store(home); const beforeLibrary = await library(store);
  const decider = new JevDecider({ ...options, store });
  const host = await createHost({ home, cwd, projectId: task, arm, decider, maxSteps: variant === 0 ? 20 : 12,
    chat: new CompatibleChatModel({ apiKey: process.env.DEEPSEEK_API_KEY!, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', maxTokens: 3000 }) });
  let result: Awaited<ReturnType<typeof runTurn>> | undefined;
  let failure: string | undefined;
  try {
    const handle = await host.create();
    result = await runTurn(handle.agent, prompt, variant === 0 ? 240000 : 150000);
  } catch (error) { failure = String(error); }
  finally { await host.dispose(); }
  const external = await verifyProject(cwd, expected);
  const afterInput = await hashes(cwd, task).catch(() => ({}));
  const inputsUnchanged = JSON.stringify(beforeInput) === JSON.stringify(afterInput);
  const afterLibrary = await library(store);
  const entries = budget.entries.slice(before);
  const learnedIds = new Set([...beforeLibrary.recipes, ...afterLibrary.recipes].map(r => r.actionId));
  const events = result?.events ?? [];
  const calls = events.filter(e => e.type === 'tool/call').map(e => e.data);
  const policyActions = result?.actions ?? [];
  const actionCalls = policyActions.filter(e => e.kind === 'jevaction/decision' && e.plan?.kind === 'action' && learnedIds.has(e.plan.actionId));
  const row = { id, task, condition, phase: variant === 0 ? 'learning' : 'warm', variant, arm, prompt,
    success: external.success && inputsUnchanged && result?.outcome?.kind === 'completed', external,
    inputsUnchanged, outcome: result?.outcome, error: failure, elapsedMs: result?.elapsedMs,
    modelCalls: entries.filter(e => e.service === 'deepseek').length, jevCalls: entries.filter(e => e.service === 'jev').length,
    mainInputTokens: entries.filter(e => e.service === 'deepseek').reduce((s, e) => s + (e.inputTokens ?? 0), 0),
    mainOutputTokens: entries.filter(e => e.service === 'deepseek').reduce((s, e) => s + (e.outputTokens ?? 0), 0),
    jevInputTokens: entries.filter(e => e.service === 'jev').reduce((s, e) => s + (e.inputTokens ?? 0), 0),
    costUpperCny: entries.reduce((s, e) => s + e.upperCny, 0), beforeLibrary, afterLibrary,
    learnedActionSelectionsByJev: actionCalls.map(e => e.plan),
    actionToolCalls: calls.filter(c => ['jevaction_create', 'jevaction_validate', 'jevaction_run'].includes(c.name)),
    answer: result?.answer, traceFile: `traces/${id}.json` };
  await mkdir(join(reports, 'traces'), { recursive: true });
  await writeFile(join(reports, row.traceFile), JSON.stringify({ ...row, events, policyActions, expected, inputHashes: beforeInput }, null, 2));
  rows.push(row); await checkpointBalance(); await saveResults();
  console.log(JSON.stringify({ id, success: row.success, saved: afterLibrary.saved, active: afterLibrary.active,
    mainCalls: row.modelCalls, jevCalls: row.jevCalls, learnedSelections: actionCalls.length,
    spentUpperCny: Number(budget.upperCny.toFixed(4)), elapsedMs: row.elapsedMs }));
  return row;
}
try {
  if (repairEmptyLog) {
    repair: for (const condition of conditions) {
      const root = join(scratch, `${TASKS[0]}-${condition}`);
      const arms: Arm[] = condition === 'required' ? ['default', 'jevaction'] : ['jevaction', 'default'];
      for (const arm of arms) {
        if (budget.stopped) break repair;
        await restoreSnapshot(join(root, 'cold-snapshot'), root);
        const original = rows.find(r => r.task === TASKS[0] && r.condition === condition && r.variant === 1 && r.arm === arm && r.excludedForInputBug);
        await trial(TASKS[0], condition, 1, arm, root, original.prompt);
      }
    }
  } else outer: for (const [taskIndex, task] of TASKS.entries()) {
    const orderedConditions = taskIndex % 2 ? [...conditions].reverse() : [...conditions];
    for (const [conditionIndex, condition] of orderedConditions.entries()) {
      if (budget.stopped) break outer;
      const root = join(scratch, `${task}-${condition}`), cwd = join(root, 'workspace'), home = join(root, 'store');
      await setupProject(cwd, task, sources.find(s => s.task === task)!.instruction);
      const store = new Store(home);
      await store.addProject({ id: task, name: task, aliases: [task], root: cwd,
        description: `Current workspace for ${task}; inputs update in batches, output requirements are in README.md.` });
      const common = '请阅读 README.md，完成当前批次的数据处理并检查产物正确。输入数据会按批次更新，本次只处理当前文件。请自己实现需要的脚本。';
      const instruction = common + (condition === 'required'
        ? '\n本次必须把适合重复执行的处理流程保存为 JevAction，并执行验证使它激活，供以后的新会话复用。注意验证会执行一次操作，安排好执行顺序。' : '');
      const cold = await trial(task, condition, 0, 'jevaction', root, instruction);
      summaries.push({ task, condition, coldSuccess: cold.success, saved: cold.afterLibrary.saved, active: cold.afterLibrary.active,
        costUpperCny: cold.costUpperCny, mainCalls: cold.modelCalls });
      await saveResults();
      const snapshot = join(root, 'cold-snapshot');
      await mkdir(snapshot, { recursive: true });
      await cp(cwd, join(snapshot, 'workspace'), { recursive: true });
      await cp(home, join(snapshot, 'store'), { recursive: true });
      for (const variant of [1, 2]) {
        const arms: Arm[] = (taskIndex + conditionIndex + variant) % 2 ? ['default', 'jevaction'] : ['jevaction', 'default'];
        for (const arm of arms) {
          if (budget.stopped) break outer;
          await restoreSnapshot(snapshot, root);
          const prompt = variant === 1 ? {
            'log-summary-date-ranges': '日志换成新的一批了，请按当前参考日期重新生成各时间范围的 severity 统计 CSV，并检查结果。',
            'multi-source-data-merger': '三份用户数据更新了，请按原有优先级重新合并，生成 Parquet 和冲突报告，并检查结果。',
            'regex-log': 'log.txt 更新了，请用这个项目的日期提取规则生成新的 matches.json，并检查结果。',
          }[task] : {
            'log-summary-date-ranges': '请处理当前日志批次，依照 reference_date.txt 统计 today、last_7_days、last_30_days、month_to_date 和 total，更新 summary.csv 并校验。',
            'multi-source-data-merger': '请处理当前这批用户资料，按 A 优先于 B 优先于 C 的规则更新 merged_users.parquet 与 conflicts.json，确认输出正确。',
            'regex-log': '请处理目前 log.txt 中的事件行：只保留包含有效 IPv4 地址的行，提取各行最后一个合法日期，更新 matches.json 并校验。',
          }[task];
          await trial(task, condition, variant, arm, root, prompt);
        }
      }
    }
  }
} finally {
  await checkpointBalance().catch(() => undefined); await saveResults(); restoreTransport();
  console.log(JSON.stringify({ finishedRuns: rows.length, validRuns: rows.filter(r => !r.excludedForInputBug).length, plannedValidRuns: 30, stoppedForBudget: budget.stopped,
    upperCny: budget.upperCny, observedDeepseekDebitCny: budget.observedDeepseekDebitCny, results: join(reports, 'results.json') }));
}
