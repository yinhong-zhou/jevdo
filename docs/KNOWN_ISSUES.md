# 已知问题

<a id="jevdo-001"></a>
## JEVDO-001：完成非幂等操作后，补写验证脚本可能阻止 Action 激活

**状态：待修复。** 来源：轻量 JevDo developer-workflows-v3 自主保存组的 `rollback-local`。当前最终展示将回滚从三任务汇总中排除，历史运行与费用保留；排除不代表问题已修复。

### 实际表现

1. 主模型执行 `node dev.mjs rollback`，任务效果正确。
2. 模型再创建 `verify-rollback.mjs`、运行验证，并保存 `rollback-release-v1`。
3. `jevaction_validate` 尝试采用本轮先前的执行证据。中间发生的写入与其他命令使证据匹配失效。
4. 回滚不可随意重复：再次执行可能将版本切回去。运行时拒绝为了激活 Action 重做操作，返回错误并保留草稿。
5. 第一、二轮结束时 Action 未激活，之后的任务继续付出主模型和 Jev 判断费用；第三轮才激活。

原生 DSH 完成回滚需要 7 次主模型调用；自主组前三轮为 11 / 8 / 8 次。该差异与本项目的 Action 沉淀链路有关。评测重置没有删除验证脚本，不能归因为外部文件丢失。

### 相关实现

- `src/dsh/observed-execution.ts` 的 `findObservedExecution` 对未知插入操作清除已有证据，策略保守。
- `src/dsh/runtime.ts` 的 `jevaction_validate` 防止在证据不可采用时重复非幂等步骤。
- `src/controller.ts` 仍可能反复选择没有可用项目绑定的 Action，再请求主模型处理。

### 修复验收目标

- 能识别安全的补充验证情形，或引导模型先准备 verifier 再执行一次操作。
- 执行证据必须来自宿主真实调用；与目标状态有关的未知修改仍应使旧证据失效。
- 为同一请求激活 Action 不得重复回滚，必须核对最终发布指针和执行次数。
- 可复用性未变化时，避免无意义地重复选择未就绪的绑定。
- 用原始回滚场景重跑，报告首次激活与下一会话复用结果；不能仅靠删掉检查条件通过。

### 原始证据

- [第一轮](../reports/developer-workflows-v3/traces/autonomous-r1-rollback-local.json)
- [第二轮](../reports/developer-workflows-v3/traces/autonomous-r2-rollback-local.json)
- [第三轮](../reports/developer-workflows-v3/traces/autonomous-r3-rollback-local.json)
- [费用拆解](../reports/developer-workflows-v3/COST_BREAKDOWN.md)
- [三任务最终展示结果](../reports/developer-workflows-v3/FINAL_RESULTS.md)
