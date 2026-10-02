export function developerReportBody(result: any, budget: any, rounds: any[], rows: any[]) {
  const label = (s: string) => ({ 'official-clean': '原生 Loop（无插件）', required: '要求保存', autonomous: '自主保存' })[s] ?? s;
  const failures = rows.filter(r => !r.success);
  const table = rounds.map(r => `| ${label(r.group)} | ${r.round} | ${r.success}/${r.n} | ${r.zeroMainSuccess}/${r.n} | ${r.mainCalls} | ${r.jevCalls} | ${(r.seconds/r.n).toFixed(2)} | ${r.cost.toFixed(4)} |`).join('\n');
  const probes = rows.filter(r => r.phase === 'probe').map(r => `| ${label(r.group)} | ${r.task} | ${r.external.success ? '通过' : '失败'} | ${r.requirements?.success ? '通过' : '失败'} | ${r.modelCalls} | ${r.learnedSelections.map((p: any) => p.actionId).join(' → ') || '无'} |`).join('\n');
  const detail = rows.map(r => `| ${r.id} | ${r.success ? '通过' : '未通过'} | ${r.modelCalls} | ${r.jevCalls} | ${r.afterLibrary.saved}/${r.afterLibrary.active} | [轨迹](${r.traceFile}) |`).join('\n');
  const cumulative = ['required', 'autonomous'].map(group => {
    const rs = rounds.filter(r => r.group === group);
    return `- ${label(group)}：三轮含学习成本 ${rs.reduce((s,r)=>s+r.cost,0).toFixed(4)} 元、主模型调用 ${rs.reduce((s,r)=>s+r.mainCalls,0)} 次。`;
  }).join('\n');
  return `# 开发者工作流 ${result.protocol.revision} 实验

完成 ${rows.length} 次真实 API 任务；${rows.filter(r=>r.success).length} 次通过代码/状态、明确交付约束与 turn 完成检查。费用按记录费率估算 **${budget.upperCny.toFixed(4)} 元**，包含学习和失败费用，不是供应商账单。自然语言检查是有限代理指标，不能代表完整语义质量。

## 实验设计

${result.protocol.design.normalCases.length} 个普通操作：${result.protocol.design.normalCases.join('、')}。原生无插件 Loop 每种任务只测一次，两个插件组各三轮。每次使用新会话、重置源代码/输入/输出/服务初始状态；插件各自保留库和脚本，基线使用新工作区。所有组拿到相同现成脚本，不预置 Action。

随后各测 ${result.protocol.design.probesAfterLearning.length} 个探针：${result.protocol.design.probesAfterLearning.join('、')}。总数 ${result.protocol.design.totalRows}。脚本启动检查实际使用既有脚本；重复测试检查修改前后的源代码哈希；禁止保存检查库未变；解释任务检查最后确为主模型回复并包含所需主题。

“自主保存”指用户没有逐任务要求保存，插件仍有主动维护策略。新版比 V1 更明确鼓励沉淀常见稳定流程，允许跳过不适合者，遵守用户禁止保存。此次还一起修改了依赖描述、重放策略和 DONE 提示，因此不是单因素消融。

相比 V1，测试项目新增了现成完整启动脚本，测试事件也记录源码哈希。不能将版本差异全部归因于单条 prompt。三组使用相同新版项目、模型和限制。方案与源文件哈希见 [protocol.json](protocol.json)，每轮代码快照位于 source/，账本与约束核对见 [audit.json](audit.json)。

${result.protocol.changesFromV2 ?? ''}

## 三轮结果

| 组别 | 轮次 | 成功 | 成功且零主模型 | 主模型调用 | Jev 调用 | 平均秒数 | 估算元 |
|---|---:|---:|---:|---:|---:|---:|---:|
${table}

${cumulative}

原生一轮费用乘三为 ${(rounds.find(r=>r.group==='official-clean').cost*3).toFixed(4)} 元，仅为外推参考，不是三轮实测。并发会影响延迟。调用少不必然费用低，也不能只统计复用阶段而忽略学习成本。

## 自选混合与边界场景

| 组别 | 探针 | 状态检查 | 交付约束 | 主模型调用 | Jev 选择的已学习 Action |
|---|---|---|---|---:|---|
${probes}

“Jev 选择的 Action”与“主模型调用 Action”分别记录，不能混称自动接管。最终说明只做来源、存在性与主题关键词检查，完整回复仍保留供人工复核。失败、源文件变化和无绑定可能由主模型接手；任务成功不等于全过程都由 Jev 执行。

## 未通过项目

${failures.length ? failures.map(r=>'- '+r.id+': '+[r.external.error, ...(r.requirements?.errors ?? []), r.outcome?.kind!=='completed'?JSON.stringify(r.outcome):null].filter(Boolean).join('; ')).join('\n') : '本轮检查未发现失败；小型项目单次采样仍不足以证明所有真实场景可靠。'}

## 限制

这是自建可执行项目的工程实验，每个格子一次采样，无统计显著性结论。支持跨任务在同一项目积累，未测试跨项目迁移、长期库膨胀或自动归档。提供既有脚本使两组都更容易完成任务，未评估从零编写复杂启动系统。发布只作用于本地测试目录。独立检查器不依赖 Action 自带 verifier，但有限断言和主题关键词不能覆盖所有语义错误。

## 全部运行

| 运行 | 结果 | 主模型 | Jev | 保存/有效 | 证据 |
|---|---|---:|---:|---:|---|
${detail}
`;
}
