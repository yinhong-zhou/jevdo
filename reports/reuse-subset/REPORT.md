# JevAction：公开任务衍生的调度消融评测

**对照组说明：本页的官方 Loop 组也装有 Action 工具、Action 库和保存提示，属于调度消融，不是未加载插件的原生对照。不能用本页结果判断整个插件相对原生 DSH 的收益。**

本页每次复用都恢复首次学习快照，不测持续积累。连续三轮、包含无插件官方 Loop 的主对照另见 [连续复用报告](../sequential-subset/REPORT.md)。

完成 30/30 次有效运行；含数据修正前的记录，共 34 次实际运行。主模型 deepseek-flash，非思考模式，temperature=0；Jev jev-latest。每个有效组合仅一次运行。

**这是 Terminal-Bench 2.1 三个任务规格衍生的工作流实验，不是官方子集成绩。** 保留日志分时段统计、多格式用户合并、正则提取的核心要求；使用新生成的小数据、Windows 本地环境和独立验证器，并增加两批后续输入。

## 本轮观察

- 复用阶段，主模型总调用从 93 次变为 83 次；同时增加 106 次 Jev 请求。
- 平均耗时从 12.42 秒变为 14.44 秒，本轮没有观察到总体加速。
- 两组“完成且正确”分别是 8/12 与 8/12；只看产物正确时分别是 10/12 与 8/12。正确产物但达到步骤上限的运行不计完整成功。
- 明确要求保存与未明确要求保存，都在日志统计和用户合并中保存并激活了 Action；正则任务均未在学习步骤上限内完成并入库。仅三个流程，不能由此推断两种保存策略等效。
- 日志流程生成的 recipe 把 reference_date.txt 列为 watchedFiles，导致参考日期变化后阻止直接复用。普通输入与实现依赖的划分还不够可靠。
- 四次用户合并的 Jev 路径都选中了学习得到的 Action，但执行后的判断多次因置信度不足回退到主模型，削弱了节省并增加延迟。
- 2 次新会话复用在主模型零调用的情况下正确完成；这是机制有效的案例，不代表任意任务都有收益。

## 保存行为

两种条件获得相同的 Action 工具与 authoring 系统提示。唯一的用户提示差异是是否明确要求保存并激活 Action。“自主”不代表模型完全没看过保存说明。

| 保存条件 | 学习任务正确 | 至少保存一个 Action | 至少激活一个 Action | 学习主模型调用 | 学习费用上界（元） |
|---|---:|---:|---:|---:|---:|
| 明确要求保存 | 2/3 | 2/3 | 2/3 | 46 | 0.7476 |
| 未明确要求保存 | 2/3 | 2/3 | 2/3 | 41 | 0.6077 |

## 新会话复用

每次测试都恢复同一学习快照、替换输入、删除旧产物，重建 DSH host 和会话。两种调度方式拥有完全相同的脚本和 Action 库；前一个测试的改进不会进入后一个。基线是“官方 DSH Loop + 同样的 Action 工具”，用来隔离 Jev 调度的附加效果。

| 保存条件 | 调度 | 完成且正确 | 产物正确 | 主模型调用 | Jev 调用 | 成功且零主模型 | 平均秒数 | 费用上界（元） |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 明确要求保存 | 官方 Loop＋Action（消融） | 4/6 | 6/6 | 47 | 0 | 0/6 | 12.79 | 0.5754 |
| 明确要求保存 | Jev Loop | 4/6 | 4/6 | 38 | 49 | 1/6 | 13.21 | 0.4753 |
| 未明确要求保存 | 官方 Loop＋Action（消融） | 4/6 | 4/6 | 46 | 0 | 0/6 | 12.04 | 0.5022 |
| 未明确要求保存 | Jev Loop | 4/6 | 4/6 | 45 | 57 | 1/6 | 15.67 | 0.5512 |

## 逐任务记录

