# Runtime owner identity

The WebUI is a declared client identity, not a borrowed `tui` row: `runtimeOwnerKind: "webui"`
resolves its own row in `packages/local-runtime/src/runtime/runtime-owner-policy.ts` (ADR 0013 makes
harness code editable for this work; ADR 0007's read-only reasoning assumed the work would go
upstream).

The `webui` row is the `tui` row with six cells changed. Its inherited cells are the default; the six
differences are the decision, because an identity change must not silently move turn-execution
semantics:

| Cell | `tui` | `webui` | Why |
| --- | --- | --- | --- |
| `wiring.schedulerHost` | false | true | The runtime host exposes scheduler capability; the WebUI currently has no scheduled-task surface |
| `wiring.cronService` | false | true | The runtime host exposes cron capability without the Electron owner |
| `execution.restricted` | true | false | The WebUI is not a restricted runtime |
| `execution.memoryFeature` | false | true | The memory collection opens for this client |
| `execution.mavisFeatureBundle` | false | true | Same class of feature bundle as the terminal client |
| `execution.executesTerminalControl` | true | false | A browser client cannot run terminal control sequences |

`ownsV2Runtime` is set explicitly rather than inherited: `tui` gets it from a `cli || tui` clause the
`webui` row is not in. `reviewPolicy` stays `'tui'`, and `promptProfile: 'tui'` with
`promptSurfaceDefault: 'cli'` is deliberate — the WebUI loads the same system prompt asset as the
terminal client, so it is a hard dependency on that asset. `titleSafetyBypass: true` is provisional:
it carries today's effective value so the identity change does not silently change title generation,
and whether it is permanent is an open question ([`../open-questions.md`](../open-questions.md)).

## Two smaller facts the row system carries

- `RuntimeOwnerRow` has three states, not two: `absent` (no kind declared), a declared kind, and
  `unknown` (a kind string that is not in `RUNTIME_OWNER_KINDS`), which resolves a distinct row. The
  service gates and the compatibility gate disagree about what an absent owner means; the explicit
  rows are what keeps that disagreement from reaching the WebUI.
- **Identity is not access control.** The WebUI is a loopback-reachable browser surface, and enabling
  memory, cron or Computer Use for it means an agent running in that browser can act on this machine.
  That is the same class of concern ADR 0004 addresses by binding loopback-only; a single local user
  is not the same thing as no access control.

The cells themselves are read by the harness, not by this package. Searching `packages/webui/src` for
each cell name returns nothing, and that is correct — see [`../known-gaps.md`](../known-gaps.md).
