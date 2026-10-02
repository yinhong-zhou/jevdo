import { readFile, writeFile } from 'node:fs/promises';
const report = JSON.parse(await readFile('reports/evaluation.json', 'utf8'));
if (!report.complete) throw new Error('Evaluation is not complete');
const learning = JSON.parse(await readFile('reports/live-learning.json', 'utf8'));
const smoke = JSON.parse(await readFile('reports/dsh-cli-smoke.json', 'utf8'));
const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
const arms = ['default', 'actions-off', 'jevaction'];
const labels = { default: 'DSH 官方 Loop', 'actions-off': '新 Loop，关闭 Jev 路由', jevaction: '新 Loop + JevAction' };
function table(rows) {
  return '| 组别 | 通过 | 主模型调用 | Jev 调用 | 平均耗时 | 主模型输入 / 输出 token |\n|---|---:|---:|---:|---:|---:|\n'
    + arms.map(arm => {
      const rs = rows.filter(r => r.arm === arm);
      return `| ${labels[arm]} | ${rs.filter(r => r.success).length}/${rs.length} | ${sum(rs, 'modelCalls')} | ${sum(rs, 'jevCalls')} | ${(sum(rs, 'elapsedMs') / rs.length / 1000).toFixed(2)} 秒 | ${sum(rs, 'inputTokens')} / ${sum(rs, 'outputTokens')} |`;
    }).join('\n');
}
const baseline = report.rows.filter(r => r.arm === 'default');
const ours = report.rows.filter(r => r.arm === 'jevaction');
const percent = ((1 - sum(ours, 'modelCalls') / sum(baseline, 'modelCalls')) * 100).toFixed(1);
const text = `# JevAction：小规模实际 API 评测

## 实际结果

使用配置中的主模型 ${report.model} 和 Jev ${report.jevModel}。8 个合成任务 × 3 组，共 ${report.rows.length} 次实际运行，每项每组仅一次；不代表统计显著性或通用能力排名。

${table(report.rows)}

本次实验中，主模型调用由 ${sum(baseline, 'modelCalls')} 次降到 ${sum(ours, 'modelCalls')} 次（减少 ${percent}%）。同时增加了 ${sum(ours, 'jevCalls')} 次 Jev 请求，总请求数并未随之下降。该结果证明部分操作能转移到轻量决策路径，不能直接解释成同等比例的费用节省。

### 三个已知操作的复用任务

${table(report.rows.filter(r => r.kind === 'warm'))}

其中 ${ours.filter(r => r.kind === 'warm' && r.modelCalls === 0).length}/3 个任务完全没有调用主模型。另一个任务发生了主模型回退。这些任务的 Action 已在准备阶段激活，因此本表不包括初次保存的成本。

### 逐项结果

| 任务 | 官方 / 关闭路由 / JevAction 主模型调用 | 官方 / JevAction 耗时 | 三组通过情况 |
|---|---:|---:|---|
${[...new Set(report.rows.map(r => r.id))].map(id => {
  const rs = arms.map(arm => report.rows.find(r => r.id === id && r.arm === arm));
  return `| ${id} | ${rs.map(r => r.modelCalls).join(' / ')} | ${(rs[0].elapsedMs / 1000).toFixed(2)} / ${(rs[2].elapsedMs / 1000).toFixed(2)} 秒 | ${rs.map(r => r.success ? '通过' : '失败').join(' / ')} |`;
}).join('\n')}

复杂任务和过期脚本场景没有稳定加速；Jev 逐步判断会增加等待时间。未知项目和权限拒绝场景验证的是没有修改错误目标、没有越过已配置的工具拒绝策略，不是复杂安全攻击评测。

## 真实模型沉淀 Action

另外执行了独立的学习实验：让主模型阅读项目，自己构造并保存生成报表的 Action，完成验证；随后销毁完整 DSH host 和会话，在新 host 中只读取磁盘 Action，并将业务数据从求和 16 改为求和 60。

- 首次保存：${learning.cold.modelCalls} 次主模型调用，${learning.cold.jevCalls} 次 Jev 请求。
- 新会话复用：${learning.warm.modelCalls} 次主模型调用，${learning.warm.jevCalls} 次 Jev 请求，${(learning.warm.elapsedMs / 1000).toFixed(2)} 秒。
- 实际产物为 ${learning.warm.artifact}，结果验收：${learning.warm.success ? '通过' : '失败'}。

这是新 host/新会话实验；另有 npm run demo 用两个新进程验证离线持久化与 DSH Loop 执行。不能把该学习实验说成零主模型调用。

## 插件安装和原生 DSH 命令行

通过官方 DSH ${smoke.version} 的 dsh plugin --profile ... add <本地仓库> 安装 bundle，配置中默认 Loop 被禁用，加载本仓库的 Loop。原生 headless 运行用真实 Jev 选择保存的动作，经官方 PowerShell 工具执行，产物由 alpha:1 变成 ${smoke.artifact}；退出码 ${smoke.code}，${smoke.success ? '通过' : '失败'}。完整输出见 [dsh-cli-smoke.json](dsh-cli-smoke.json)。

## 方法、限制与复现

- 数据集由本项目人工构建，包含 3 个重复构建、1 个构建后写文件、1 个脚本变化、1 个新任务、1 个未知项目、1 个权限拒绝任务；见 [dataset.json](dataset.json)。
- 每组使用独立目录、相同初始产物、同一模型配置、相同工具集合、相同 Action 库和同一 authoring prompt。官方 Loop 也可以调用 Action 工具，所以此实验衡量的是 Jev 路由的附加价值，而不是“给某一组多配了工具”。
- 每个保存的构建动作都预先执行验证一次（产物初值为 1）；新任务必须恰好增加一次到 2。验收读取磁盘产物、另一项目是否变化以及额外输出文件，不采信模型自报成功。verifier 不能独自保证任务成功，外部评测还会检查执行次数。
- 三组顺序轮换，但没有充分重复、显著性检验或严格控制模型缓存。延迟包括 Jev、主模型和工具执行，不包括安装和 fixture 准备。
- 主表在真实 DSH 核心服务组成的最小 headless host 上运行，本地 argv 工具经过 DSH ToolRuntime 和 guard，但不声称有 OS 沙箱。独立原生 CLI 实验才使用官方 shell/sandbox 组合。
- Jev 成功与失败请求均计数，返回的 token usage 保存在原始报告中；接口没有提供完整账单费用，本报告不推算金额。主模型 token 单列，不混淆两种模型成本。
- 初次试运行发现“把变化的数据当成实现依赖”“主模型不知道如何取得 fingerprint”“交回主模型后重复执行”三个问题。初始数据保留为 [evaluation-pilot.json](evaluation-pilot.json) 和 [live-learning-pilot.json](live-learning-pilot.json)；修正 authoring 指引、绑定解析和同一输入的成功执行复用后，重新运行完整 24 项。没有删除失败样本来计算主表。
- 执行 npm run eval、npm run eval:learning、npm run eval:report 可重新生成结果，会使用本地配置中的真实 API。

原始逐项数据：[evaluation.json](evaluation.json)；学习过程含实际模型工具调用：[live-learning.json](live-learning.json)。工作区完整日志的路径记录在各报告中。
`;
await writeFile('reports/RESULTS.md', text);
console.log('Wrote reports/RESULTS.md');
