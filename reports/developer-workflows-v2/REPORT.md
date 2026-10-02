# 开发者工作流 v2 实验

完成 89 次真实 API 任务；87 次通过代码/状态、明确交付约束与 turn 完成检查。费用按记录费率估算 **9.1659 元**，包含学习和失败费用，不是供应商账单。自然语言检查是有限代理指标，不能代表完整语义质量。

## 实验设计

8 个普通操作：启动前后端、停止、重启后端、测试构建、生成客户端、本地发布、回滚、只补启动前端。原生无插件 Loop 每种任务只测一次，两个插件组各三轮。每次使用新会话、重置源代码/输入/输出/服务初始状态；插件各自保留库和脚本，基线使用新工作区。所有组拿到相同现成脚本，不预置 Action。

随后各测 11 个探针：混合代码编辑；完整启动脚本及其重复调用；变化的 schema；改 schema 后生成并解释；修改前后两次测试；不保存要求；只解释不执行；未知项目；启动失败；实现脚本变化。总数 89。脚本启动检查实际使用既有脚本；重复测试检查修改前后的源代码哈希；禁止保存检查库未变；解释任务检查最后确为主模型回复并包含所需主题。

“自主保存”指用户没有逐任务要求保存，插件仍有主动维护策略。新版比 V1 更明确鼓励沉淀常见稳定流程，允许跳过不适合者，遵守用户禁止保存。此次还一起修改了依赖描述、重放策略和 DONE 提示，因此不是单因素消融。

相比 V1，测试项目新增了现成完整启动脚本，测试事件也记录源码哈希。不能将版本差异全部归因于单条 prompt。三组使用相同新版项目、模型和限制。方案与源文件哈希见 [protocol.json](protocol.json)，每轮代码快照位于 source/，账本与约束核对见 [audit.json](audit.json)。

## 三轮结果

| 组别 | 轮次 | 成功 | 成功且零主模型 | 主模型调用 | Jev 调用 | 平均秒数 | 估算元 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 原生 Loop（无插件） | 1 | 8/8 | 0/8 | 59 | 0 | 9.08 | 0.4572 |
| 要求保存 | 1 | 7/8 | 1/8 | 58 | 106 | 15.00 | 1.7188 |
| 要求保存 | 2 | 8/8 | 6/8 | 9 | 47 | 5.23 | 0.4131 |
| 要求保存 | 3 | 8/8 | 6/8 | 8 | 46 | 4.63 | 0.3784 |
| 自主保存 | 1 | 8/8 | 0/8 | 42 | 124 | 12.28 | 1.1520 |
| 自主保存 | 2 | 8/8 | 0/8 | 55 | 144 | 15.69 | 1.5435 |
| 自主保存 | 3 | 8/8 | 2/8 | 29 | 78 | 8.02 | 0.7811 |

- 要求保存：三轮含学习成本 2.5103 元、主模型调用 75 次。
- 自主保存：三轮含学习成本 3.4767 元、主模型调用 126 次。

原生一轮费用乘三为 1.3716 元，仅为外推参考，不是三轮实测。并发会影响延迟。调用少不必然费用低，也不能只统计复用阶段而忽略学习成本。

## 自选混合与边界场景

