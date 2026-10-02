import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { TASKS } from './subset-fixtures.ts';

const root = join(ROOT, 'reports/sequential-subset');
const results = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
const old = JSON.parse(await readFile(join(ROOT, 'reports/reuse-subset/results.json'), 'utf8'));
const ledger = JSON.parse(await readFile(join(ROOT, 'reports/reuse-subset/budget.json'), 'utf8'));
const rows: any[] = results.rows;
assert.equal(results.complete, true);
assert.equal(rows.length, 21);
assert.equal(rows.filter(r => !r.reused).length, 15);
assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
assert.ok(ledger.entries.every((e: any) => e.status !== 'reserved'));
const traces = new Map<string, any>();
for (const row of rows) {
  const trace = JSON.parse(await readFile(join(root, row.traceFile), 'utf8')); traces.set(row.id, trace);
  const entries = ledger.entries.filter((e: any) => e.trial === row.id);
  assert.equal(entries.filter((e: any) => e.service === 'deepseek').length, row.modelCalls);
  assert.equal(entries.filter((e: any) => e.service === 'jev').length, row.jevCalls);
  assert.ok(Math.abs(entries.reduce((s: number, e: any) => s + e.upperCny, 0) - row.costUpperCny) < 1e-8);
  assert.equal(row.success, row.external.success && row.inputsUnchanged && row.outcome?.kind === 'completed');
  if (row.reused) {
    const original = old.rows.find((r: any) => r.id === row.id);
    for (const key of ['prompt', 'success', 'outcome', 'afterLibrary', 'modelCalls', 'jevCalls', 'costUpperCny']) assert.deepEqual(row[key], original[key]);
  } else {
    assert.equal(row.variant, 0);
    assert.equal(trace.requestAudit.length, row.modelCalls);
  }
  if (row.group === 'official-clean') {
    assert.equal(row.round, 1); assert.equal(row.jevCalls, 0); assert.equal(row.afterLibrary.saved, 0);
    assert.equal(row.actionRuntimeInstalled, false);
    assert.ok(trace.requestAudit.every((q: any) => q.actionTools.length === 0 && q.actionSystemPrompt === false));
  }
}
for (const task of TASKS) {
  const baseline = rows.filter(r => r.task === task && r.group === 'official-clean');
  assert.equal(baseline.length, 1);
  const baseTrace = traces.get(baseline[0].id);
  for (const group of ['required', 'autonomous']) {
    const sequence = rows.filter(r => r.task === task && r.group === group).sort((a, b) => a.round - b.round);
    assert.deepEqual(sequence.map(r => r.round), [1, 2, 3]);
    for (const [index, row] of sequence.entries()) {
      const trace = traces.get(row.id);
      assert.deepEqual(trace.inputHashes, baseTrace.inputHashes, `Input mismatch: ${row.id}`);
      assert.deepEqual(trace.expected, baseTrace.expected, `Verifier mismatch: ${row.id}`);
      assert.equal(row.prompt, sequence[0].prompt, `Prompt changed: ${row.id}`);
      if (index > 0) {
        assert.deepEqual(trace.inheritedWorkspaceHashes, sequence[index - 1].afterWorkspaceHashes);
        assert.deepEqual(trace.inheritedStoreHashes, sequence[index - 1].afterStoreHashes);
        assert.deepEqual(row.beforeLibrary, sequence[index - 1].afterLibrary);
      }
    }
    if (group === 'autonomous') assert.equal(sequence[0].prompt, baseline[0].prompt);
  }
}
const ids = new Set([...old.rows, ...rows].map((r: any) => r.id));
assert.ok(ledger.entries.every((e: any) => ids.has(e.trial)), 'Unattributed paid request');
const uniqueRows = [...new Map([...old.rows, ...rows].map((r: any) => [r.id, r])).values()];
assert.ok(Math.abs(uniqueRows.reduce((s: number, r: any) => s + r.costUpperCny, 0) - ledger.upperCny) < 1e-7);
const secrets = [process.env.DEEPSEEK_API_KEY, process.env.TYPESAFE_API_KEY].filter((v): v is string => Boolean(v && v.length > 12));
assert.equal(secrets.length, 2, 'Load .env for the report credential scan');
let scanned = 0;
async function scan(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await scan(file);
    else { const text = await readFile(file, 'utf8'); assert.ok(!secrets.some(secret => text.includes(secret)), 'Credential found in report'); scanned++; }
  }
}
await scan(root);
const audit = { checkedAt: new Date().toISOString(), validRows: 21, newPaidRuns: 15, reusedColdRows: 6,
  cleanBaselineRuns: 3, sameInputBytes: true, sameVerificationTargets: true, identicalPromptsWithinGroup: true,
  cumulativeStateRetained: true, baselineHasNoActionRuntimeOrPromptOrTools: true, requestAttributionMatches: true,
  everyPaidRequestAccounted: true, credentialScanPassed: true, scannedFiles: scanned };
