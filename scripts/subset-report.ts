import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
const folder = join(ROOT, 'reports/reuse-subset');
const data = JSON.parse(await readFile(join(folder, 'results.json'), 'utf8'));
const budget = JSON.parse(await readFile(join(folder, 'budget-before-sequential.json'), 'utf8').catch(() => readFile(join(folder, 'budget.json'), 'utf8')));
const allRows: any[] = data.rows;
const rows = allRows.filter(r => !r.excludedForInputBug);
const sum = (rs: any[], key: string) => rs.reduce((s, r) => s + (r[key] ?? 0), 0);
const title = (condition: string) => condition === 'required' ? '明确要求保存' : '未明确要求保存';
const baseline = rows.filter(r => r.phase === 'warm' && r.arm === 'default');
const treatment = rows.filter(r => r.phase === 'warm' && r.arm === 'jevaction');
const lines = [
  '# JevAction：公开任务衍生的调度消融评测', '',
  '**对照组说明：本页的官方 Loop 组也装有 Action 工具、Action 库和保存提示，属于调度消融，不是未加载插件的原生对照。不能用本页结果判断整个插件相对原生 DSH 的收益。**', '',
  '本页每次复用都恢复首次学习快照，不测持续积累。连续三轮、包含无插件官方 Loop 的主对照另见 [连续复用报告](../sequential-subset/REPORT.md)。', '',
  `完成 ${rows.length}/30 次有效运行；含数据修正前的记录，共 ${allRows.length} 次实际运行。主模型 deepseek-flash，非思考模式，temperature=0；Jev jev-latest。每个有效组合仅一次运行。`, '',
  '**这是 Terminal-Bench 2.1 三个任务规格衍生的工作流实验，不是官方子集成绩。** 保留日志分时段统计、多格式用户合并、正则提取的核心要求；使用新生成的小数据、Windows 本地环境和独立验证器，并增加两批后续输入。', '',
  '## 本轮观察', '',
  `- 复用阶段，主模型总调用从 ${sum(baseline, 'modelCalls')} 次变为 ${sum(treatment, 'modelCalls')} 次；同时增加 ${sum(treatment, 'jevCalls')} 次 Jev 请求。`,
  `- 平均耗时从 ${(sum(baseline, 'elapsedMs') / baseline.length / 1000).toFixed(2)} 秒变为 ${(sum(treatment, 'elapsedMs') / treatment.length / 1000).toFixed(2)} 秒，本轮没有观察到总体加速。`,
  `- 两组“完成且正确”分别是 ${baseline.filter(r => r.success).length}/${baseline.length} 与 ${treatment.filter(r => r.success).length}/${treatment.length}；只看产物正确时分别是 ${baseline.filter(r => r.external.success).length}/${baseline.length} 与 ${treatment.filter(r => r.external.success).length}/${treatment.length}。正确产物但达到步骤上限的运行不计完整成功。`,
  '- 明确要求保存与未明确要求保存，都在日志统计和用户合并中保存并激活了 Action；正则任务均未在学习步骤上限内完成并入库。仅三个流程，不能由此推断两种保存策略等效。',
  '- 日志流程生成的 recipe 把 reference_date.txt 列为 watchedFiles，导致参考日期变化后阻止直接复用。普通输入与实现依赖的划分还不够可靠。',
  '- 四次用户合并的 Jev 路径都选中了学习得到的 Action，但执行后的判断多次因置信度不足回退到主模型，削弱了节省并增加延迟。',
  `- ${treatment.filter(r => r.success && r.modelCalls === 0).length} 次新会话复用在主模型零调用的情况下正确完成；这是机制有效的案例，不代表任意任务都有收益。`, '',
  '## 保存行为', '',
  '两种条件获得相同的 Action 工具与 authoring 系统提示。唯一的用户提示差异是是否明确要求保存并激活 Action。“自主”不代表模型完全没看过保存说明。', '',
  '| 保存条件 | 学习任务正确 | 至少保存一个 Action | 至少激活一个 Action | 学习主模型调用 | 学习费用上界（元） |',
  '|---|---:|---:|---:|---:|---:|',
];
for (const condition of ['required', 'autonomous']) {
  const rs = rows.filter(r => r.phase === 'learning' && r.condition === condition);
  lines.push(`| ${title(condition)} | ${rs.filter(r => r.success).length}/${rs.length} | ${rs.filter(r => r.afterLibrary.saved > 0).length}/${rs.length} | ${rs.filter(r => r.afterLibrary.active > 0).length}/${rs.length} | ${sum(rs, 'modelCalls')} | ${sum(rs, 'costUpperCny').toFixed(4)} |`);
}
lines.push('', '## 新会话复用', '',
  '每次测试都恢复同一学习快照、替换输入、删除旧产物，重建 DSH host 和会话。两种调度方式拥有完全相同的脚本和 Action 库；前一个测试的改进不会进入后一个。基线是“官方 DSH Loop + 同样的 Action 工具”，用来隔离 Jev 调度的附加效果。', '',
  '| 保存条件 | 调度 | 完成且正确 | 产物正确 | 主模型调用 | Jev 调用 | 成功且零主模型 | 平均秒数 | 费用上界（元） |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const condition of ['required', 'autonomous']) for (const arm of ['default', 'jevaction']) {
  const rs = rows.filter(r => r.phase === 'warm' && r.condition === condition && r.arm === arm);
  lines.push(`| ${title(condition)} | ${arm === 'default' ? '官方 Loop＋Action（消融）' : 'Jev Loop'} | ${rs.filter(r => r.success).length}/${rs.length} | ${rs.filter(r => r.external.success && r.inputsUnchanged).length}/${rs.length} | ${sum(rs, 'modelCalls')} | ${sum(rs, 'jevCalls')} | ${rs.filter(r => r.success && r.modelCalls === 0).length}/${rs.length} | ${(sum(rs, 'elapsedMs') / Math.max(1, rs.length) / 1000).toFixed(2)} | ${sum(rs, 'costUpperCny').toFixed(4)} |`);
}
lines.push('', '## 逐任务记录', '', '| 工作流 | 保存条件 | 阶段 | 调度 | 正确 | 主模型 / Jev 请求 | Jev 选择已学习 Action 次数 | 秒数 |', '|---|---|---|---|---|---:|---:|---:|');
for (const r of rows) lines.push(`| ${r.task} | ${title(r.condition)} | ${r.phase === 'learning' ? '学习' : `新输入 ${r.variant}`} | ${r.arm} | ${r.success ? '是' : '否'} | ${r.modelCalls} / ${r.jevCalls} | ${r.learnedActionSelectionsByJev.length} | ${((r.elapsedMs ?? 0) / 1000).toFixed(2)} |`);
if (allRows.length !== rows.length) lines.push('', '## 数据修正说明', '',
  '初版生成器把零事件日志写成了一个空行，违反每行包含事件的输入约定。只把该文件改为真正的空文件，不改变预期统计、提示或已学习的 Action。受影响的四个配对全部从相同学习快照重测。原记录位于 results-before-input-correction.json 与原始 traces/，不进入有效样本表，费用完整计入总预算。', '',
  ...allRows.filter(r => r.excludedForInputBug).map(r => `- ${r.id}：原始成功=${r.success}，外部产物正确=${r.external.success}，主模型=${r.modelCalls}，Jev=${r.jevCalls}，上界费用=${r.costUpperCny.toFixed(4)} 元。`));
