# 参与 JevDo

简体中文 · [English](CONTRIBUTING.en.md)

欢迎提交可复用 Action 示例、问题复现、Loop 修复与文档改进。可以直接提交 Issue 或 PR；较大的行为变化请先说明具体场景和预期结果。

## 开发准备

需要 Node.js 24.14+；当前验证版本是 DSH 0.2.0-rc.1。先阅读 [AGENTS.md](AGENTS.md)、[实现参考](docs/REFERENCE.md) 和 [Action 规格](docs/ACTION_SPEC.md)。

```bash
npm ci
npm run check
npm test
npm run build
npm run demo
```

离线测试和 demo 不需要真实 API 密钥。真实实验需要配置密钥并产生费用；保留失败、用量和原始记录，分享前移除凭据和私人项目内容。

## 设计约定

- 保持这个仓库专注轻量 Action Loop。完整上下文、记忆与多 Agent 判断机制在 [JevDo Harness](https://github.com/yinhong-zhou/jevdo-harness) 中开发。
- Action 定义与项目绑定分离。Jev 选择有效候选，执行器检查范围、版本与实际效果。
- Action 先保存草稿，再验证激活；复杂操作优先使用项目维护的脚本。未知问题的分析仍交给主模型。
- 宿主工具权限和用户授权始终有效。保留完整的工具调用/结果配对。
- 作者提示、判断策略、模型接口和操作库与 Loop 保持分离。

## 提交问题与改动

[问题反馈](https://github.com/yinhong-zhou/jevdo/issues) 请包含操作系统、Node/DSH 版本、最小复现、预期与实际结果。涉及复用时，说明是首次执行还是已有 Action，并提供脱敏后的操作与验收定义。

PR 请描述行为变化与验证证据。代码改动运行检查并验证新的行为或修复的缺陷；纯文档改动检查链接、命令示例和事实即可。欢迎 AI 辅助开发，提交者需要理解并验证改动。

性能结论需说明对照组、任务数量、冷启动与复用条件，以及 Jev 和主模型的完整用量；可控 fixture、自建场景和公开基准应分别标明。

## 来源与上游协作

本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并适配了官方 Loop 生命周期。引入或更新上游代码时，保留版权、许可、来源版本与本地适配说明，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。原生 DSH 也能复现的问题，可遵循上游参与方式提供最小复现。