await writeFile(join(root, 'audit.json'), JSON.stringify(audit, null, 2));
const sum = (rs: any[], key: string) => rs.reduce((s, r) => s + (r[key] ?? 0), 0);
const groups = ['official-clean', 'required', 'autonomous'];
const label = (group: string) => group === 'official-clean' ? '官方 DSH Loop，无插件' : group === 'required' ? 'Jev Loop：要求保存' : 'Jev Loop：自主保存';
const taskLabel = (task: string) => ({ 'log-summary-date-ranges': '日志统计', 'multi-source-data-merger': '数据合并', 'regex-log': '正则提取' })[task];
const aggregate = (rs: any[]) => ({ n: rs.length, success: rs.filter(r => r.success).length,
  artifactSuccess: rs.filter(r => r.external.success && r.inputsUnchanged).length,
  mainCalls: sum(rs, 'modelCalls'), jevCalls: sum(rs, 'jevCalls'), mainTokens: sum(rs, 'mainInputTokens') + sum(rs, 'mainOutputTokens'),
  upperCny: sum(rs, 'costUpperCny'), averageSeconds: sum(rs, 'elapsedMs') / rs.length / 1000,
  zeroMainSuccess: rs.filter(r => r.success && r.modelCalls === 0).length,
  learnedSelections: rs.reduce((s, r) => s + r.learnedActionSelectionsByJev.length, 0) });
