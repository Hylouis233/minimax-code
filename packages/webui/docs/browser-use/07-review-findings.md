# Review findings — WebUI Browser Use

Two independent reviews of this change were run against the tree, both by a
`codex` `gpt-6-luna` reviewer reading the source rather than the description.
This document records what each review found and what was done about it.

Every status below is a claim about the **tree**, and each one names the file
that carries it. A finding that is still open is marked open; nothing here is
rounded up.

## How to read the statuses

| Status | Meaning |
| --- | --- |
| `fixed` | The code now does the thing, and a test proves it. |
| `fixed, platform unverified` | The code does the thing; the platform behaviour it depends on could not be executed on this machine. |
| `open` | Not done. What remains is stated. |

---

## Round 1

> Verdict: the plan cannot be closed. The extension bridge is not wired into
> WebSocket upgrades or the browser service, Agent tools do not share the
> panel's session, Full CDP is not enforced, and the OS credential-store
> implementation cannot reliably reload credentials after restart. There is also
> a stale-generation input defect and a bridge router that can select the wrong
> session.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | BLOCKER | Pairing credentials did not survive a restart, and the secret appeared in child-process arguments. | `fixed` |
| F2 | BLOCKER | An input recorded against an old target generation could still be accepted after a navigation. | `fixed` |
| F3 | MAJOR | The external bridge was not connected to the server or the browser service. | `fixed` |
| F4 | MAJOR | Bridge commands were routed to the most recently admitted session rather than to the session that owns the target. | `fixed` |
| F5 | MAJOR | The Full CDP switch had no command path and no enforcement. | `fixed` |
| F6 | MAJOR | Image frames were not fenced to the currently selected generation. | `fixed` |
| F7 | MAJOR | The published documents disagreed with the tree. | `fixed` |

### What was done

- **F1** — `packages/webui/src/server/browser-bridge/credential-store.ts` was
  rewritten. The secret is no longer in `argv` on any platform: macOS uses
  `security add-generic-password` with the secret on **stdin**, Linux uses
  `secret-tool store` with the secret on stdin, and Windows dropped `cmdkey`
  for a PowerShell **DPAPI** round trip. The credential is stored as base64 of
  the raw bytes, so the byte→text→byte round trip is exact for bytes that are
  not valid UTF-8. `load()` reads the **platform** rather than an in-memory
  copy and returns `undefined` when the platform cannot read back. There is
  still no plaintext file fallback: a failed save throws the typed unavailable
  error and writes nothing. — `fixed, platform unverified`: the macOS and
  Windows forms could not be executed on this Linux host and are asserted
  through an injected command runner.
- **F2** — The provider announces a target change when the main frame
  navigates (`onTargetChanged`); the service raises the registry's generation
  and moves the selection with it; and the provider itself refuses a command
  whose generation no longer matches, so the check that protects the page does
  not depend on the registry having heard about the navigation. Proven against
  a **real** browser: `packages/webui/test/integration/browser-use-real-input.test.ts`.
- **F3** — `packages/webui/src/server/browser-bridge/server.ts` owns the
  bridge's own WebSocket server, one pairing per surface and one registry;
  `packages/webui/src/server/websocket-server.ts` branches on `/browser-bridge`
  **before** the generic admission and returns; `packages/webui/src/server/service.ts`
  accepts and closes it; both composition roots build the one shared instance.
- **F4** — `packages/webui/src/server/browser-bridge/registry.ts` keeps a
  target-ownership table keyed by `(browserId, targetId)`, built from the
  extension's `targets` announcements, and requires an exact generation match.
- **F5** — `sendBrowserCommand` exists end to end. The gate is
  `isBrowserCommandAllowed`: a restricted browser-tool action is allowed
  whenever the surface is authorized; anything else needs the Full CDP switch.
  Full CDP never authorizes a surface on its own.
- **F6** — The service binds each stream to the complete target identity and
  drops any frame whose surface, browser, tab or generation no longer matches
  the current selection.
- **F7** — The documents were corrected against the tree, and the measured,
  implemented and not-yet-measured claims are separated.

---

## Round 2