| 组别 | 探针 | 状态检查 | 交付约束 | 主模型调用 | Jev 选择的已学习 Action |
|---|---|---|---|---:|---|
| 原生 Loop（无插件） | start-and-edit | 通过 | 通过 | 10 | 无 |
| 原生 Loop（无插件） | start-script | 通过 | 通过 | 5 | 无 |
| 原生 Loop（无插件） | start-script-again | 通过 | 通过 | 7 | 无 |
| 原生 Loop（无插件） | changed-schema | 通过 | 通过 | 5 | 无 |
| 原生 Loop（无插件） | edit-generate-explain | 通过 | 通过 | 9 | 无 |
| 原生 Loop（无插件） | test-edit-test | 通过 | 通过 | 8 | 无 |
| 原生 Loop（无插件） | no-save | 通过 | 通过 | 2 | 无 |
| 原生 Loop（无插件） | explain-only | 通过 | 通过 | 4 | 无 |
| 原生 Loop（无插件） | unknown-project | 通过 | 通过 | 1 | 无 |
| 原生 Loop（无插件） | backend-failure | 通过 | 通过 | 8 | 无 |
| 原生 Loop（无插件） | changed-script | 通过 | 通过 | 5 | 无 |
| 要求保存 | start-and-edit | 通过 | 通过 | 6 | start-full-stack → run-unit-tests → build-project |
| 要求保存 | start-script | 通过 | 通过 | 0 | start-full-stack |
| 要求保存 | start-script-again | 通过 | 通过 | 0 | start-full-stack |
| 要求保存 | changed-schema | 通过 | 通过 | 0 | generate-api-client |
| 要求保存 | edit-generate-explain | 通过 | 通过 | 4 | generate-api-client |
| 要求保存 | test-edit-test | 通过 | 通过 | 4 | run-unit-tests → run-unit-tests → build-project |
| 要求保存 | no-save | 通过 | 通过 | 2 | 无 |
| 要求保存 | explain-only | 通过 | 通过 | 4 | 无 |
| 要求保存 | unknown-project | 通过 | 通过 | 1 | 无 |
| 要求保存 | backend-failure | 通过 | 通过 | 6 | start-full-stack |
| 要求保存 | changed-script | 通过 | 通过 | 5 | 无 |
| 自主保存 | start-and-edit | 通过 | 通过 | 11 | 无 |
| 自主保存 | start-script | 失败 | 通过 | 1 | start-backend → start-frontend |
| 自主保存 | start-script-again | 通过 | 通过 | 3 | 无 |
| 自主保存 | changed-schema | 通过 | 通过 | 0 | generate-api-client |
| 自主保存 | edit-generate-explain | 通过 | 通过 | 4 | generate-api-client |
| 自主保存 | test-edit-test | 通过 | 通过 | 2 | test-and-build → test-and-build |
| 自主保存 | no-save | 通过 | 通过 | 2 | 无 |
| 自主保存 | explain-only | 通过 | 通过 | 5 | 无 |
| 自主保存 | unknown-project | 通过 | 通过 | 1 | 无 |
| 自主保存 | backend-failure | 通过 | 通过 | 6 | start-backend |
| 自主保存 | changed-script | 通过 | 通过 | 6 | 无 |

“Jev 选择的 Action”与“主模型调用 Action”分别记录，不能混称自动接管。最终说明只做来源、存在性与主题关键词检查，完整回复仍保留供人工复核。失败、源文件变化和无绑定可能由主模型接手；任务成功不等于全过程都由 Jev 执行。

## 未通过项目

- required-r1-rollback-local: AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'release-current'
- 'release-old'
           ^

- autonomous-r4-start-script: AssertionError [ERR_ASSERTION]: Must invoke the existing full-stack script

## 限制

这是自建可执行项目的工程实验，每个格子一次采样，无统计显著性结论。支持跨任务在同一项目积累，未测试跨项目迁移、长期库膨胀或自动归档。提供既有脚本使两组都更容易完成任务，未评估从零编写复杂启动系统。发布只作用于本地测试目录。独立检查器不依赖 Action 自带 verifier，但有限断言和主题关键词不能覆盖所有语义错误。

## 全部运行