const summary: any[] = [];
for (const group of groups) for (const round of group === 'official-clean' ? [1] : [1, 2, 3]) {
  summary.push({ group, round, ...aggregate(rows.filter(r => r.group === group && r.round === round)) });
}
const lines = ['# 固定输入重复执行：无插件基线与 JevAction', '',
  '三个任务使用完全相同的输入与各组固定的用户指令。无插件官方 Loop 每题只测一次；两种 Jev Loop 设置各测三轮。每轮清空会话与指定结果文件，插件组保留执行脚本和 Action，第二轮积累继续传到第三轮。', '',
  '**口径：本实验在相同的最小 DSH 宿主中比较官方 Loop 与我们的插件，未测完整 DSH CLI。任务来自 Terminal-Bench 2.1 公开规格，输入为本地生成的小数据，不是官方基准成绩。**', '',
  '## 各轮结果', '',
  '调用数、token 与费用为三个任务合计，耗时为每题平均。成功要求真实产物正确、输入未被修改且 Agent 正常结束；达到步骤上限，即使产物正确也不计完整成功。', '',
  '| 组别 | 轮次 | 完成且正确 | 产物正确 | 主模型调用 | Jev 调用 | 主模型 token | 成功且零主模型 | 平均秒数 | 费用上界／元 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
for (const s of summary) lines.push(`| ${label(s.group)} | ${s.group === 'official-clean' ? '基线一次' : s.round} | ${s.success}/${s.n} | ${s.artifactSuccess}/${s.n} | ${s.mainCalls} | ${s.jevCalls} | ${s.mainTokens} | ${s.zeroMainSuccess}/${s.n} | ${s.averageSeconds.toFixed(2)} | ${s.upperCny.toFixed(4)} |`);
const warm = rows.filter(r => !r.reused && r.group !== 'official-clean');
const decisions = warm.flatMap(r => traces.get(r.id).policyActions.filter((e: any) => e.kind === 'jevaction/decision'));
const lowConfidence = decisions.filter((e: any) => e.plan?.kind === 'llm' && e.plan.reason === 'Jev confidence below configured threshold').length;
lines.push('', '## 结果解读', '',
  '- 这个子集没有跑出稳定的费用优势。自主保存组主模型调用随轮次下降，但第二、第三轮费用上界仍高于无插件单次基线；要求保存组第三轮费用反而上升。两种插件设置每轮与基线均为 2/3 完整成功。',
  `- 后两轮共 ${decisions.length} 次循环决策中，${lowConfidence} 次因配置的置信度阈值而回退主模型。已经保存 Action 不等于 Jev 会直接选择它。`,
  `- 后两轮共选择已学习 Action ${warm.reduce((s, r) => s + r.learnedActionSelectionsByJev.length, 0)} 次，都是自主保存组的数据合并任务。两次均执行并通过自检，但后续结束判定回退主模型，每次仍有 6 次主模型请求。全部后续运行中，零主模型且成功的次数为 ${warm.filter(r => r.success && r.modelCalls === 0).length}/${warm.length}。`,
  '- 日志任务多次由主模型自己调用 Action 或脚本完成；这表明工具/脚本复用有效，但未证明 Jev 自动调度产生了收益。',
  '- 正则任务在各组和各轮均未完整成功，两个插件组始终没有激活可复用 Action。累积已有失败过程没有在本次三轮内解决这个任务。',
  '- 当前最明确的问题在于 Action 匹配与执行后的结束判定。未根据本轮结果改提示、降阈值或重跑；关于修复收益的判断应留给新的独立实验。');
lines.push('', '## 包含首次学习的累计成本', '', '| 保存条件 | 前一轮 | 前两轮 | 前三轮 | 三轮完整成功 |', '|---|---:|---:|---:|---:|');
for (const group of ['required', 'autonomous']) {
  const gs = rows.filter(r => r.group === group);
  lines.push(`| ${label(group)} | ${sum(gs.filter(r => r.round <= 1), 'costUpperCny').toFixed(4)} | ${sum(gs.filter(r => r.round <= 2), 'costUpperCny').toFixed(4)} | ${sum(gs, 'costUpperCny').toFixed(4)} | ${gs.filter(r => r.success).length}/9 |`);
}
const baseline = summary[0];
lines.push('', `原生基线只实测一次，费用上界 ${baseline.upperCny.toFixed(4)} 元。按同样单次费用重复三次的**外推参照**为 ${(baseline.upperCny * 3).toFixed(4)} 元，不能算作三次实测或用来声称统计显著。`, '',
  '## 逐任务结果', '', '| 任务 | 组别 | 轮次 | 完整成功 | 产物正确 | 主模型 / Jev | 秒数 | Jev 选择已学习 Action | 保存 / 激活 |', '|---|---|---:|---|---|---:|---:|---:|---:|');
for (const task of TASKS) for (const group of groups) for (const r of rows.filter(r => r.task === task && r.group === group).sort((a,b)=>a.round-b.round)) {
  lines.push(`| ${taskLabel(task)} | ${label(group)} | ${r.round} | ${r.success ? '是' : '否'} | ${r.external.success && r.inputsUnchanged ? '是' : '否'} | ${r.modelCalls} / ${r.jevCalls} | ${(r.elapsedMs / 1000).toFixed(2)} | ${r.learnedActionSelectionsByJev.length} | ${r.afterLibrary.saved} / ${r.afterLibrary.active} |`);
}
lines.push('', '## 范围与费用', '',
  '- 同样的模型 deepseek-flash，关闭 thinking，temperature=0，每个请求最多 3000 输出 token，每题最多 20 步。Jev 为 jev-latest。没有人工预置 Action，也没有根据结果改写脚本或提示。',
  '- 两个插件组都获得 Action 保存机制的系统说明。“自主保存”仅表示用户没有明确要求保存；要求保存组每轮重复相同的额外保存要求。',
  '- 六次首次学习沿用此前实测结果。新增十五次运行按三个独立工作流并发，同一组内第二轮先于第三轮。并发和不同测试时段会影响耗时，不能将本轮延迟视为严格受控的加速指标。',
  '- 本轮只测完全重复任务的积累效果，不证明变化输入上的泛化或任意任务加速。原生 DSH 本身可以写和复用文件；本轮基线按用户指定从干净工作区测一次。',
  `- 新增运行保守费用上界 **${results.newPaidUpperCny.toFixed(4)} 元**；包含之前全部实验的累计保守上界 **${ledger.upperCny.toFixed(4)} 元**。用户在运行中取消了预算上限，本次技术保护阈值${results.stoppedForBudget ? '已触发，尚有未完成项' : '未触发'}。`,
  '- 费用上界采用主模型输入 2 元／百万、输出 8 元／百万，不计缓存和闲时折扣；Jev 按 0.50 元／百万输入保守估算。不是服务商最终账单。', '',
  '## 核验材料', '',
  '- [运行前固定方案](protocol.json)', '- [结构化结果与连续状态哈希](results.json)', '- [完整性核验](audit.json)',
  '- [共用逐请求账本](../reuse-subset/budget.json)', '- [预算授权更新](user-budget-update.json)',
  '- 各次模型、工具和 Jev 决策轨迹见 traces/；第一次学习的轨迹保存在原实验目录。',
);
await writeFile(join(root, 'REPORT.md'), lines.join('\n') + '\n');
await writeFile(join(root, 'summary.json'), JSON.stringify({ summary, newPaidUpperCny: results.newPaidUpperCny, totalUpperCny: ledger.upperCny, audit }, null, 2));
console.log(JSON.stringify({ summary, newPaidUpperCny: results.newPaidUpperCny, totalUpperCny: ledger.upperCny, audit }, null, 2));
