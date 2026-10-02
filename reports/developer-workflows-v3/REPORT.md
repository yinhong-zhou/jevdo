# 开发者工作流 v3 实验

完成 52 次真实 API 任务；52 次通过代码/状态、明确交付约束与 turn 完成检查。费用按记录费率估算 **5.5036 元**，包含学习和失败费用，不是供应商账单。自然语言检查是有限代理指标，不能代表完整语义质量。

## 实验设计

4 个普通操作：start-stack、test-build、publish-local、rollback-local。原生无插件 Loop 每种任务只测一次，两个插件组各三轮。每次使用新会话、重置源代码/输入/输出/服务初始状态；插件各自保留库和脚本，基线使用新工作区。所有组拿到相同现成脚本，不预置 Action。

随后各测 8 个探针：start-and-edit、start-script、start-script-again、test-edit-test、edit-generate-explain、no-save、explain-only、unknown-project。总数 52。脚本启动检查实际使用既有脚本；重复测试检查修改前后的源代码哈希；禁止保存检查库未变；解释任务检查最后确为主模型回复并包含所需主题。

“自主保存”指用户没有逐任务要求保存，插件仍有主动维护策略。新版比 V1 更明确鼓励沉淀常见稳定流程，允许跳过不适合者，遵守用户禁止保存。此次还一起修改了依赖描述、重放策略和 DONE 提示，因此不是单因素消融。

相比 V1，测试项目新增了现成完整启动脚本，测试事件也记录源码哈希。不能将版本差异全部归因于单条 prompt。三组使用相同新版项目、模型和限制。方案与源文件哈希见 [protocol.json](protocol.json)，每轮代码快照位于 source/，账本与约束核对见 [audit.json](audit.json)。

Final model ownership after model participation; adopt exactly matching current-request command evidence at activation instead of replaying side effects; honor explicit named script constraints. Focused regression covers four normal workflows and eight handoff/constraint probes, with a new once-per-task no-plugin baseline. V2 broad results and failures are preserved separately.

## 三轮结果

| 组别 | 轮次 | 成功 | 成功且零主模型 | 主模型调用 | Jev 调用 | 平均秒数 | 估算元 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 原生 Loop（无插件） | 1 | 4/4 | 0/4 | 31 | 0 | 9.54 | 0.2771 |
| 要求保存 | 1 | 4/4 | 0/4 | 30 | 60 | 17.20 | 0.8017 |
| 要求保存 | 2 | 4/4 | 1/4 | 17 | 45 | 12.34 | 0.5083 |
| 要求保存 | 3 | 4/4 | 1/4 | 13 | 39 | 11.21 | 0.3984 |
| 自主保存 | 1 | 4/4 | 0/4 | 33 | 63 | 19.52 | 0.8408 |
| 自主保存 | 2 | 4/4 | 3/4 | 8 | 35 | 6.89 | 0.3214 |
| 自主保存 | 3 | 4/4 | 3/4 | 8 | 31 | 6.64 | 0.3091 |

- 要求保存：三轮含学习成本 1.7084 元、主模型调用 60 次。
- 自主保存：三轮含学习成本 1.4713 元、主模型调用 49 次。

原生一轮费用乘三为 0.8312 元，仅为外推参考，不是三轮实测。并发会影响延迟。调用少不必然费用低，也不能只统计复用阶段而忽略学习成本。

## 自选混合与边界场景

| 组别 | 探针 | 状态检查 | 交付约束 | 主模型调用 | Jev 选择的已学习 Action |
|---|---|---|---|---:|---|
| 原生 Loop（无插件） | start-and-edit | 通过 | 通过 | 10 | 无 |
| 原生 Loop（无插件） | start-script | 通过 | 通过 | 6 | 无 |
| 原生 Loop（无插件） | start-script-again | 通过 | 通过 | 7 | 无 |
| 原生 Loop（无插件） | test-edit-test | 通过 | 通过 | 8 | 无 |
| 原生 Loop（无插件） | edit-generate-explain | 通过 | 通过 | 7 | 无 |
| 原生 Loop（无插件） | no-save | 通过 | 通过 | 2 | 无 |
| 原生 Loop（无插件） | explain-only | 通过 | 通过 | 4 | 无 |
| 原生 Loop（无插件） | unknown-project | 通过 | 通过 | 1 | 无 |
| 自主保存 | start-and-edit | 通过 | 通过 | 6 | start-stack → run-unit-tests → rebuild-project |
| 自主保存 | start-script | 通过 | 通过 | 0 | start-stack |
| 自主保存 | start-script-again | 通过 | 通过 | 0 | start-stack |
| 自主保存 | test-edit-test | 通过 | 通过 | 7 | run-unit-tests → run-unit-tests → rebuild-project |
| 要求保存 | start-and-edit | 通过 | 通过 | 5 | start-backend → start-frontend → run-unit-tests → rebuild-project |
| 自主保存 | edit-generate-explain | 通过 | 通过 | 7 | 无 |
| 要求保存 | start-script | 通过 | 通过 | 7 | 无 |
| 自主保存 | no-save | 通过 | 通过 | 2 | 无 |
| 要求保存 | start-script-again | 通过 | 通过 | 0 | start-full-stack |
| 自主保存 | explain-only | 通过 | 通过 | 3 | 无 |
| 自主保存 | unknown-project | 通过 | 通过 | 1 | 无 |
| 要求保存 | test-edit-test | 通过 | 通过 | 7 | run-unit-tests → run-unit-tests → rebuild-project |
| 要求保存 | edit-generate-explain | 通过 | 通过 | 6 | 无 |
| 要求保存 | no-save | 通过 | 通过 | 2 | 无 |
| 要求保存 | explain-only | 通过 | 通过 | 4 | 无 |
| 要求保存 | unknown-project | 通过 | 通过 | 1 | 无 |

