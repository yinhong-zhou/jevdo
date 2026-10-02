# JevDo 配置与实现参考

[返回项目首页](../README.md) · [Action 规格](ACTION_SPEC.md) · [使用场景](ACTION_USAGE.md)

## 使用形式

当前兼容 **DSH 0.2.0-rc.1、Node.js 24.14+**，第一版重点覆盖 headless 使用。保存规则与更多协作示例见 [Action 使用说明](ACTION_USAGE.md)。

包名、插件 ID 和工具前缀目前保留 `jevaction`。官方 Loop 生命周期适配代码及 MIT 版权声明保留在仓库中，详见 [第三方来源](../THIRD_PARTY_NOTICES.md)。

## 已实现

- 替换 DSH 默认 Loop，在每一步请求主模型前运行 Jev 决策；主模型仍可正常调用全部宿主工具。
- Jev 与主模型使用同一次请求组装好的完整会话、工具及工具历史；Jev 额外收到选择问题与候选动作。Action 执行结果回到共同历史。
- 项目注册表、Action 定义、项目专属 recipe、验证凭证分开持久化。重开会话/进程后可继续复用。
- 主模型通过 `jevaction_create` 保存草稿、`jevaction_validate` 验证并激活；prompt 由插件自动注册，指导它主动维护常用操作，不需要用户另装 skill。能够精确匹配本轮已成功执行的工具调用时，激活只检查效果，不重复命令。
- 同一种 Action 可以绑定多个项目的不同命令。项目参数来自注册表；内置读取文件动作的文件参数来自当前文件枚举。
- recipe 包含固定 executable/argv、工作目录、超时、验收命令、实现依赖与重做策略。实现依赖允许为空，直接命令无需脚本。Jev 只能选已有 ID；不能生成任意命令或填入没有来源的参数。
- 所有插件执行经过 DSH ToolRuntime。保存操作的每条命令再经过宿主 `pwsh` / `bash` 工具，继续应用宿主权限和沙箱。
- Jev 直接选择 Action、LLM、ASK 或 DONE；置信度仅记录，不设置统一否决阈值。验证失败、无效响应、Jev 请求失败、实现文件变化回退到主模型。纯 Action 请求可直接 DONE；主模型一旦参与，本轮最终收尾交还主模型，Jev 仍可执行中间步骤。
- 默认同一输入内复用同版本成功凭证，避免重复副作用；声明 `if_not_satisfied` 的可重复操作再次被选中时先复查，结果失效则重做，支持改代码前后调用同一个测试 Action。并发相同调用共享执行。
- 使用官方流式输出、消息队列、取消和会话恢复机制；独立测试覆盖取消 Jev、恢复 Action 会话及插件卸载。

## 本地准备

```powershell
npm ci
Copy-Item .env.example .env  # 仅当 .env 尚不存在时执行
# 在 .env 配置 TYPESAFE_API_KEY、DEEPSEEK_API_KEY 和模型端点
npm run doctor
npm run check
npm test
npm run build
```

`.env` 不进入 Git 或 npm 包。本仓库的实验 CLI 读取它；DSH 原生启动时请把相关变量放进启动环境，主模型沿用 DSH 的模型配置。插件本身不替换主模型适配器。

## 作为 DSH 插件安装

先 `npm run build`，然后使用 **0.2.0-rc.1** 的 DSH 创建一个独立 profile：

```powershell
dsh --profile jevaction --from-default-profile headless --dump-config
dsh plugin --profile jevaction add C:/你的路径/jevaction
dsh --profile jevaction "检查这个项目，把适合重复使用的操作保存为 Action"
```

bundle 会禁用 `agent-loop` 行，插入 `jevaction-loop` 行。headless 会通过 `ctx.agents` 创建 Agent。若原 profile 在默认 Loop 的 `config.agents` 中声明了启动 Agent，请把这些声明移至 `jevaction-loop` 的 config；它们不会自动迁移。

