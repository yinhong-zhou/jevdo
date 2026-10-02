# 开发者重复工作流实验

完成 65 次真实 API 任务；独立验收与 turn 完成均满足的有 65 次。费用按记录费率估算合计 **7.2432 元**，包含失败与冷启动费用，不是供应商账单。所有历史实验账本保持原样。

## 方法

8 个常见操作：启动前后端、停止、重启后端、测试构建、生成客户端、本地发布、回滚、只补启动前端。无插件官方 DSH Loop 每种任务从干净目录测一次；两个 JevAction 组分别累计三轮，每次新会话、重置初始状态，但保留各自 Action 库。另各测一次混合任务、后端失败、脚本变更，共 65 次。

所有组都获得相同的现成项目脚本与 README；没有人工预置 Action。测的是模型发现并登记已有流程、之后由 Jev 选择复用，不是自动发明脚本。自主保存组也会收到插件的一般沉淀策略，只是用户没有明确要求保存。官方对照使用同一最小 headless 宿主中的原生 Loop，不代表完整原生 CLI。

Jev 与主模型共享组装后的完整输入，置信度只记录。普通任务每轮使用相同 prompt 和输入数据；随机端口、进程实例和时间戳会变化。输入哈希、版本、账本及约束见 [方案](protocol.json) 和 [审计](audit.json)。

## 三轮复用

| 组别 | 轮次 | 成功 | 成功且零主模型调用 | 主模型调用总数 | Jev 调用总数 | 平均秒数 | 估算元 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 原生 Loop（无插件） | 1 | 8/8 | 0/8 | 62 | 0 | 9.37 | 0.5072 |
| 要求保存 | 1 | 8/8 | 1/8 | 55 | 109 | 13.96 | 1.3879 |
| 要求保存 | 2 | 8/8 | 5/8 | 12 | 50 | 4.74 | 0.3464 |
| 要求保存 | 3 | 8/8 | 5/8 | 15 | 58 | 5.93 | 0.5032 |
| 自主保存 | 1 | 8/8 | 0/8 | 42 | 110 | 11.29 | 1.0220 |
| 自主保存 | 2 | 8/8 | 0/8 | 45 | 135 | 12.67 | 1.2193 |
| 自主保存 | 3 | 8/8 | 0/8 | 43 | 122 | 11.96 | 1.1409 |

原生组只实际测了一轮，不应将其重复显示成三个独立样本。并发会影响延迟；零主模型调用只有在整个请求通过独立验收时才计为成功。不可仅因 Action 已保存，就声称其已由 Jev 接管。

## 混合与异常任务

| 组别 | 探针 | 验收 | 主模型调用 | Jev 选择的已学习 Action |
|---|---|---|---:|---|
| 原生 Loop（无插件） | start-and-edit | 通过 | 10 | 无 |
| 原生 Loop（无插件） | backend-failure | 通过 | 6 | 无 |
| 原生 Loop（无插件） | changed-script | 通过 | 6 | 无 |
| 要求保存 | start-and-edit | 通过 | 6 | start-backend → start-frontend |
| 要求保存 | backend-failure | 通过 | 7 | 无 |
| 要求保存 | changed-script | 通过 | 7 | 无 |
| 自主保存 | start-and-edit | 通过 | 7 | 无 |
| 自主保存 | backend-failure | 通过 | 5 | 无 |
| 自主保存 | changed-script | 通过 | 4 | 无 |

start-and-edit 要求启动服务、新增 average 函数、测试并构建，独立检查函数行为和当前构建内容；用户还要求说明改动，完整回复留在轨迹中供复核。backend-failure 检查失败时前端不启动、配置不被擅改；changed-script 检查实现变化后的行为。探针执行在三轮之后，只测一次，不属于每轮成功率。

## 失败与解释边界

本次没有任务验收失败，但样本很小，不能推断任意真实项目都能成功。

选择 LLM 的原因分布、完整 Action 定义和探针回复见 [汇总数据](summary.json)。同一个 Action 可是一条命令，也可包含多个步骤或调用复杂脚本。本次工作区预置的 dev.mjs 提供稳定命令入口，并不意味着所有 Action 都必须是脚本。

这是目的明确的小型工程实验，每格一次采样，且案例之间允许共享学到的操作。它不证明统计显著性、跨项目泛化或长期维护能力；本地发布仅写测试目录。基线不保留跨任务学习，而插件保留库，因此衡量的是累计复用与路由的综合效果。

## 每次运行

