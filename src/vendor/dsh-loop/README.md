# Upstream loop

MIT-licensed DeepSeek Harness loop, from commit
`4878cdabd87d4041bdaff61d04c966883b9fd07a`, version `0.2.0-rc.1`.
Source: https://github.com/deepseek-ai/deepseek-harness/tree/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/core/agent-loop

The adjacent LICENSE is the upstream copyright and license notice.
Lifecycle, inbox, cancellation, session recovery, streaming, and ordinary tool
scheduling remain upstream code. The local change in agent.ts calls
`prepareActionStep` after assembling and admitting the exact model request but
before requesting an LLM. Jev receives that same complete message/tool surface;
fast actions and the main model share one transcript. The separate JevAction module owns its policy.
index.ts uses the upstream public Context declaration to avoid duplicate nominal
types when the reference loop is loaded in evaluation. The compile-time-only
Cordis FiberState enum is represented by its pinned 4.0.4 numeric values. The
local receipt uses the upstream stream settlement protocol with an explicit
jevaction-template provider label and no network request. These sources are bundled
into our plugin, not imported through unsupported package-private paths.

Upstream upgrades must be explicit and re-run the integration/lifecycle tests.