> Verdict: the plan cannot be closed. The external path still cannot complete
> pairing or provide a runtime provider, bridge startup enables pairings
> regardless of the browser switches, and external frames can be relabelled with
> a newer generation. Edge/Chrome Full CDP is also denied outright.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | BLOCKER | The host and the extension mint **independent** pairing credentials, so the extension can never produce a proof the host accepts. | `open` |
| F2 | BLOCKER | Bridge startup enabled Edge and Chrome regardless of the authorization switches. | `fixed` |
| F3 | MAJOR | The composition passed `createBridgeProvider` where the bridge exposes `createProvider`, so the service was handed an undefined factory. | `fixed` |
| F4 | BLOCKER | An external frame was stamped with the latest announcement's generation, so a delayed frame from the old page passed the selection fence. | `fixed` |
| F5 | MAJOR | External target generations never reached the runtime registry, so a target that navigated could become unusable. | `fixed` |
| F6 | MAJOR | Full CDP was unavailable on Edge and Chrome: the bridge provider refused every raw command. | `open` |
| F7 | MAJOR | This document itself was stale about round 1. | `fixed` |

### What was done

- **F2** — The bridge no longer switches any surface on by itself.
  `BrowserBridgeServer.start()` starts the WebSocket server and nothing else;
  the pairings follow the switches, because the switches own them. The browser
  service reads the persisted authorization and calls the bridge's
  `enableSurface` / `disableSurface` for the surface whose switch moved, each
  surface independently. Turning a surface off revokes its credential, closes
  that browser's sessions and refuses the old credential from then on.
  `packages/webui/test/unit/browser-bridge-server.test.ts` — "holds no
  credential and admits no session for a surface that is off".
- **F3** — The runtime reaches the bridge through the member the bridge
  actually exposes, and the adapter is where the two meet. The runtime's
  provider interface names the surface rather than the isolated literal, so the
  bridge's provider satisfies it rather than being excluded by construction.
- **F4** — A frame keeps the generation it carries. A frame whose generation
  does not match the latest announcement is **dropped**, not relabelled.
  `packages/webui/test/unit/browser-bridge-server.test.ts` — "drops an
  extension frame whose generation the announcement moved past".
- **F5** — The external branch subscribes to the provider's target changes and
  raises the registry's generation, and the registry adopts the provider's
  generation for a new entry without regressing a newer one.
- **F7** — This document.

### What is still open, and why

**F1 — the pairing exchange.** The host mints a credential and keeps it in the
OS secure store; the extension currently mints a *different* credential and
keeps it in `chrome.storage.local`. Nothing transfers one to the other, so
the extension cannot answer a challenge the host issued. The fix is an
initial, authenticated pairing exchange: the host issues a single-use,
short-lived pairing code, the extension presents it, the host transfers the
credential once, and the extension stores it. Two things make this a decision
rather than a patch:

1. **How the code reaches the extension.** A browser extension cannot read the
   host's files, so the code has to travel through the person — the host shows
   it, the person enters it in the extension's options page. That is a product
   surface (a Settings panel that displays a live pairing code) and it has to
   be designed, not merely wired.
2. **What "automatically pairs" means.** ADR 0019 says enabling a switch pairs
   the browser without per-tab confirmation. A one-time code is per-browser
   confirmation, not per-tab, but the wording should be reconciled with the
   mechanism rather than left to the reader.

Until this lands, the external surfaces cannot complete a handshake, and every
external capability is blocked behind it.

**F6 — Full CDP on the external surfaces.** The runtime gate is in place and
the isolated Chromium forwards a raw DevTools method, but the bridge provider
refuses every raw command, because `chrome.debugger` exposes only a subset of
the DevTools domains. The honest fix is a bounded bridge command frame and an
extension-side `chrome.debugger.sendCommand` dispatch restricted to that
subset, with an unsupported method refused explicitly. It is not done here:
it needs the same wire change as F1's exchange, and doing both at once without
a real Edge or Chrome to test against would produce a protocol that has never
spoken to a browser.

## Round 3

> Verdict: the plan cannot be closed. A host restart rotates the host's
> pairing credential away from the one the extension still holds; the Agent's
> browser tools never reach the browser service; the target selection is
> per-surface rather than per Agent run; Full CDP is denied on the external
> surfaces; the frame queue is unbounded; and this document was stale.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| N1 | BLOCKER | Startup minted a **new** host credential instead of loading the persisted one, so a restarted host and the extension held different secrets. | `fixed` |
| N2 | BLOCKER | The Agent's browser tools never reach the browser service. | `fixed` |
| N3 | MAJOR | The target selection is per surface, not per Agent run. | `fixed` |
| N4 | MAJOR | Full CDP is denied on the external surfaces. | `open` |
| N5 | MAJOR | The frame queue was unbounded. | `fixed` |
| N6 | MAJOR | This document set still said the bridge was not wired. | `fixed` |