| 运行 | 结果 | 主模型 | Jev | 保存/仍有效 | 证据 |
|---|---|---:|---:|---:|---|
| official-clean-r1-start-stack | 通过 | 9 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-stack.json) |
| autonomous-r1-start-stack | 通过 | 6 | 11 | 0/0 | [轨迹](traces/autonomous-r1-start-stack.json) |
| required-r1-start-stack | 通过 | 10 | 20 | 2/2 | [轨迹](traces/required-r1-start-stack.json) |
| official-clean-r1-stop-stack | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-stop-stack.json) |
| autonomous-r1-stop-stack | 通过 | 7 | 12 | 0/0 | [轨迹](traces/autonomous-r1-stop-stack.json) |
| official-clean-r1-restart-backend | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-restart-backend.json) |
| autonomous-r1-restart-backend | 通过 | 4 | 10 | 0/0 | [轨迹](traces/autonomous-r1-restart-backend.json) |
| required-r1-stop-stack | 通过 | 11 | 16 | 4/4 | [轨迹](traces/required-r1-stop-stack.json) |
| official-clean-r1-test-build | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-test-build.json) |
| autonomous-r1-test-build | 通过 | 7 | 14 | 0/0 | [轨迹](traces/autonomous-r1-test-build.json) |
| official-clean-r1-generate-client | 通过 | 5 | 0 | 0/0 | [轨迹](traces/official-clean-r1-generate-client.json) |
| required-r1-restart-backend | 通过 | 4 | 9 | 4/4 | [轨迹](traces/required-r1-restart-backend.json) |
| autonomous-r1-generate-client | 通过 | 3 | 12 | 0/0 | [轨迹](traces/autonomous-r1-generate-client.json) |
| official-clean-r1-publish-local | 通过 | 11 | 0 | 0/0 | [轨迹](traces/official-clean-r1-publish-local.json) |
| required-r1-test-build | 通过 | 8 | 16 | 6/6 | [轨迹](traces/required-r1-test-build.json) |
| official-clean-r1-rollback-local | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-rollback-local.json) |
| autonomous-r1-publish-local | 通过 | 7 | 28 | 0/0 | [轨迹](traces/autonomous-r1-publish-local.json) |
| official-clean-r1-partial-stack | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-partial-stack.json) |
| required-r1-generate-client | 通过 | 7 | 13 | 7/7 | [轨迹](traces/required-r1-generate-client.json) |
| autonomous-r1-rollback-local | 通过 | 4 | 13 | 0/0 | [轨迹](traces/autonomous-r1-rollback-local.json) |
| official-clean-r1-start-and-edit | 通过 | 10 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-and-edit.json) |
| autonomous-r1-partial-stack | 通过 | 4 | 10 | 0/0 | [轨迹](traces/autonomous-r1-partial-stack.json) |
| official-clean-r1-backend-failure | 通过 | 6 | 0 | 0/0 | [轨迹](traces/official-clean-r1-backend-failure.json) |
| required-r1-publish-local | 通过 | 11 | 21 | 8/8 | [轨迹](traces/required-r1-publish-local.json) |
| autonomous-r2-start-stack | 通过 | 8 | 15 | 0/0 | [轨迹](traces/autonomous-r2-start-stack.json) |
| official-clean-r1-changed-script | 通过 | 6 | 0 | 0/0 | [轨迹](traces/official-clean-r1-changed-script.json) |
| required-r1-rollback-local | 通过 | 4 | 11 | 8/8 | [轨迹](traces/required-r1-rollback-local.json) |
| required-r1-partial-stack | 通过 | 0 | 3 | 8/8 | [轨迹](traces/required-r1-partial-stack.json) |
| autonomous-r2-stop-stack | 通过 | 7 | 12 | 0/0 | [轨迹](traces/autonomous-r2-stop-stack.json) |
| required-r2-start-stack | 通过 | 3 | 10 | 8/8 | [轨迹](traces/required-r2-start-stack.json) |
| required-r2-stop-stack | 通过 | 0 | 5 | 8/8 | [轨迹](traces/required-r2-stop-stack.json) |
| autonomous-r2-restart-backend | 通过 | 4 | 10 | 0/0 | [轨迹](traces/autonomous-r2-restart-backend.json) |
| required-r2-restart-backend | 通过 | 5 | 10 | 8/8 | [轨迹](traces/required-r2-restart-backend.json) |
| autonomous-r2-test-build | 通过 | 5 | 12 | 0/0 | [轨迹](traces/autonomous-r2-test-build.json) |
| required-r2-test-build | 通过 | 0 | 5 | 8/8 | [轨迹](traces/required-r2-test-build.json) |
| required-r2-generate-client | 通过 | 0 | 3 | 8/8 | [轨迹](traces/required-r2-generate-client.json) |
| required-r2-publish-local | 通过 | 0 | 3 | 8/8 | [轨迹](traces/required-r2-publish-local.json) |
| autonomous-r2-generate-client | 通过 | 3 | 21 | 0/0 | [轨迹](traces/autonomous-r2-generate-client.json) |
| required-r2-rollback-local | 通过 | 4 | 11 | 8/8 | [轨迹](traces/required-r2-rollback-local.json) |
| required-r2-partial-stack | 通过 | 0 | 3 | 8/8 | [轨迹](traces/required-r2-partial-stack.json) |
| required-r3-start-stack | 通过 | 4 | 11 | 8/8 | [轨迹](traces/required-r3-start-stack.json) |
| autonomous-r2-publish-local | 通过 | 8 | 29 | 0/0 | [轨迹](traces/autonomous-r2-publish-local.json) |
| required-r3-stop-stack | 通过 | 0 | 5 | 8/8 | [轨迹](traces/required-r3-stop-stack.json) |
| autonomous-r2-rollback-local | 通过 | 5 | 26 | 0/0 | [轨迹](traces/autonomous-r2-rollback-local.json) |
| required-r3-restart-backend | 通过 | 6 | 12 | 9/9 | [轨迹](traces/required-r3-restart-backend.json) |
| required-r3-test-build | 通过 | 0 | 5 | 9/9 | [轨迹](traces/required-r3-test-build.json) |
| required-r3-generate-client | 通过 | 0 | 3 | 9/9 | [轨迹](traces/required-r3-generate-client.json) |
| autonomous-r2-partial-stack | 通过 | 5 | 10 | 0/0 | [轨迹](traces/autonomous-r2-partial-stack.json) |
| required-r3-publish-local | 通过 | 0 | 3 | 9/9 | [轨迹](traces/required-r3-publish-local.json) |
| autonomous-r3-start-stack | 通过 | 6 | 11 | 0/0 | [轨迹](traces/autonomous-r3-start-stack.json) |
| required-r3-rollback-local | 通过 | 5 | 16 | 9/9 | [轨迹](traces/required-r3-rollback-local.json) |
| required-r3-partial-stack | 通过 | 0 | 3 | 9/9 | [轨迹](traces/required-r3-partial-stack.json) |
| autonomous-r3-stop-stack | 通过 | 7 | 12 | 0/0 | [轨迹](traces/autonomous-r3-stop-stack.json) |
| required-r4-start-and-edit | 通过 | 6 | 18 | 9/8 | [轨迹](traces/required-r4-start-and-edit.json) |
| autonomous-r3-restart-backend | 通过 | 5 | 10 | 0/0 | [轨迹](traces/autonomous-r3-restart-backend.json) |
| autonomous-r3-test-build | 通过 | 5 | 12 | 0/0 | [轨迹](traces/autonomous-r3-test-build.json) |
| required-r4-backend-failure | 通过 | 7 | 11 | 9/3 | [轨迹](traces/required-r4-backend-failure.json) |
| autonomous-r3-generate-client | 通过 | 3 | 12 | 0/0 | [轨迹](traces/autonomous-r3-generate-client.json) |
| required-r4-changed-script | 通过 | 7 | 15 | 9/1 | [轨迹](traces/required-r4-changed-script.json) |
| autonomous-r3-publish-local | 通过 | 7 | 28 | 0/0 | [轨迹](traces/autonomous-r3-publish-local.json) |
| autonomous-r3-rollback-local | 通过 | 6 | 27 | 0/0 | [轨迹](traces/autonomous-r3-rollback-local.json) |
| autonomous-r3-partial-stack | 通过 | 4 | 10 | 0/0 | [轨迹](traces/autonomous-r3-partial-stack.json) |
| autonomous-r4-start-and-edit | 通过 | 7 | 13 | 0/0 | [轨迹](traces/autonomous-r4-start-and-edit.json) |
| autonomous-r4-backend-failure | 通过 | 5 | 17 | 0/0 | [轨迹](traces/autonomous-r4-backend-failure.json) |
| autonomous-r4-changed-script | 通过 | 4 | 13 | 0/0 | [轨迹](traces/autonomous-r4-changed-script.json) |