const main = budget.entries.filter((e: any) => e.service === 'deepseek');
const jev = budget.entries.filter((e: any) => e.service === 'jev');
lines.push('', '## 成本与限制', '',
  `- 本次实验全量费用保守上界：**${budget.upperCny.toFixed(4)} 元**；包含学习、测试、错误请求及未知用量的全额预留。用户上限 10 元，执行器在 9 元处停止。`,
  `- DeepSeek 账户余额减少：${budget.observedDeepseekDebitCny.toFixed(6)} 元。账户有并发用途时此差额不一定全由本实验产生；不显示账户余额。`,
  `- 主模型 token：输入 ${sum(main, 'inputTokens')}，输出 ${sum(main, 'outputTokens')}；Jev 输入 ${sum(jev, 'inputTokens')}，输出 ${sum(jev, 'outputTokens')}。`,
  '- 主模型上界按官方 Flash 高峰、缓存未命中价格：输入 2 元/百万，输出 8 元/百万，不利用缓存或闲时折扣压低数值。Jev 按保守 0.50 元/百万输入估算；公开价为 $0.042/百万输入，输出免费。Jev 金额为估算，未拿到账单。',
  '- 三个流程是便利抽样，不代表完整公开基准；每种学习设置只有三个样本，不做统计显著性或普遍优越性宣称。',
  '- 学习快照、Action 定义与脚本由实际模型产生，未预置人工 Action；出厂 list/read 动作仍存在，其命中不算学习到的 Action。',
  '- 自检通过不等于评测通过：外部程序检查真实 CSV、Parquet、冲突报告、正则匹配结果，且检查输入未被修改。学习最多 20 步，复用最多 12 步；步骤耗尽作为失败，产物正确率另外报告。',
  '- 本轮测同项目、跨会话、变化输入的流程复用，不测新项目迁移。所有学习与路由失败都保留，不根据结果修正提示或重跑。',
  '- 为控制预算，每个学习/测试组合只运行一次。零主模型比例、耗时和费用均须同时结合任务成功率解释。', '',
  '## 可复核材料', '',
  '- [预先固定的方案与来源](protocol.json)', '- [结构化结果](results.json)', '- [逐请求预算账本](budget.json)',
  '- [配对输入、Action 库、账目与凭据泄漏检查](audit.json)',
  '- 每个任务的完整模型工具轨迹和外部验收结果见 traces/；不含 API key。',
  '- 官方定价：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ ；https://typesafe.ai/blog/introducing-system-one-models-and-jev',
);
await writeFile(join(folder, 'REPORT.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ report: join(folder, 'REPORT.md'), runs: rows.length, upperCny: budget.upperCny }));
