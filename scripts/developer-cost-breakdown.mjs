// Offline analysis of existing live records. Does not rerun, drop, or rewrite trials.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = new URL('../reports/developer-workflows-v3/', import.meta.url);
const source = await readFile(new URL('budget.json', root), 'utf8');
const budget = JSON.parse(source);
const rows = JSON.parse(await readFile(new URL('results.json', root), 'utf8')).rows;
const tasks = ['start-stack', 'test-build', 'publish-local', 'rollback-local'];
const titles = ['启动项目', '测试与构建', '本地发布', '本地回滚'];
function cell(group, round, selected) {
  const trials = selected.map(task => `${group}-r${round}-${task}`);
  const runs = trials.map(id => { const row = rows.find(r => r.id === id); assert.ok(row); return row; });
  const entries = budget.entries.filter(e => trials.includes(e.trial));
  assert.ok(entries.every(e => e.status === 'ok'), 'Do not silently ignore failed/unknown usage');
  const cost = entries.reduce((n, e) => n + e.upperCny, 0);
  assert.ok(Math.abs(cost - runs.reduce((n, r) => n + r.costEstimateCny, 0)) < 1e-9);
  const count = service => entries.filter(e => e.service === service).length;
  return { trials, mainCalls: count('deepseek'), jevCalls: count('jev'), estimatedCny: cost,
    meanDurationSeconds: runs.reduce((n, r) => n + r.elapsedMs, 0) / runs.length / 1000,
    success: runs.filter(r => r.success).length, zeroMain: runs.filter(r => r.success && r.modelCalls === 0).length };
}
const perTask = tasks.map((task, i) => ({ task, title: titles[i], baseline: cell('official-clean', 1, [task]),
  rounds: [1, 2, 3].map(r => cell('autonomous', r, [task])) }));
const retained = tasks.slice(0, 3);
const baseline = cell('official-clean', 1, retained);
const rounds = [1, 2, 3].map(r => cell('autonomous', r, retained));
const warmCost = rounds[1].estimatedCny + rounds[2].estimatedCny;
const totalCost = rounds.reduce((n, r) => n + r.estimatedCny, 0);
const savings = cost => 100 * (1 - cost / baseline.estimatedCny);
const summary = { sourceSha256: createHash('sha256').update(source).digest('hex'),
  finalPresentationTasks: retained, excludedTask: { id: 'rollback-local', reason: 'Known Action activation / prior-execution evidence bug', status: 'open', record: '../../docs/KNOWN_ISSUES.md#jevdo-001' },
  scope: 'Post-hoc three-workflow breakdown of the unchanged four-task experiment. Rollback remains in the original aggregate; not an invalidated sample or a new independent run.',
  rates: budget.rates, perTask, baseline, rounds,
  secondRoundSavingsPercent: savings(rounds[1].estimatedCny), thirdRoundSavingsPercent: savings(rounds[2].estimatedCny),
  combinedWarmSavingsPercent: 100 * (1 - warmCost / (2 * baseline.estimatedCny)),
  coldPlusWarmCost: totalCost, baselineThreeTimesExtrapolation: baseline.estimatedCny * 3,
  coldPlusWarmChangePercent: 100 * (totalCost / (3 * baseline.estimatedCny) - 1) };
