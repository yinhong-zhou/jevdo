import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.ts';
import { CASES } from './developer-fixtures.ts';
import { verifyTurnRequirements } from './developer-requirements.ts';
import { developerReportBody } from './developer-report-body.ts';
const revision = process.argv.find(a => a.startsWith('--revision='))?.slice(11) ?? 'v3';
assert.match(revision, /^v[1-9][0-9]*$/);
const root = join(ROOT, revision === 'v1' ? 'reports/developer-workflows' : `reports/developer-workflows-${revision}`);
const result = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
const budget = JSON.parse(await readFile(join(root, 'budget.json'), 'utf8'));
const rows: any[] = result.rows;
assert.equal(result.complete, true, 'Wait for all scheduled trials, including infrastructure cleanup');
assert.equal(rows.length, result.protocol.design.totalRows);
assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
assert.equal(budget.entries.filter((e: any) => e.status === 'reserved').length, 0);
assert.ok(budget.entries.every((e: any) => rows.some(r => r.id === e.trial)));
for (const [path, hash] of Object.entries(result.protocol.sourceHashes)) {
  assert.equal(createHash('sha256').update(await readFile(join(root, 'source', path))).digest('hex'), hash, 'Experiment source snapshot changed: ' + path);
}
for (const row of rows) {
  const trace = JSON.parse(await readFile(join(root, row.traceFile), 'utf8'));
  const entries = budget.entries.filter((e: any) => e.trial === row.id);
  assert.equal(entries.filter((e: any) => e.service === 'deepseek').length, row.modelCalls);
  assert.equal(entries.filter((e: any) => e.service === 'jev').length, row.jevCalls);
  assert.ok(Math.abs(entries.reduce((s: number,e: any) => s + e.upperCny, 0) - row.costEstimateCny) < 1e-8);
  assert.equal(row.success, row.external.success && (row.requirements?.success ?? true) && row.outcome?.kind === 'completed');
  if (row.requirements) assert.deepEqual(row.requirements, verifyTurnRequirements(row.task, trace, row.beforeLibrary, row.afterLibrary));
  assert.equal(trace.requestAudit.length, row.modelCalls);
  assert.equal(trace.jevPayloads.length, row.jevCalls);
  if (row.group === 'official-clean') {
    assert.equal(row.jevCalls, 0); assert.equal(row.afterLibrary.saved, 0);
    assert.ok(trace.requestAudit.every((r: any) => !r.tools.some((t: any) => t.name.startsWith('jevaction_'))));
  } else assert.ok(trace.jevPayloads.every((p: any) => Array.isArray(p.state.modelInput?.messages)));
}
for (const task of result.protocol.design.normalCases ?? CASES) {
  const baseline = rows.filter(r => r.task === task && r.group === 'official-clean'); assert.equal(baseline.length, 1);
  for (const group of ['required', 'autonomous']) {
    const sequence = rows.filter(r => r.task === task && r.group === group).sort((a,b) => a.round - b.round);
    assert.deepEqual(sequence.map(r => r.round), [1,2,3]);
    for (const row of sequence) {
      assert.equal(row.prompt, sequence[0].prompt);
      for (const key of ['scriptHash', 'sourceHash', 'projectConfig', 'schema']) assert.equal(row.before[key], baseline[0].before[key]);
      if (group === 'autonomous') assert.equal(row.prompt, baseline[0].prompt);
    }
  }
}
for (const group of ['required', 'autonomous']) {
  const sequence = rows.filter(r => r.group === group);
  assert.equal(sequence[0].beforeLibrary.saved, 0);
  for (let i = 1; i < sequence.length; i++) {
    assert.deepEqual(sequence[i].beforeLibrary.recipes, sequence[i-1].afterLibrary.recipes, 'Library was not retained');
    assert.deepEqual(sequence[i].beforeLibrary.actions, sequence[i-1].afterLibrary.actions);
  }
}
assert.ok(Math.abs(rows.reduce((s,r) => s + r.costEstimateCny, 0) - budget.upperCny) < 1e-7);
const secrets = [process.env.TYPESAFE_API_KEY, process.env.DEEPSEEK_API_KEY].filter((x): x is string => Boolean(x && x.length > 12));
assert.equal(secrets.length, 2, 'Load local env for credential scan; never print secrets');
let scannedFiles = 0;
async function scan(path: string) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await scan(file);
    else { const content = await readFile(file, 'utf8'); assert.ok(!secrets.some(secret => content.includes(secret)), 'Credential in report'); scannedFiles++; }
  }
}
await scan(root);
const audit = { checkedAt: new Date().toISOString(), validRows: rows.length, oneBaselinePerTask: true,
  emptyInitialLibraries: true, libraryRetained: true, sameNormalTaskInputsAndPrompts: true, sourceHashesMatch: true,
  cleanBaseline: true, allCallsAndCostsAttributed: true, fullContextPresent: true, credentialScanPassed: true, scannedFiles };