### What was done

- **N1** — `BrowserBridgePairing.restore()` re-adopts the credential the store
  already holds, and `BrowserBridgeRegistry.restoreSurface` and
  `BrowserBridgeServer.restoreSurface` expose it. The browser service calls
  **restore** at startup and **enable** on a user toggle, and the two are
  different on purpose: a restart must not rotate the credential away from the
  one the extension still holds, while turning a switch off and on again must
  mint a fresh one. The switch-off path removes the credential from the store,
  so the next enable finds nothing to restore.
  `packages/webui/test/unit/browser-bridge-pairing.test.ts` — "keeps the
  credential the extension still holds when the host restarts" and "mints a
  fresh credential when the surface was switched off in between".
- **N1 (the pairing exchange)** — The host and the extension now share a
  credential. The extension generates an ephemeral P-256 ECDH key pair per
  connection and sends the public key in its `hello`; the host replies with a
  `pair` frame carrying the credential encrypted to it (ECDH → HKDF-SHA256 →
  AES-256-GCM) together with the host's own ephemeral public key, the HKDF
  salt and the ciphertext. The extension decrypts it, stores it in
  `chrome.storage.local` and answers the challenge with it. The secret never
  crosses the wire in the clear, and no person has to carry a code. Both sides
  pin the same derivation vector, so the two implementations cannot drift.
  The decision and its limits are recorded in the ADR's amendments.
- **N2, N3** — See above.
- **N5** — The stream keeps the **newest frame per target** and nothing else. A
  live stream pushes a frame per visual change, and a client that reads
  slowly would otherwise accumulate every one of them; a frame that is already
  superseded when it is read is not worth delivering.
- **N6** — `03-extension-admission.md`'s status table now states what the tree
  does: the bridge reaches the upgrade path, a session is registered on `ready`
  rather than on socket open, the switch drives the pairing, and a credential
  survives a host restart.

### What is still open, and why

**N2 — the Agent's browser tools now reach the service.**
`packages/webui/src/runtime/browser/tool-adapter.ts` implements
`LocalBrowserAdapter` over the browser service. `getCapabilities()` declares
exactly the restricted command set, and `execute` forwards the action to the
service, which reads the surface switch and the Full CDP gate — so there is
one place where the authorization is decided, and the tool path does not carry
a second notion of it. An action outside the restricted set is refused with
`browser_capability_denied` **even when Full CDP is on**, because the tool
path is the restricted path by construction.

The ordering problem was real: the runtime host takes the browser provider as
an *input*, and the browser service needs the host for the authorization
switches. The service is therefore constructed against a store that resolves
the host at read time, and the composition root attaches the host once the
runtime is assembled. A host that cannot answer the authorization leaves the
port absent, so the browser operations stay unregistered rather than bound to
a port that refuses everything.

**N3 — the selection is now scoped to the run.** The service's selection is
keyed by `(surface, runId)`, where the run is the Agent session id. The tool
path passes `ctx.sessionId`; the panel path sends the active run's session id
in the operation body, because the wire frame carries none. Two runs on the
same surface keep their own selections, each run's image stream shows its own
target's frames, and a run with no selection is refused rather than falling
back to another run's. The no-run selection is a named thing, not an empty
string, and it is what the panel shows when no run is active.

**N4 — Full CDP on the external surfaces.** The runtime gate is in place and
the isolated Chromium forwards a raw DevTools method, but the bridge provider
refuses every raw command, because `chrome.debugger` exposes only a subset of
the DevTools domains. The fix is a bounded bridge command frame and an
extension-side dispatch restricted to that subset, with an unsupported method
refused explicitly. It needs the same wire change as the pairing exchange, and
without a real Edge or Chrome to speak to, doing both at once would produce a
protocol that has never been exercised against a browser.

## What this document does not establish

- That the external path works end to end against a real Edge or Chrome. Neither
  browser was installed on the machine that produced this change, and no
  extension was loaded into a real browser.
- That the macOS, Windows or Linux credential-store forms behave as intended.
  The Linux form was probed on one host and was **unavailable** there; the
  macOS and Windows forms are asserted through an injected command runner, not
  executed.
- That the Agent's browser tools address the same session as the panel. The
  shared session and the command path exist, but the tool-side adapter does
  not; see the ticket table in the specification issue.
