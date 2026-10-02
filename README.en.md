<p align="center">
  <img src="assets/brand/jevdo-icon.png" width="112" alt="JevDo">
</p>

<h1 align="center">JevDo</h1>

<p align="center"><strong>The model is a tool now.</strong></p>
<p align="center">
  A new harness architecture with Jev at its core.<br>
  Actions preserve experience · Jev decides what comes next · The main model is one option
</p>
<p align="center"><em>Just Jev it.</em></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-d8c9ed?style=flat-square&amp;labelColor=eee8f6" alt="MIT license"></a>
  <a href="docs/REFERENCE.md"><img src="https://img.shields.io/badge/DSH-0.2.0--rc.1-c8cdf2?style=flat-square&amp;labelColor=e9eafb" alt="DSH 0.2.0-rc.1"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-24.14%2B-c6e3f3?style=flat-square&amp;labelColor=e7f1f8" alt="Node.js 24.14+"></a>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b>
</p>
<p align="center">
  <a href="#the-handoff-in-practice">Use cases</a> · <a href="#quick-start">Quick start</a> · <a href="#the-loop">The loop</a> · <a href="#early-results">Results</a> · <a href="CONTRIBUTING.en.md">Contributing</a>
</p>

**Why think through an operation you already know how to do?** Read the config, find the script, assemble the command, inspect the result. JevDo asks a question before calling the main model: do we already know how to do this? Jev selects reusable operations when they fit and calls the main model for new work. As that model solves problems, it saves suitable operations as verified **Actions**, ready for another session.

## The handoff in practice

Three illustrative workflows, assuming the project already has the corresponding validated Actions.

**① Fix a bug**

“Start the backend, fix the order-list pagination bug, then run unit tests and build.”

```text
Jev    Start dependencies and services; check readiness  [start-admin-backend]
  ↓
Model  Read the issue, locate and fix the pagination bug
  ↓
Jev    Test, build, verify exit codes and artifacts      [test-and-build]
  ↓
Model  Explain the fix and verification results
```

**② Fix a failing CI check**

“CI lint failed again. Reproduce it locally, fix it, and verify it passes.”

```text
Jev    Prepare dependencies; reproduce lint with CI config  [repro-ci-lint]
  ↓
Model  Fix the reported errors
  ↓
Jev    Rerun lint and pre-push checks                       [verify-before-push]
  ↓
Model  Explain the changes and suggest a commit message
```

**③ Prepare a release**

“Run the release workflow: version, changelog, tag, and build artifacts.”

```text
Jev    Run regression tests; check release conditions    [regression-gate]
  ↓
Model  Review merged changes; update version and CHANGELOG
  ↓
Jev    Run the project script to tag, build, and verify   [cut-release]
  ↓
Model  Draft the release notes
```

**Jev schedules repeatable operations; the main model handles new problems.** A full start → code edit → test/build handoff has [run in our experiments](reports/developer-workflows-v3/ANALYSIS.md). When existing Actions cover the entire request and completion checks pass, Jev can finish requests such as “start the project” or “run regression tests” with **zero main-model calls**.

## The loop

- **Jev decides what happens next.** It receives the same assembled conversation and tool history as the main model, then selects an Action, a model call, clarification, or completion.
- **Actions preserve how to act.** A command or script, its purpose, project binding, and verifier. Simple commands stay simple; complex repeatable workflows are usually better kept in scripts.
- **The main model solves new problems and maintains the library.** It writes code, reasons, handles failures, and saves reusable operations while working.

> Built on DeepSeek Harness. Early release, focused on headless DSH 0.2.0-rc.1. Package and tool names retain `jevaction`. Once the main model participates, it owns the final response.

```mermaid
flowchart LR
    U["Task and conversation"] --> J{"Jev"}
    J -->|Existing Action| A["Harness execution and verification"]
    J -->|New work or failure| M["Main model"]
    A --> H["Results in shared history"]
    M -->|Tool calls and results| H
    H --> J
    M -.->|Save and validate| K[("Action library")]
    K -.->|Available operations| J
    classDef judge fill:#ede8ff,stroke:#9b8deb,color:#302653
    classDef model fill:#eef3ff,stroke:#5171ae,color:#162b50
    class J judge
    class M model
```

Jev selects; code executes. Candidates have registered IDs and concrete parameter sources. Commands still pass through host permissions and verification. Missing bindings, changed implementations, and execution failures return control to the main model.

## Learning an Action

The main model inspects the project, saves an operation through `jevaction_create`, and validates it through `jevaction_validate`. The plugin supplies authoring guidance automatically, including proactive maintenance and explicit user requests not to save.

In another session, Jev selects the Action and project. The harness fills in the stored execution parameters, runs the operation, and checks its effect. A successful operation may still leave reasoning or editing work for the main model.

Action definitions, project bindings, implementation fingerprints, and validation receipts are persisted separately. Implementation changes require revalidation; ordinary input changes are handled by effect verification. See the [specification](docs/ACTION_SPEC.md) and [usage guide](docs/ACTION_USAGE.md) (Chinese).

## Early results

Four repeated developer tasks: start services, test/build, publish locally, and roll back. Every arm receives the same existing scripts. Libraries start empty. The unmodified DSH loop runs each task once in the same minimal headless host. JevDo runs three rounds with identical inputs, fresh sessions, and a persistent Action library.

| Per four tasks | Native loop | JevDo round 1 | Round 2 | Round 3 |
|---|---:|---:|---:|---:|
| Main-model calls | 31 | 33 | **8** | **8** |
| Tasks without a main-model call | 0/4 | 0/4 | **3/4** | **3/4** |
| Mean duration | 9.54 s | 19.52 s | 6.89 s | 6.64 s |
| Estimated cost, including Jev | CNY 0.2771 | CNY 0.8408 | CNY 0.3214 | CNY 0.3091 |

These are the autonomous-save results. Each warm round used about **74% fewer main-model calls** than the native control. The explicitly-required-save condition performed less efficiently. **Overall cost is not yet lower:** learning has a cost, and Jev also processes the complete history.

This is one rollout per condition on a small authored workload, not an official benchmark score. A Jev misselection followed by model recovery occurred; passing the final checks does not establish that every routing decision was correct. [Full report](reports/developer-workflows-v3/REPORT.md) · [Analysis](reports/developer-workflows-v3/ANALYSIS.md) · [Raw traces](reports/developer-workflows-v3/traces)

## Quick start

Requires **Node.js 24.14+**. Try persistent Action reuse without API keys:

```bash
git clone https://github.com/yinhong-zhou/jevdo.git
cd jevdo
npm ci
npm run demo
```

For live Jev calls, configure `TYPESAFE_API_KEY`. The experimental CLI also reads the main-model configuration in `.env.example`; a native DSH installation uses its host's model configuration. Build with `npm run build`, then follow the [DSH installation and configuration reference](docs/REFERENCE.md) (Chinese).

## Development

Action examples, reproductions, loop fixes and documentation improvements are welcome. See the [contribution guide](CONTRIBUTING.en.md) for development conventions and working with upstream projects.

```bash
npm run check
npm test
npm run build
```

Learned recipes currently use fixed commands and project bindings. Arbitrary learned parameters, full Web UI compatibility, and multi-agent plugin combinations are outside the verified scope. Start at [src/dsh/index.ts](src/dsh/index.ts). [Report an issue](https://github.com/yinhong-zhou/jevdo/issues).

## License and credits

MIT. Thanks to the authors and contributors of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for the plugin and agent runtime foundation. This project adapts its official loop lifecycle; copyright and provenance remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the [vendored loop](src/vendor/dsh-loop).