const sum = (rs: any[], key: string) => rs.reduce((s,r) => s + (r[key] ?? 0), 0);
const aggregate = (rs: any[]) => ({ n: rs.length, success: rs.filter(r => r.success).length,
  zeroMainSuccess: rs.filter(r => r.success && !r.modelCalls).length,
  mainCalls: sum(rs, 'modelCalls'), jevCalls: sum(rs, 'jevCalls'), mainTokens: sum(rs, 'mainTokens'), jevTokens: sum(rs, 'jevTokens'),
  seconds: sum(rs, 'elapsedMs') / 1000, cost: sum(rs, 'costEstimateCny'), learnedSelections: rs.reduce((s,r) => s + r.learnedSelections.length, 0) });
const label = (s: string) => ({ 'official-clean': '原生 Loop（无插件）', required: '要求保存', autonomous: '自主保存' })[s] ?? s;
const rounds: any[] = [];
for (const group of ['official-clean', 'required', 'autonomous']) for (const round of group === 'official-clean' ? [1] : [1,2,3]) {
  rounds.push({ group, round, ...aggregate(rows.filter(r => r.group === group && r.round === round && r.phase === 'repeat')) });
}
const failures = rows.filter(r => !r.success);
const fallbackReasons: Record<string, number> = {};
for (const row of rows) for (const d of row.decisions) if (d.plan.kind === 'llm') fallbackReasons[d.plan.reason] = (fallbackReasons[d.plan.reason] ?? 0) + 1;
const summary = { rounds, total: aggregate(rows), failures: failures.map(r => ({ id: r.id, external: r.external, outcome: r.outcome })), fallbackReasons,
  probes: rows.filter(r => r.phase === 'probe').map(r => ({ id: r.id, success: r.success, main: r.modelCalls, jev: r.jevCalls,
    selections: r.learnedSelections.map((p: any) => p.actionId), answer: r.answer, external: r.external })),
  finalLibraries: Object.fromEntries(['required', 'autonomous'].map(g => [g, rows.filter(r => r.group === g).at(-1).afterLibrary])) };
