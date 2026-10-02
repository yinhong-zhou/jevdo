# Contributing to JevDo

[简体中文](CONTRIBUTING.md) · English

Reusable Action examples, reproductions, loop fixes and documentation improvements are welcome. You can open an issue or PR directly; for larger behavior changes, explain the use case and expected result first.

## Setup

Use Node.js 24.14+. The verified DSH target is 0.2.0-rc.1. Read [AGENTS.md](AGENTS.md), the [implementation reference](docs/REFERENCE.md) and [Action specification](docs/ACTION_SPEC.md).

```bash
npm ci
npm run check
npm test
npm run build
npm run demo
```

Offline tests and the demo need no live API credentials. Live experiments need configuration and incur costs. Preserve failures, usage and raw records, removing secrets and private project content before sharing.

## Design conventions

- Keep this repository focused on the lightweight Action Loop. Context, memory and multi-agent judgment integrations belong in [JevDo Harness](https://github.com/yinhong-zhou/jevdo-harness).
- Separate Action definitions from project bindings. Jev selects valid candidates; execution checks scope, freshness and real effects.
- Save drafts before validation and activation. Prefer maintained project scripts for complex operations. Leave unfamiliar problems to the main model.
- Host permissions and user authorization remain authoritative. Preserve tool call/result pairing.
- Keep authoring prompts, judgment policies, model interfaces and the store separate from the loop.

## Issues and changes

In an [issue](https://github.com/yinhong-zhou/jevdo/issues), include OS and Node/DSH versions, a minimal reproduction, and expected versus observed behavior. For reuse problems, state whether the run started cold or had existing Actions, and provide redacted operation and verification definitions.

A PR should explain behavior changes and validation. Run the checks for code changes and verify the new behavior or regression; documentation-only changes need link, command and factual checks. AI assistance is welcome; contributors should understand and verify their changes.

Performance claims should state controls, task counts, cold/warm conditions, and complete Jev and main-model usage. Label controlled fixtures, authored scenarios and public benchmarks separately.

## Sources and upstream collaboration

This project builds on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and adapts its official loop lifecycle. Preserve copyright, licenses, source revisions and adaptation notes when importing or updating code; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Problems reproducible in stock DSH can be raised upstream with a minimal reproduction and its participation guidelines.

[MU](https://github.com/qybaihe/mu) is a design reference for Jev judgments. The integration of MU code and its 35 judgment points belongs to the separate [JevDo Harness](https://github.com/yinhong-zhou/jevdo-harness) repository; discuss those changes there.
