# 交付核对

范围：以 DSH 官方框架和默认 Loop 为基座，交付 JevAction + Jev 决策循环插件，以及一组可复现的小规模实际 API 评测。

| 要求 | 当前实现 | 已检查的证据 |
|---|---|---|
| DSH 插件替换默认 Loop | bundle 禁用 agent-loop 并挂载 jevaction-loop | 原生 DSH 0.2.0-rc.1 插件安装、合成配置、实际 headless 运行 |
| 官方宿主基础能力 | 适配官方生命周期代码，调用宿主工具执行管线 | DSH 会话恢复、取消、工具拒绝与插件卸载集成测试 |
| 主模型保存 Action | create / validate / catalog / run 四个工具和自动注入的 authoring prompt | live-learning.json 中真实模型创建并激活的 recipe |
| 跨会话复用 | 持久化项目、定义、绑定及验证凭证 | 新 DSH host 的真实复用实验；新进程离线演示 |
| Jev 做选择并可省略主模型 | Action → 项目 → 可选文件候选选择，逐步决定回退或结束 | 正式评测 2 个零主模型调用任务；原生 CLI 保存动作执行 |
| 执行与验收 | 每个 recipe 有独立 verifier，实现指纹失效检查与成功执行凭证复用 | 变更脚本、错误目标、验收失败和交接后重复执行测试 |
| 简单有效评测 | 8 个合成任务、三组对照、独立目录与磁盘断言 | evaluation.json 共 24 次实际 API 运行，原始失败试验另外保留 |
| 可安装交付 | npm 包、README、元形式文档、第三方许可 | npm pack 成功，包清单未包含 .env、.runtime 或原始会话 |

当前代码通过 TypeScript 检查、20 个无密钥测试、构建和原生 DSH CLI smoke。评测汇总见 [RESULTS.md](../reports/RESULTS.md)。本地生成包为 `jevaction-0.1.0.tgz`。

首版验收范围是固定 DSH 版本下的 headless 流程。未验证完整 Web UI、多 Agent 和所有其他插件的组合兼容性。后台服务管理、任意自由参数和独立模型选择器未纳入本版。

正式评测完成后，对本地结果凭证的流式记录、文件原子发布和相同实现指纹的执行去重做了工程修正；完整离线测试和原生 CLI smoke 已重跑。三组评测数值来自报告中保留的实际运行，而不是对后续每次构建重复测量的性能承诺。

代码和 Git 仓库均已建立在本地，未推送到远程仓库，也未发布 npm。