“Jev 选择的 Action”与“主模型调用 Action”分别记录，不能混称自动接管。最终说明只做来源、存在性与主题关键词检查，完整回复仍保留供人工复核。失败、源文件变化和无绑定可能由主模型接手；任务成功不等于全过程都由 Jev 执行。

## 未通过项目

本轮检查未发现失败；小型项目单次采样仍不足以证明所有真实场景可靠。

## 限制

这是自建可执行项目的工程实验，每个格子一次采样，无统计显著性结论。支持跨任务在同一项目积累，未测试跨项目迁移、长期库膨胀或自动归档。提供既有脚本使两组都更容易完成任务，未评估从零编写复杂启动系统。发布只作用于本地测试目录。独立检查器不依赖 Action 自带 verifier，但有限断言和主题关键词不能覆盖所有语义错误。

## 全部运行

| 运行 | 结果 | 主模型 | Jev | 保存/有效 | 证据 |
|---|---|---:|---:|---:|---|
| official-clean-r1-start-stack | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-stack.json) |
| official-clean-r1-test-build | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-test-build.json) |
| required-r1-start-stack | 通过 | 8 | 18 | 2/2 | [轨迹](traces/required-r1-start-stack.json) |
| autonomous-r1-start-stack | 通过 | 6 | 24 | 1/1 | [轨迹](traces/autonomous-r1-start-stack.json) |
| official-clean-r1-publish-local | 通过 | 10 | 0 | 0/0 | [轨迹](traces/official-clean-r1-publish-local.json) |
| required-r1-test-build | 通过 | 8 | 14 | 4/4 | [轨迹](traces/required-r1-test-build.json) |
| official-clean-r1-rollback-local | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-rollback-local.json) |
| autonomous-r1-test-build | 通过 | 11 | 17 | 3/3 | [轨迹](traces/autonomous-r1-test-build.json) |
| required-r1-publish-local | 通过 | 6 | 15 | 5/5 | [轨迹](traces/required-r1-publish-local.json) |
| official-clean-r1-start-and-edit | 通过 | 10 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-and-edit.json) |
| autonomous-r1-publish-local | 通过 | 5 | 15 | 4/4 | [轨迹](traces/autonomous-r1-publish-local.json) |
| official-clean-r1-start-script | 通过 | 6 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-script.json) |
| required-r1-rollback-local | 通过 | 8 | 13 | 6/6 | [轨迹](traces/required-r1-rollback-local.json) |
| official-clean-r1-start-script-again | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-start-script-again.json) |
| autonomous-r1-rollback-local | 通过 | 11 | 7 | 5/4 | [轨迹](traces/autonomous-r1-rollback-local.json) |
| autonomous-r2-start-stack | 通过 | 0 | 3 | 5/4 | [轨迹](traces/autonomous-r2-start-stack.json) |
| required-r2-start-stack | 通过 | 4 | 12 | 6/6 | [轨迹](traces/required-r2-start-stack.json) |
| autonomous-r2-test-build | 通过 | 0 | 5 | 5/4 | [轨迹](traces/autonomous-r2-test-build.json) |
| official-clean-r1-test-edit-test | 通过 | 8 | 0 | 0/0 | [轨迹](traces/official-clean-r1-test-edit-test.json) |
| autonomous-r2-publish-local | 通过 | 0 | 12 | 5/4 | [轨迹](traces/autonomous-r2-publish-local.json) |
| official-clean-r1-edit-generate-explain | 通过 | 7 | 0 | 0/0 | [轨迹](traces/official-clean-r1-edit-generate-explain.json) |
| required-r2-test-build | 通过 | 5 | 11 | 6/6 | [轨迹](traces/required-r2-test-build.json) |
| official-clean-r1-no-save | 通过 | 2 | 0 | 0/0 | [轨迹](traces/official-clean-r1-no-save.json) |
| official-clean-r1-explain-only | 通过 | 4 | 0 | 0/0 | [轨迹](traces/official-clean-r1-explain-only.json) |
| official-clean-r1-unknown-project | 通过 | 1 | 0 | 0/0 | [轨迹](traces/official-clean-r1-unknown-project.json) |
| autonomous-r2-rollback-local | 通过 | 8 | 15 | 5/4 | [轨迹](traces/autonomous-r2-rollback-local.json) |
| autonomous-r3-start-stack | 通过 | 0 | 3 | 5/4 | [轨迹](traces/autonomous-r3-start-stack.json) |
| autonomous-r3-test-build | 通过 | 0 | 5 | 5/4 | [轨迹](traces/autonomous-r3-test-build.json) |
| required-r2-publish-local | 通过 | 8 | 19 | 6/6 | [轨迹](traces/required-r2-publish-local.json) |
| required-r2-rollback-local | 通过 | 0 | 3 | 6/6 | [轨迹](traces/required-r2-rollback-local.json) |
| autonomous-r3-publish-local | 通过 | 0 | 7 | 5/4 | [轨迹](traces/autonomous-r3-publish-local.json) |
| required-r3-start-stack | 通过 | 3 | 11 | 6/6 | [轨迹](traces/required-r3-start-stack.json) |
| autonomous-r3-rollback-local | 通过 | 8 | 16 | 5/5 | [轨迹](traces/autonomous-r3-rollback-local.json) |
| required-r3-test-build | 通过 | 6 | 10 | 6/6 | [轨迹](traces/required-r3-test-build.json) |
| autonomous-r4-start-and-edit | 通过 | 6 | 15 | 5/5 | [轨迹](traces/autonomous-r4-start-and-edit.json) |
| autonomous-r4-start-script | 通过 | 0 | 3 | 5/5 | [轨迹](traces/autonomous-r4-start-script.json) |
| autonomous-r4-start-script-again | 通过 | 0 | 3 | 5/5 | [轨迹](traces/autonomous-r4-start-script-again.json) |
| required-r3-publish-local | 通过 | 4 | 15 | 6/6 | [轨迹](traces/required-r3-publish-local.json) |
| required-r3-rollback-local | 通过 | 0 | 3 | 6/6 | [轨迹](traces/required-r3-rollback-local.json) |
| autonomous-r4-test-edit-test | 通过 | 7 | 16 | 5/5 | [轨迹](traces/autonomous-r4-test-edit-test.json) |
| required-r4-start-and-edit | 通过 | 5 | 18 | 6/6 | [轨迹](traces/required-r4-start-and-edit.json) |
| autonomous-r4-edit-generate-explain | 通过 | 7 | 13 | 6/6 | [轨迹](traces/autonomous-r4-edit-generate-explain.json) |
| required-r4-start-script | 通过 | 7 | 11 | 7/7 | [轨迹](traces/required-r4-start-script.json) |
| autonomous-r4-no-save | 通过 | 2 | 2 | 6/6 | [轨迹](traces/autonomous-r4-no-save.json) |
| required-r4-start-script-again | 通过 | 0 | 3 | 7/7 | [轨迹](traces/required-r4-start-script-again.json) |
| autonomous-r4-explain-only | 通过 | 3 | 6 | 6/6 | [轨迹](traces/autonomous-r4-explain-only.json) |
| autonomous-r4-unknown-project | 通过 | 1 | 1 | 6/6 | [轨迹](traces/autonomous-r4-unknown-project.json) |
| required-r4-test-edit-test | 通过 | 7 | 16 | 7/7 | [轨迹](traces/required-r4-test-edit-test.json) |
| required-r4-edit-generate-explain | 通过 | 6 | 12 | 8/8 | [轨迹](traces/required-r4-edit-generate-explain.json) |
| required-r4-no-save | 通过 | 2 | 2 | 8/8 | [轨迹](traces/required-r4-no-save.json) |
| required-r4-explain-only | 通过 | 4 | 4 | 8/8 | [轨迹](traces/required-r4-explain-only.json) |
| required-r4-unknown-project | 通过 | 1 | 1 | 8/8 | [轨迹](traces/required-r4-unknown-project.json) |