可选 profile patch：

```yaml
- id: jevaction-loop
  config:
    home: C:/Users/your-name/.dsh/jevaction
    enabled: true
    apiKeyEnv: TYPESAFE_API_KEY
    endpoint: https://api.typesafe.ai/v1/systemone
    model: jev-latest
    commandMode: pwsh
    commandTool: pwsh
    agents: []
```

Linux/macOS 默认使用宿主 `bash`；Windows 默认使用 `pwsh`。第一版实测平台为 Windows。`enabled: false` 关闭 Jev 路由，保留 Action 工具供主模型调用。默认 Action 目录为环境变量 `JEV_ACTION_HOME` 或用户目录下的 `.dsh/jevaction`。原生 DSH 中请为跨项目共享配置绝对路径；相对路径会按 DSH 的启动目录解析。

## 一个完整使用过程

第一次：“阅读这个项目，把生成报表并验证结果的操作保存下来，并运行一次。”

主模型阅读实现，调用 `jevaction_create` 保存命令或脚本绑定和 verifier，再调用 `jevaction_validate`。验证成功才激活。它会得到主动维护稳定开发操作的提示，仍可跳过不适合的内容，并遵守“不保存”的用户要求。如果本轮已执行相同命令，运行时会尝试精确匹配工具证据后只做验收。

下次：“重新生成一下这个项目的报表。”

Jev 选择 Action → 选择已注册项目 → 代码补全项目对应的命令 → DSH 执行和验证 → Jev 判断结束还是需要主模型。如果整个请求已有充分的执行证据，就展示固定格式的结果凭证，不再请求主模型润色。

普通数据更新不应该使生成报表的操作失效；需要监测的是实现脚本、依赖配置等决定步骤含义的文件。verifier 每次针对当前数据检查实际输出。

## 演示与评测

```powershell
npm run demo             # 无 API；两个新进程通过真实 DSH Loop 复用磁盘 Action
npm run eval             # 真实 Jev + 主模型，8 个任务 × 3 组
npm run eval:learning    # 主模型真实入库，再以新会话复用
npm run eval:report
```

也可通过实验 CLI 操作自己的已授权项目：

```powershell
npm start -- register demo C:/work/demo "我的演示项目"
npm start -- ask demo "检查这个项目的构建方式"
npm start -- list
```

实验 CLI 使用 DSH 核心服务和一个本地 argv 执行工具。它不具备原生 DSH profile 的完整 OS 沙箱；正式使用建议安装插件到自己的 DSH profile。

实际数据与限制见 [评测报告](../reports/RESULTS.md)。当前证据支持“部分重复操作可以减少主模型调用”，不支持对任意任务宣称更快、更便宜或效果更好。

开发者场景已完成 65 次真实任务：无插件原生 Loop 每个普通任务一次，两种 Action 保存策略各三轮；另加入混合修改任务、启动失败和脚本变更。所有组拿到相同现成脚本，不预置 Action。明确要求保存的组在第二、三轮各有 5/8 个普通任务零主模型调用；自主保存组未建立 Action。代码/状态检查全部通过，语义交付仍有不足；累计三轮费用尚未低于对照外推值。见 [完整报告](../reports/developer-workflows/REPORT.md) 与 [结果解释](../reports/developer-workflows/ANALYSIS.md)。

```powershell
npm run eval:developer          # 只保存方案，不调用模型
npm run eval:developer -- --live # 新实验目录中运行；记录费用，不设金额上限
npm run eval:developer:report   # 完成后检查账本、实验输入和凭据泄漏，生成报告
```

运行器拒绝覆盖已有实测结果。历史数据实验的预算与开发者实验分别记账。