| 工作流 | 保存条件 | 阶段 | 调度 | 正确 | 主模型 / Jev 请求 | Jev 选择已学习 Action 次数 | 秒数 |
|---|---|---|---|---|---:|---:|---:|
| log-summary-date-ranges | 明确要求保存 | 学习 | jevaction | 是 | 13 / 17 | 0 | 25.64 |
| log-summary-date-ranges | 明确要求保存 | 新输入 2 | jevaction | 是 | 6 / 7 | 0 | 9.19 |
| log-summary-date-ranges | 明确要求保存 | 新输入 2 | default | 是 | 6 / 0 | 0 | 6.38 |
| log-summary-date-ranges | 未明确要求保存 | 学习 | jevaction | 是 | 11 / 17 | 0 | 22.80 |
| log-summary-date-ranges | 未明确要求保存 | 新输入 2 | default | 是 | 6 / 0 | 0 | 7.16 |
| log-summary-date-ranges | 未明确要求保存 | 新输入 2 | jevaction | 是 | 9 / 11 | 0 | 13.71 |
| multi-source-data-merger | 未明确要求保存 | 学习 | jevaction | 是 | 11 / 14 | 0 | 41.52 |
| multi-source-data-merger | 未明确要求保存 | 新输入 1 | jevaction | 是 | 7 / 10 | 1 | 19.07 |
| multi-source-data-merger | 未明确要求保存 | 新输入 1 | default | 是 | 5 / 0 | 0 | 10.22 |
| multi-source-data-merger | 未明确要求保存 | 新输入 2 | default | 是 | 6 / 0 | 0 | 13.49 |
| multi-source-data-merger | 未明确要求保存 | 新输入 2 | jevaction | 是 | 5 / 7 | 1 | 16.31 |
| multi-source-data-merger | 明确要求保存 | 学习 | jevaction | 是 | 13 / 16 | 0 | 37.13 |
| multi-source-data-merger | 明确要求保存 | 新输入 1 | default | 是 | 7 / 0 | 0 | 16.10 |
| multi-source-data-merger | 明确要求保存 | 新输入 1 | jevaction | 是 | 2 / 5 | 1 | 6.42 |
| multi-source-data-merger | 明确要求保存 | 新输入 2 | jevaction | 是 | 6 / 8 | 1 | 17.45 |
| multi-source-data-merger | 明确要求保存 | 新输入 2 | default | 是 | 5 / 0 | 0 | 11.22 |
| regex-log | 明确要求保存 | 学习 | jevaction | 否 | 20 / 20 | 0 | 50.56 |
| regex-log | 明确要求保存 | 新输入 1 | default | 否 | 12 / 0 | 0 | 18.07 |
| regex-log | 明确要求保存 | 新输入 1 | jevaction | 否 | 12 / 14 | 0 | 21.63 |
| regex-log | 明确要求保存 | 新输入 2 | jevaction | 否 | 12 / 12 | 0 | 22.86 |
| regex-log | 明确要求保存 | 新输入 2 | default | 否 | 12 / 0 | 0 | 18.88 |
| regex-log | 未明确要求保存 | 学习 | jevaction | 否 | 19 / 24 | 0 | 28.77 |
| regex-log | 未明确要求保存 | 新输入 1 | jevaction | 否 | 12 / 14 | 0 | 20.91 |
| regex-log | 未明确要求保存 | 新输入 1 | default | 否 | 12 / 0 | 0 | 17.03 |
| regex-log | 未明确要求保存 | 新输入 2 | default | 否 | 12 / 0 | 0 | 17.47 |
| regex-log | 未明确要求保存 | 新输入 2 | jevaction | 否 | 12 / 12 | 0 | 22.59 |
| log-summary-date-ranges | 明确要求保存 | 新输入 1 | default | 是 | 5 / 0 | 0 | 6.08 |
| log-summary-date-ranges | 明确要求保存 | 新输入 1 | jevaction | 是 | 0 / 3 | 1 | 1.71 |
| log-summary-date-ranges | 未明确要求保存 | 新输入 1 | jevaction | 是 | 0 / 3 | 1 | 1.45 |
| log-summary-date-ranges | 未明确要求保存 | 新输入 1 | default | 是 | 5 / 0 | 0 | 6.89 |

## 数据修正说明

初版生成器把零事件日志写成了一个空行，违反每行包含事件的输入约定。只把该文件改为真正的空文件，不改变预期统计、提示或已学习的 Action。受影响的四个配对全部从相同学习快照重测。原记录位于 results-before-input-correction.json 与原始 traces/，不进入有效样本表，费用完整计入总预算。

- log-summary-date-ranges-required-warm1-default：原始成功=true，外部产物正确=true，主模型=12，Jev=0，上界费用=0.2137 元。
- log-summary-date-ranges-required-warm1-jevaction：原始成功=false，外部产物正确=true，主模型=11，Jev=2，上界费用=0.1642 元。
- log-summary-date-ranges-autonomous-warm1-jevaction：原始成功=false，外部产物正确=true，主模型=11，Jev=2，上界费用=0.1626 元。
- log-summary-date-ranges-autonomous-warm1-default：原始成功=true，外部产物正确=true，主模型=10，Jev=0，上界费用=0.1420 元。

## 成本与限制

- 本次实验全量费用保守上界：**4.1420 元**；包含学习、测试、错误请求及未知用量的全额预留。用户上限 10 元，执行器在 9 元处停止。
- DeepSeek 账户余额减少：0.300000 元。账户有并发用途时此差额不一定全由本实验产生；不显示账户余额。
- 主模型 token：输入 1723731，输出 70012；Jev 输入 268866，输出 12120。
- 主模型上界按官方 Flash 高峰、缓存未命中价格：输入 2 元/百万，输出 8 元/百万，不利用缓存或闲时折扣压低数值。Jev 按保守 0.50 元/百万输入估算；公开价为 $0.042/百万输入，输出免费。Jev 金额为估算，未拿到账单。
- 三个流程是便利抽样，不代表完整公开基准；每种学习设置只有三个样本，不做统计显著性或普遍优越性宣称。
- 学习快照、Action 定义与脚本由实际模型产生，未预置人工 Action；出厂 list/read 动作仍存在，其命中不算学习到的 Action。
- 自检通过不等于评测通过：外部程序检查真实 CSV、Parquet、冲突报告、正则匹配结果，且检查输入未被修改。学习最多 20 步，复用最多 12 步；步骤耗尽作为失败，产物正确率另外报告。
- 本轮测同项目、跨会话、变化输入的流程复用，不测新项目迁移。所有学习与路由失败都保留，不根据结果修正提示或重跑。
- 为控制预算，每个学习/测试组合只运行一次。零主模型比例、耗时和费用均须同时结合任务成功率解释。

## 可复核材料

- [预先固定的方案与来源](protocol.json)
- [结构化结果](results.json)
- [逐请求预算账本](budget.json)
- [配对输入、Action 库、账目与凭据泄漏检查](audit.json)
- 每个任务的完整模型工具轨迹和外部验收结果见 traces/；不含 API key。
- 官方定价：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ ；https://typesafe.ai/blog/introducing-system-one-models-and-jev