| 运行 | 结果 | 主模型 | Jev | 保存/有效 | 证据 |
|---|---|---:|---:|---:|---|
| official-clean-r1-start-stack | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-stack.json) |
| autonomous-r1-start-stack | 通过 | 6 | 12 | 0/0 | [轨迹](traces/autonomous-r1-start-stack.json) |
| required-r1-start-stack | 通过 | 7 | 13 | 3/3 | [轨迹](traces/required-r1-start-stack.json) |
| official-clean-r1-stop-stack | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-stop-stack.json) |
| autonomous-r1-stop-stack | 通过 | 6 | 11 | 0/0 | [轨迹](traces/autonomous-r1-stop-stack.json) |
| official-clean-r1-restart-backend | 通过 | 6 | 0 | 0/0 | [轨迹](traces/official-clean-r1-restart-backend.json) |
| required-r1-stop-stack | 通过 | 10 | 15 | 5/5 | [轨迹](traces/required-r1-stop-stack.json) |
| autonomous-r1-restart-backend | 通过 | 5 | 23 | 0/0 | [轨迹](traces/autonomous-r1-restart-backend.json) |
| official-clean-r1-test-build | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-test-build.json) |
| official-clean-r1-generate-client | 通过 | 5 | 0 | 0/0 | [轨迹](traces/official-clean-r1-generate-client.json) |
| autonomous-r1-test-build | 通过 | 5 | 14 | 0/0 | [轨迹](traces/autonomous-r1-test-build.json) |
| required-r1-restart-backend | 通过 | 8 | 13 | 6/6 | [轨迹](traces/required-r1-restart-backend.json) |
| autonomous-r1-generate-client | 通过 | 3 | 12 | 0/0 | [轨迹](traces/autonomous-r1-generate-client.json) |
| official-clean-r1-publish-local | 通过 | 11 | 0 | 0/0 | [轨迹](traces/official-clean-r1-publish-local.json) |
| official-clean-r1-rollback-local | 通过 | 6 | 0 | 0/0 | [轨迹](traces/official-clean-r1-rollback-local.json) |
| required-r1-test-build | 通过 | 8 | 13 | 8/8 | [轨迹](traces/required-r1-test-build.json) |
| official-clean-r1-partial-stack | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-partial-stack.json) |
| autonomous-r1-publish-local | 通过 | 8 | 28 | 1/0 | [轨迹](traces/autonomous-r1-publish-local.json) |
| required-r1-generate-client | 通过 | 6 | 12 | 9/9 | [轨迹](traces/required-r1-generate-client.json) |
| autonomous-r1-rollback-local | 通过 | 4 | 13 | 1/0 | [轨迹](traces/autonomous-r1-rollback-local.json) |
| official-clean-r1-start-and-edit | 通过 | 10 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-and-edit.json) |
| official-clean-r1-start-script | 通过 | 5 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-script.json) |
| autonomous-r1-partial-stack | 通过 | 5 | 11 | 1/0 | [轨迹](traces/autonomous-r1-partial-stack.json) |
| required-r1-publish-local | 通过 | 12 | 22 | 10/10 | [轨迹](traces/required-r1-publish-local.json) |
| official-clean-r1-start-script-again | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-script-again.json) |
| autonomous-r2-start-stack | 通过 | 7 | 15 | 1/0 | [轨迹](traces/autonomous-r2-start-stack.json) |
| official-clean-r1-changed-schema | 通过 | 5 | 0 | 0/0 | [轨迹](traces/official-clean-r1-changed-schema.json) |
| required-r1-rollback-local | 未通过 | 7 | 15 | 11/11 | [轨迹](traces/required-r1-rollback-local.json) |
| required-r1-partial-stack | 通过 | 0 | 3 | 11/11 | [轨迹](traces/required-r1-partial-stack.json) |
| autonomous-r2-stop-stack | 通过 | 6 | 11 | 1/0 | [轨迹](traces/autonomous-r2-stop-stack.json) |
| official-clean-r1-edit-generate-explain | 通过 | 9 | 0 | 0/0 | [轨迹](traces/official-clean-r1-edit-generate-explain.json) |
| required-r2-start-stack | 通过 | 1 | 6 | 11/11 | [轨迹](traces/required-r2-start-stack.json) |
| required-r2-stop-stack | 通过 | 0 | 5 | 11/11 | [轨迹](traces/required-r2-stop-stack.json) |
| official-clean-r1-test-edit-test | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-test-edit-test.json) |
| required-r2-restart-backend | 通过 | 0 | 3 | 11/11 | [轨迹](traces/required-r2-restart-backend.json) |
| autonomous-r2-restart-backend | 通过 | 5 | 14 | 1/0 | [轨迹](traces/autonomous-r2-restart-backend.json) |
| official-clean-r1-no-save | 通过 | 2 | 0 | 0/0 | [轨迹](traces/official-clean-r1-no-save.json) |
| required-r2-test-build | 通过 | 0 | 5 | 11/11 | [轨迹](traces/required-r2-test-build.json) |
| required-r2-generate-client | 通过 | 0 | 3 | 11/11 | [轨迹](traces/required-r2-generate-client.json) |
| official-clean-r1-explain-only | 通过 | 4 | 0 | 0/0 | [轨迹](traces/official-clean-r1-explain-only.json) |
| official-clean-r1-unknown-project | 通过 | 1 | 0 | 0/0 | [轨迹](traces/official-clean-r1-unknown-project.json) |
| autonomous-r2-test-build | 通过 | 6 | 14 | 1/0 | [轨迹](traces/autonomous-r2-test-build.json) |
| official-clean-r1-backend-failure | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-backend-failure.json) |
| official-clean-r1-changed-script | 通过 | 5 | 0 | 0/0 | [轨迹](traces/official-clean-r1-changed-script.json) |
| required-r2-publish-local | 通过 | 8 | 19 | 12/11 | [轨迹](traces/required-r2-publish-local.json) |
| autonomous-r2-generate-client | 通过 | 7 | 25 | 2/1 | [轨迹](traces/autonomous-r2-generate-client.json) |
| required-r2-rollback-local | 通过 | 0 | 3 | 12/11 | [轨迹](traces/required-r2-rollback-local.json) |
| required-r2-partial-stack | 通过 | 0 | 3 | 12/11 | [轨迹](traces/required-r2-partial-stack.json) |
| required-r3-start-stack | 通过 | 3 | 8 | 12/11 | [轨迹](traces/required-r3-start-stack.json) |
| required-r3-stop-stack | 通过 | 0 | 5 | 12/11 | [轨迹](traces/required-r3-stop-stack.json) |
| required-r3-restart-backend | 通过 | 0 | 3 | 12/11 | [轨迹](traces/required-r3-restart-backend.json) |
| required-r3-test-build | 通过 | 0 | 5 | 12/11 | [轨迹](traces/required-r3-test-build.json) |
| autonomous-r2-publish-local | 通过 | 11 | 31 | 2/2 | [轨迹](traces/autonomous-r2-publish-local.json) |
| required-r3-generate-client | 通过 | 0 | 3 | 12/11 | [轨迹](traces/required-r3-generate-client.json) |
| required-r3-publish-local | 通过 | 5 | 16 | 12/12 | [轨迹](traces/required-r3-publish-local.json) |
| required-r3-rollback-local | 通过 | 0 | 3 | 12/12 | [轨迹](traces/required-r3-rollback-local.json) |
| autonomous-r2-rollback-local | 通过 | 8 | 23 | 3/2 | [轨迹](traces/autonomous-r2-rollback-local.json) |
| required-r3-partial-stack | 通过 | 0 | 3 | 12/12 | [轨迹](traces/required-r3-partial-stack.json) |
| autonomous-r2-partial-stack | 通过 | 5 | 11 | 3/2 | [轨迹](traces/autonomous-r2-partial-stack.json) |
| required-r4-start-and-edit | 通过 | 6 | 15 | 12/12 | [轨迹](traces/required-r4-start-and-edit.json) |
| required-r4-start-script | 通过 | 0 | 3 | 12/12 | [轨迹](traces/required-r4-start-script.json) |
| autonomous-r3-start-stack | 通过 | 8 | 13 | 3/2 | [轨迹](traces/autonomous-r3-start-stack.json) |
| required-r4-start-script-again | 通过 | 0 | 3 | 12/12 | [轨迹](traces/required-r4-start-script-again.json) |
| required-r4-changed-schema | 通过 | 0 | 3 | 12/12 | [轨迹](traces/required-r4-changed-schema.json) |
| autonomous-r3-stop-stack | 通过 | 7 | 12 | 3/2 | [轨迹](traces/autonomous-r3-stop-stack.json) |
| required-r4-edit-generate-explain | 通过 | 4 | 11 | 12/12 | [轨迹](traces/required-r4-edit-generate-explain.json) |
| autonomous-r3-restart-backend | 通过 | 3 | 8 | 3/2 | [轨迹](traces/autonomous-r3-restart-backend.json) |
| autonomous-r3-test-build | 通过 | 1 | 8 | 3/2 | [轨迹](traces/autonomous-r3-test-build.json) |
| required-r4-test-edit-test | 通过 | 4 | 14 | 12/12 | [轨迹](traces/required-r4-test-edit-test.json) |
| autonomous-r3-generate-client | 通过 | 0 | 8 | 3/2 | [轨迹](traces/autonomous-r3-generate-client.json) |
| required-r4-no-save | 通过 | 2 | 2 | 12/12 | [轨迹](traces/required-r4-no-save.json) |
| autonomous-r3-publish-local | 通过 | 0 | 8 | 3/2 | [轨迹](traces/autonomous-r3-publish-local.json) |
| required-r4-explain-only | 通过 | 4 | 4 | 12/12 | [轨迹](traces/required-r4-explain-only.json) |
| required-r4-unknown-project | 通过 | 1 | 1 | 12/12 | [轨迹](traces/required-r4-unknown-project.json) |
| autonomous-r3-rollback-local | 通过 | 5 | 11 | 3/3 | [轨迹](traces/autonomous-r3-rollback-local.json) |
| required-r4-backend-failure | 通过 | 6 | 2 | 12/12 | [轨迹](traces/required-r4-backend-failure.json) |
| autonomous-r3-partial-stack | 通过 | 5 | 10 | 3/3 | [轨迹](traces/autonomous-r3-partial-stack.json) |
| required-r4-changed-script | 通过 | 5 | 10 | 12/1 | [轨迹](traces/required-r4-changed-script.json) |
| autonomous-r4-start-and-edit | 通过 | 11 | 16 | 8/6 | [轨迹](traces/autonomous-r4-start-and-edit.json) |
| autonomous-r4-start-script | 未通过 | 1 | 11 | 8/6 | [轨迹](traces/autonomous-r4-start-script.json) |
| autonomous-r4-start-script-again | 通过 | 3 | 9 | 8/6 | [轨迹](traces/autonomous-r4-start-script-again.json) |
| autonomous-r4-changed-schema | 通过 | 0 | 3 | 8/6 | [轨迹](traces/autonomous-r4-changed-schema.json) |
| autonomous-r4-edit-generate-explain | 通过 | 4 | 11 | 8/6 | [轨迹](traces/autonomous-r4-edit-generate-explain.json) |
| autonomous-r4-test-edit-test | 通过 | 2 | 12 | 8/6 | [轨迹](traces/autonomous-r4-test-edit-test.json) |
| autonomous-r4-no-save | 通过 | 2 | 2 | 8/6 | [轨迹](traces/autonomous-r4-no-save.json) |
| autonomous-r4-explain-only | 通过 | 5 | 5 | 8/6 | [轨迹](traces/autonomous-r4-explain-only.json) |
| autonomous-r4-unknown-project | 通过 | 1 | 1 | 8/6 | [轨迹](traces/autonomous-r4-unknown-project.json) |
| autonomous-r4-backend-failure | 通过 | 6 | 2 | 8/6 | [轨迹](traces/autonomous-r4-backend-failure.json) |
| autonomous-r4-changed-script | 通过 | 6 | 15 | 8/0 | [轨迹](traces/autonomous-r4-changed-script.json) |
