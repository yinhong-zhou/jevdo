# JevAction

- Node.js 24.14+, TypeScript through tsx; use `npm run check`, `npm test`, and `npm run build`.
- On Windows invoke PowerShell 7 through `pwsh.exe -NoLogo -NoProfile -Command { ... }`.
- Never print, commit, or copy credentials into reports. `.env` is local only.
- Keep reusable action definitions separate from project-specific execution bindings.
- Jev chooses registered IDs, not arbitrary executable text. The executor validates scope and freshness.
- Always distinguish offline fixtures, live API runs, and completed benchmarks.
- Do not invent benchmark improvements or claim novelty before evaluating related work.
- This repository implements a DSH replacement loop plugin, pinned to DSH 0.2.0-rc.1. Do not add MU/Pi integrations or dependencies.
- Keep upstream license and source provenance beside the adapted official loop. Do not rewrite its general lifecycle without a demonstrated need.
- Keep the loop independent of the model adapter, decision policy, tools, and action store.
- Use one authoritative conversation transcript. Every tool call must have a matching result.
- Defer context filtering, communication gateways, multi-agent orchestration and UI work.
- No independent budget-allocation/Foreman component in this scope.
- Product text must not expose development notes or internal acceptance checklists.