const money = n => n.toFixed(6), pct = n => n.toFixed(2);
const text = `# 轻量 JevDo V3：费用与首轮调用拆解

当前最终展示采用[三任务结果](FINAL_RESULTS.md)，回滚单列为[待修复问题 JEVDO-001](../../docs/KNOWN_ISSUES.md#jevdo-001)。以下保留完整拆解，便于核对统计范围变化。

本页核对原始请求账本，不运行新实验、不删除回滚、不覆盖原四任务结果。原有 31 → 8 次、减少约 74% 的调用指标保持其四任务范围。

## 为什么首轮主模型净增两次

| 任务 | 原生 DSH | 自主保存第一轮 | 差值 |
|---|---:|---:|---:|
${perTask.map(r => `| ${r.title} | ${r.baseline.mainCalls} | ${r.rounds[0].mainCalls} | ${r.rounds[0].mainCalls - r.baseline.mainCalls} |`).join('\n')}
| 合计 | 31 | 33 | +2 |

测试与构建涉及创建和验证两条 Action；发布任务已经能使用同一轮前面任务积累的操作。第一轮不是每项任务都从独立空库启动。模型请求可并行提出多个工具调用，不能把工具数量直接当作模型请求数量，也不能把净增两次当成固定学习成本。

回滚的首轮轨迹是：先执行 rollback，再写 verify-rollback.mjs、运行它，随后创建并尝试激活 Action。验证工具拒绝安全采用之前的非幂等执行证据，要求保留草稿，避免仅为激活重复回滚。第一轮和第二轮结束时该 Action 都未激活，第三轮才激活。评测重置只清理指定产物，没有删掉该验证脚本；这不是可以据以排除样本的外部故障，而是执行证据采用与 Action 沉淀链路的边界。

证据：[首轮回滚](traces/autonomous-r1-rollback-local.json)、[第三轮回滚](traces/autonomous-r3-rollback-local.json)、[冻结的重置逻辑](source/scripts/developer-fixtures.ts)。

## 同任务、同费率比较

费用包含主模型与 Jev，用原报告固定费率；未纳入主模型缓存折扣。它是估算，不是实际扣款。这里比较费用，单价没有变化。

| 任务 | 原生一次 | 第 1 轮（含积累） | 第 2 轮 | 第 3 轮 |
|---|---:|---:|---:|---:|
${perTask.map(r => `| ${r.title} | ${money(r.baseline.estimatedCny)} | ${r.rounds.map(v => money(v.estimatedCny)).join(' | ')} |`).join('\n')}

## 三项稳定流程子集（事后拆分，非整个系统成绩）

仅统计启动、测试构建、本地发布；从原生与自主保存组同时取相同三项。它们仍运行于原来四任务实验形成的 Action 库，不能冒充一个从未包含回滚的新三任务实验。

| 指标 | 原生一次 | 第 1 轮 | 第 2 轮 | 第 3 轮 |
|---|---:|---:|---:|---:|
| 主模型调用 | ${baseline.mainCalls} | ${rounds.map(r => r.mainCalls).join(' | ')} |
| Jev 调用 | ${baseline.jevCalls} | ${rounds.map(r => r.jevCalls).join(' | ')} |
| 估算费用（元） | ${money(baseline.estimatedCny)} | ${rounds.map(r => money(r.estimatedCny)).join(' | ')} |
| 相对原生费用降低 | — | — | ${pct(summary.secondRoundSavingsPercent)}% | ${pct(summary.thirdRoundSavingsPercent)}% |

后两轮平均每组三项费用为 ${money(warmCost / 2)} 元，相对原生同组三项 ${money(baseline.estimatedCny)} 元，估算费用降低 **${pct(summary.combinedWarmSavingsPercent)}%**。三项后两轮均零主模型调用。分母是原生单次实测费用的等次数外推，不是另外测了两遍原生。

包含首次积累的三轮子集共 ${money(totalCost)} 元；原生单轮乘三的外推参考 ${money(baseline.estimatedCny * 3)} 元，仍高 ${pct(summary.coldPlusWarmChangePercent)}%。因此不能把暖启动降幅写成包含学习成本的三轮整体降幅。

可用表述：**在项目启动、项目测试与构建、本地发布三个常见开发场景中，JevDo 在 Action 积累后的第 2、3 轮均实现零主模型调用；包含 Jev 请求的复用阶段平均估算费用，相比原生 DSH 降低 ${pct(summary.combinedWarmSavingsPercent)}%。**

这是一次采样的事后子集分析。完整四任务报告及回滚开销继续保留；需要预先固定新任务集、重新运行，才能获得新的总体实验结论。

离线复算：\`node scripts/developer-cost-breakdown.mjs\`。数据：[原请求账本](budget.json)、[机器可读拆解](cost-breakdown.json)。
`;
await writeFile(new URL('cost-breakdown.json', root), JSON.stringify(summary, null, 2));
await writeFile(new URL('COST_BREAKDOWN.md', root), text);
const finalReport = `# 最终展示结果：三个常见开发场景

**范围：启动项目、测试与构建、本地发布。** 展示自主保存组；原生 DSH 为同一最小 headless 宿主中不加载插件的官方 Loop。回滚因 Action 激活链路问题从本页汇总中排除，登记为[待修复 bug JEVDO-001](../../docs/KNOWN_ISSUES.md#jevdo-001)。这项排除在观察结果后确定，原始四任务记录保留于 [REPORT.md](REPORT.md)。

本页对已有真实请求重新汇总，没有重新调用模型，也没有将回滚标成无效数据。三项使用原实验形成的 Action 库，不是独立重跑的新三任务实验。所有组使用相同现成脚本；原实验插件库从空开始，每轮新会话、重置任务状态，保留各自 Action 库。原生每项仅实际运行一次。

## 主结果

| 每组三个任务 | 原生 DSH | JevDo 第 1 轮（积累） | 第 2 轮 | 第 3 轮 |
|---|---:|---:|---:|---:|
| 验收成功 | ${baseline.success}/3 | ${rounds.map(r => r.success + '/3').join(' | ')} |
| 主模型调用 | ${baseline.mainCalls} | ${rounds.map(r => r.mainCalls).join(' | ')} |
| 无需主模型的任务 | ${baseline.zeroMain}/3 | ${rounds.map(r => r.zeroMain + '/3').join(' | ')} |
| Jev 调用 | ${baseline.jevCalls} | ${rounds.map(r => r.jevCalls).join(' | ')} |
| 平均耗时 | ${baseline.meanDurationSeconds.toFixed(2)} 秒 | ${rounds.map(r => r.meanDurationSeconds.toFixed(2) + ' 秒').join(' | ')} |
| 估算费用（含 Jev） | ¥${money(baseline.estimatedCny)} | ${rounds.map(r => '¥' + money(r.estimatedCny)).join(' | ')} |
| 相对原生的费用降幅 | — | — | **${pct(summary.secondRoundSavingsPercent)}%** | **${pct(summary.thirdRoundSavingsPercent)}%** |

第 2、3 轮均实现 **3/3 任务零主模型调用**。后两轮平均每组三项费用 **¥${money(warmCost / 2)}**，对照原生同组三项 **¥${money(baseline.estimatedCny)}**，估算费用降低 **${pct(summary.combinedWarmSavingsPercent)}%**。这个平均降幅使用两轮费用之和与原生单轮费用的两倍比较；原生第二次是等次数外推，不是额外独立样本。

## 首次积累成本

第一轮费用 ¥${money(rounds[0].estimatedCny)}，高于原生。三轮合计 **¥${money(totalCost)}**；原生单轮乘三的外推参考 **¥${money(baseline.estimatedCny * 3)}**，累计仍高 **${pct(summary.coldPlusWarmChangePercent)}%**。因此 **${pct(summary.combinedWarmSavingsPercent)}% 是后续复用阶段的降幅，不是含积累的三轮总体降幅**。

费用沿用冻结费率：主模型输入/输出为 2/8 元每百万 token，Jev 输入为 0.5 元每百万 token；包含两种模型请求，未计缓存折扣，不是实际账单。以上均为自建小样本一次采样，未证明跨项目泛化或统计显著性。

## 可引用表述

> 在项目启动、项目测试与构建、本地发布三个常见开发场景中，JevDo 在 Action 积累后的第 2、3 轮均实现零主模型调用；包含 Jev 请求的复用阶段平均估算费用，相比原生 DSH 降低 **${pct(summary.combinedWarmSavingsPercent)}%**。

原四任务的 **31 → 8 次、减少约 74%** 保留为历史范围结果，不能与本页三任务的 24 → 0 次混用。明确要求保存的另一组仍在原报告中，未合并进自主保存组。

## 可复算数据

- [逐任务费用与回滚问题解释](COST_BREAKDOWN.md)
- [机器可读汇总](cost-breakdown.json)
- [原始请求账本](budget.json) · [完整四任务报告](REPORT.md) · [原始轨迹](traces/)
- 复算：\`node scripts/developer-cost-breakdown.mjs\`；不消耗 API 用量。
`;
await writeFile(new URL('FINAL_RESULTS.md', root), finalReport);
console.log(JSON.stringify({ baseline, rounds, second: summary.secondRoundSavingsPercent, third: summary.thirdRoundSavingsPercent,
  warmAverageSavingsPercent: summary.combinedWarmSavingsPercent, coldPlusWarmChangePercent: summary.coldPlusWarmChangePercent }, null, 2));