后续 [V2 广覆盖](../reports/developer-workflows-v2/REPORT.md) 完成 89 次（87 次通过），暴露了重复回滚和未使用指定脚本的问题。修复后的 [V3 重点回归](../reports/developer-workflows-v3/REPORT.md) 完成 52 次，全部通过当前检查：自主保存组后两轮各 3/4 个普通任务零主模型，混合修改和重复测试也已跑通。但总体费用尚未低于原生对照，并有误选后回退，见 [当前结果解释](../reports/developer-workflows-v3/ANALYSIS.md)。默认运行入口指向 V3，历史报告可用 `npm run eval:developer:report -- --revision=v2` 或 `--revision=v1` 重建；新付费试验必须使用新目录。

另有 [公开任务衍生的复用实验](../reports/reuse-subset/REPORT.md)：从 Terminal-Bench 2.1 的三个任务规格构建小型输入，分别观察“明确要求保存”和“未明确要求保存”，再在新会话、新输入上比较官方 Loop 与 Jev Loop。它不是官方 Terminal-Bench 子集成绩；来源、修改范围、生成数据和对照条件写在 [实验方案](../reports/reuse-subset/protocol.json)。

```powershell
npm run eval:subset          # 只准备公开任务规格与方案，不调用付费模型
npm run eval:subset -- --live # 全新实验时使用；每次请求前预留预算，9 元处停止
npm run eval:subset:report   # 从已保存结果生成报告，不调用模型
```

预算账本包含学习、复用、失败和数据修正的重测费用。脚本拒绝覆盖已有实测账本或静默重复运行；本轮限额为 10 元人民币，使用官方 DeepSeek Flash 和 Jev。数据、脚本与 Action 来自同一学习快照，两种 Loop 的每次测试都从该快照恢复，测试之间不传递新学到的内容。

## 代码入口

| 文件 | 责任 |
|---|---|
| `src/dsh/index.ts` | Cordis 插件、prompt、工具和 Loop 的组装 |
| `src/dsh/policy.ts` | 每步 Jev 决策与主模型交接 |
| `src/dsh/runtime.ts` | Action 工具、宿主权限通道、重复执行保护 |
| `src/controller.ts` | Action → 项目 → 文件的候选选择 |
| `src/contracts.ts` | Action / recipe / project 数据结构 |
| `src/store.ts`、`src/executor.ts` | 持久化、指纹、验证与执行 |
| `prompts/action-authoring.md` | 主模型沉淀 Action 的策略 |
| `src/vendor/dsh-loop` | 固定版本官方 Loop 的适配副本和来源声明 |
| `src/dsh/host.ts` | 演示、测试和评测的 DSH 最小宿主 |

原始宿主会话保留用户输入和 Action 执行观察，普通模型工具调用使用原生 call/result 记录。Jev 判断及直接调用的详细审计记录位于 Action 目录的 `events.jsonl`，以 sessionId 关联。避免向 DSH 写入其当前版本无法恢复的自定义事件类型。

## 第一版边界

- 可学习的 recipe 目前是“固定操作 + 项目参数”；文件选择是内置动作的第二级参数。任意字符串参数和自动学习参数生成器不在本版中。可以调用启动后台服务并返回就绪状态的项目脚本；Loop 本身不管理任意长期进程。
- 置信度阈值不等于正确性保证，成功 verifier 也不等于完整任务必然完成。因此保留回退，并使用独立磁盘断言评测。
- 同一用户输入内，默认副作用操作的成功结果会复用；可重复状态操作可通过 `if_not_satisfied` 复查和重做。verifier 质量直接影响旧结果是否被正确判为失效。
- 已执行命令的证据复用仅支持精确匹配的 argv 或简单/规范生成的宿主 shell 命令，以及本轮无未知修改的连续证据。不会解析任意 shell 程序或信任模型声称“做过了”；无法确认的副作用保留草稿，避免仅为激活而重跑。
- 已验证固定版本的 headless、取消、持久化恢复和卸载；不声明全部 DSH 插件、Web UI、多 Agent、压缩流程和未来版本都完全兼容。
- 不做模型训练、多模型自动选择、MU 通信网关、独立预算调度或上下文筛选。

参考和第三方许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