const table = rounds.map(r => `| ${label(r.group)} | ${r.round} | ${r.success}/${r.n} | ${r.zeroMainSuccess}/${r.n} | ${r.mainCalls} | ${r.jevCalls} | ${(r.seconds/r.n).toFixed(2)} | ${r.cost.toFixed(4)} |`).join('\n');
const probes = rows.filter(r => r.phase === 'probe').map(r => `| ${label(r.group)} | ${r.task} | ${r.success ? '通过' : '未通过'} | ${r.modelCalls} | ${r.learnedSelections.map((p: any) => p.actionId).join(' → ') || '无'} |`).join('\n');
const detail = rows.map(r => `| ${r.id} | ${r.success ? '通过' : '未通过'} | ${r.modelCalls} | ${r.jevCalls} | ${r.afterLibrary.saved}/${r.afterLibrary.active} | [轨迹](${r.traceFile}) |`).join('\n');
const text = `# 开发者重复工作流实验\n\n完成 ${rows.length} 次真实 API 任务；独立验收与 turn 完成均满足的有 ${rows.filter(r=>r.success).length} 次。费用按记录费率估算合计 **${budget.upperCny.toFixed(4)} 元**，包含失败与冷启动费用，不是供应商账单。所有历史实验账本保持原样。\n\n## 方法\n\n8 个常见操作：启动前后端、停止、重启后端、测试构建、生成客户端、本地发布、回滚、只补启动前端。无插件官方 DSH Loop 每种任务从干净目录测一次；两个 JevAction 组分别累计三轮，每次新会话、重置初始状态，但保留各自 Action 库。另各测一次混合任务、后端失败、脚本变更，共 65 次。\n\n所有组都获得相同的现成项目脚本与 README；没有人工预置 Action。测的是模型发现并登记已有流程、之后由 Jev 选择复用，不是自动发明脚本。自主保存组也会收到插件的一般沉淀策略，只是用户没有明确要求保存。官方对照使用同一最小 headless 宿主中的原生 Loop，不代表完整原生 CLI。\n\nJev 与主模型共享组装后的完整输入，置信度只记录。普通任务每轮使用相同 prompt 和输入数据；随机端口、进程实例和时间戳会变化。输入哈希、版本、账本及约束见 [方案](protocol.json) 和 [审计](audit.json)。\n\n## 三轮复用\n\n| 组别 | 轮次 | 成功 | 成功且零主模型调用 | 主模型调用总数 | Jev 调用总数 | 平均秒数 | 估算元 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${table}\n\n原生组只实际测了一轮，不应将其重复显示成三个独立样本。并发会影响延迟；零主模型调用只有在整个请求通过独立验收时才计为成功。不可仅因 Action 已保存，就声称其已由 Jev 接管。\n\n## 混合与异常任务\n\n| 组别 | 探针 | 验收 | 主模型调用 | Jev 选择的已学习 Action |\n|---|---|---|---:|---|\n${probes}\n\nstart-and-edit 要求启动服务、新增 average 函数、测试并构建，独立检查函数行为和当前构建内容；用户还要求说明改动，完整回复留在轨迹中供复核。backend-failure 检查失败时前端不启动、配置不被擅改；changed-script 检查实现变化后的行为。探针执行在三轮之后，只测一次，不属于每轮成功率。\n\n## 失败与解释边界\n\n${failures.length ? failures.map(r => '- '+r.id+': '+(r.external.error || JSON.stringify(r.outcome))).join('\n') : '本次没有任务验收失败，但样本很小，不能推断任意真实项目都能成功。'}\n\n选择 LLM 的原因分布、完整 Action 定义和探针回复见 [汇总数据](summary.json)。同一个 Action 可是一条命令，也可包含多个步骤或调用复杂脚本。本次工作区预置的 dev.mjs 提供稳定命令入口，并不意味着所有 Action 都必须是脚本。\n\n这是目的明确的小型工程实验，每格一次采样，且案例之间允许共享学到的操作。它不证明统计显著性、跨项目泛化或长期维护能力；本地发布仅写测试目录。基线不保留跨任务学习，而插件保留库，因此衡量的是累计复用与路由的综合效果。\n\n## 每次运行\n\n| 运行 | 结果 | 主模型 | Jev | 保存/仍有效 | 证据 |\n|---|---|---:|---:|---:|---|\n${detail}\n`;
await writeFile(join(root, 'audit.json'), JSON.stringify(audit, null, 2));
await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2));
await writeFile(join(root, 'REPORT.md'), result.protocol.version >= 2 ? developerReportBody(result, budget, rounds, rows) : text);
console.log(JSON.stringify({ audit, rounds, probes: summary.probes.map((p: any) => ({ id: p.id, success: p.success, main: p.main, selections: p.selections })), total: summary.total }));
