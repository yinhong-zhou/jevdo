# 当前交付核对

本次目标是按讨论实现轻量 DSH Jev Loop 与可沉淀 Action，并测重复使用和自选开发者场景。核对对象为当前源码和 V3 回归；V1/V2 的历史结果保留。没有把范围扩大到 MU、机器人、多 Agent 通信或预算调度。

| 要求 | 当前证据 | 核对结果 |
|---|---|---|
| DSH 默认 Loop 替换，配套规则自动注入 | cordis.patch.yml、src/dsh/index.ts、保留版权的 src/vendor/dsh-loop；DSH host/卸载/恢复测试 | 已实现，固定版本 headless 范围 |
| Action 可为命令或复杂脚本 | RecipeSchema 允许空实现依赖；直接 Node 命令测试；既有完整脚本 V3 探针 | 已验证 |
| 主模型主动保存，也可由用户指定 | authoring prompt、create/validate/catalog；自主/要求保存两组空库开始、跨会话三轮 | 已验证本轮存在主动沉淀，非普遍成功保证 |
| 库维护、项目绑定、实现变化失效 | Store/readiness/版本凭证；两个项目绑定、越界、旧实现测试；V2 更新探针 | 已验证；无自动归档功能 |
| Jev 按合法选择路由，confidence 不作为阈值否决 | src/decision.ts、src/controller.ts；低置信度合法选择测试与原始响应日志 | 已验证 |
| Jev 与主模型使用同一组装历史 | policy 的 modelInput；完整长历史和工具定义逐次相等测试 | 已验证 |
| 多步执行及结果反馈 | 后端→前端实际 HTTP 测试；V3 混合任务与两次测试轨迹 | 已验证 |
| 同任务修改输入后可再执行 | if_not_satisfied 复查；单位测试与 V3 test-edit-test 源码哈希检查 | 已验证 |
| 入库不盲目重复已执行副作用 | 精确工具证据采用；并发去重与未知修改拒绝测试；V3 回滚仅执行一次 | 已验证匹配范围；不声称支持任意 shell |
| 交付解释、指定脚本、不保存等约束 | 主模型参与后的收尾所有权；V3 8 类探针和最终回复检查 | 全部通过当前有限检查 |
| 原生无插件对照，插件多轮累积 | V2 8 个普通任务、V3 4 个重点任务；对照每任务一次，插件三轮；空库/相同输入/跨轮保留审计 | 已验证，保留所有组而非只报优胜组 |
| 额外自选场景和真实状态检查 | V2 共 89 次、V3 共 52 次；HTTP/实例/文件内容/命令顺序/库变化/回复来源 | V2 87/89；对应问题修复后 V3 52/52 |
| 成本、原始轨迹与版本保留 | 分离账本、protocol/source 哈希、traces；无金额上限但逐调用记账 | 审计通过，无结果覆盖 |
| 必要工程检查与打包 | npm run check、42 项 npm test、npm run build；npm pack --dry-run --ignore-scripts | 通过；包内 7 文件，无 .env/运行数据 |
| 实验服务清理 | scripts/check-developer-cleanup.ts，复核 V2/V3 的 30 个服务描述符 | 没有仍存活的所属服务 |

交付边界：这是可运行插件和带对照的工程验证，不代表所有真实任务更快、更便宜。最新自主组后两轮各 3/4 个普通任务零主模型，但整体费用尚未低于原生对照；存在误选后回退。详见 reports/developer-workflows-v3/ANALYSIS.md。
