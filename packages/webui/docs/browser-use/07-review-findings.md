# Review findings

**Status:** Every statement below was checked against the working tree of this branch while it was
written. Each row carries one of three labels, and a row labelled open is open:

| Label | Means |
| --- | --- |
| `closed` | The defect the finding described is not present in the tree as of this writing. |
| `open` | The defect is still present. What remains is stated. |
| `in progress in this change, not yet in the tree as of this writing` | Work is under way; the tree does not yet contain the fix. |

**How to read the honest part.** The tree moved while these documents were being corrected — the
credential store in particular was rewritten mid-review, from `cmdkey` on Windows to a DPAPI round
trip. Where a finding is marked closed, the file and line that close it are named, so the claim can be
re-checked rather than taken on trust. Where it is open, nothing here should be read as a partial fix.

## Findings

| ID | Severity | State | One line |
| --- | --- | --- | --- |
| F1 | BLOCKER | `closed` | Pairing credentials did not survive restart and exposed the secret in argv. |
| F2 | BLOCKER | `closed` | An input carrying an old generation could be accepted after a navigation. |
| F3 | MAJOR | `open` | The bridge is not wired into the server's WebSocket upgrade path or the browser service. |
| F4 | MAJOR | `closed` | Bridge commands went to the most recently admitted session, not the session owning the target. |
| F5 | MAJOR | `closed` | The Full CDP switch had no command path and no enforcement. |
| F6 | MAJOR | `closed` | Image frames were not fenced to the currently selected generation. |
| F7 | MAJOR | `closed` | These documents disagreed with the tree. This document is the correction. |

**The tree moved twice while these documents were being written.** F1 landed first; F2, F4, F5 and F6
landed in a second wave partway through this pass. Each "closed" row below names the line that closes
it, so a reader can check rather than trust. **F3 is still open**, and it is the one that matters most
to anyone trying to use the bridge.

### F1 — BLOCKER — pairing credentials

**What was wrong.** Four related defects in `packages/webui/src/server/browser-bridge/credential-store.ts`:
the secret appeared in child-process arguments, the byte→text encoding was not reversible, Windows had
no restart read-back path (`cmdkey /list` does not return a password, so `load()` answered from an
in-process mirror that was empty after a restart), and therefore credentials did not survive a restart.

**What changed.** The module was rewritten. Verified in the current tree:

| Defect | Closed by |
| --- | --- |
| Secret in argv | Every write passes the value on the child's **stdin**. `RunPlatformCommandOptions.stdin` (`credential-store.ts:101`) and `defaultRunPlatformCommand` (`credential-store.ts`, helper section) pipe it |
| Non-reversible encoding | `encodeCredentialForStore` / `decodeCredentialFromStore` (`credential-store.ts:243`, `:256`) — base64 of the raw bytes, with a strict decoder that throws on anything non-canonical |
| No restart read-back | Every `load()` asks the platform and answers from no in-process cache: macOS `security find-generic-password … -w` (`credential-store.ts:298`), Linux `secret-tool lookup` (`credential-store.ts:382`), Windows `ConvertTo-SecureString` over the DPAPI blob (`credential-store.ts:534`) |
| Windows mechanism | `cmdkey` is no longer used. A PowerShell DPAPI round trip replaces it, and `credential-store.ts:423` says why |
| No file fallback | `save()` throws `BrowserCredentialStoreUnavailableError`; the unavailable-platform store (`:202`) writes nothing and `load()` answers `undefined` |

**Residual risk.** Not measured on any host: the probe in this directory ran on Linux before the
rewrite and says nothing about macOS or Windows. The base64-on-stdin round trip has not been exercised
against a real Keychain, a real Secret Service or real DPAPI.

### F2 — BLOCKER — a stale generation is accepted after a navigation

**What was wrong.** An input recorded against an old target generation could still be accepted after
the page navigated, because the generation the input is checked against never advanced.

**State: closed.** Two counters exist and are now connected.

| Counter | Owner | Behaviour |
| --- | --- | --- |
| `#generation` | `WebuiBrowserIsolatedChromiumProvider` | Starts at 1, increments on a main-frame `Page.frameNavigated`, and is reported in `listTargets` and on every image frame |
| entry generation | `WebuiBrowserTargetRegistry` | Raised through `raiseGeneration` when the provider announces a page change |

`WebuiBrowserService.#ensureProvider` now subscribes to the provider and forwards the announcement
(`packages/webui/src/runtime/browser/browser-service.ts:176`):

```ts
provider.onTargetChanged?.((change) => {
  this.#registry.raiseGeneration({
    surface,
    browserId: provider.browserId,
    targetId: change.targetId,
  });
});
```

`observe()` still does not raise on a repeat sighting — seeing a target again is normal — so the
registry's counter now advances only on a real page replacement. `isCurrent` therefore compares a
generation that actually moves, and `sendInput` (`browser-service.ts:289`) can now raise
`browser_target_stale` where before the comparison could never fail.

**Not measured.** No probe or integration run drove a navigation and then observed a refused input.
This row is closed by source inspection, not by observation.

### F3 — MAJOR — the bridge is unwired

**What was wrong.** The extension bridge was not connected to the server's WebSocket upgrade path or to
the browser service, so an extension could not reach the host at all.

**State: open.** The modules exist and are correct in isolation; nothing calls them.

| Evidence | Where |
| --- | --- |
| The upgrade dispatcher sends every upgrade to the generic admission | `packages/webui/src/server/websocket-server.ts:63` calls `admitWebSocketUpgrade` only |
| `admitBrowserBridgeUpgrade` has no production caller | `server/browser-bridge/admission.ts:81`; referenced only from `server/browser-bridge/index.ts` and tests |
| The credential store has no production caller | `createPlatformSecureCredentialStore`, `credential-store.ts:132` |
| The browser service will not produce an external provider | `WebuiBrowserService.#ensureProvider` returns `undefined` for anything that is not `isolated-chromium` (`browser-service.ts:176`) |

**Intended fix.** Route upgrades whose path is `WEBUI_BROWSER_BRIDGE_PATH` to
`admitBrowserBridgeUpgrade`, hand an admitted socket to `server/browser-bridge/session.ts`, and give
`WebuiBrowserService` a bridge-backed provider for `edge` and `chrome` so `#ensureProvider` stops
returning `undefined` for them. Not yet in the tree.

### F4 — MAJOR — commands routed to the wrong session

**What was wrong.** Bridge commands were routed to the most recently admitted session rather than to
the session that owns the target, so with two extensions admitted for one surface a command could be
delivered to the wrong browser.

**State: open, and stated in the source.** `packages/webui/src/server/browser-bridge/registry.ts:256`
says in a comment that the registry does not know which session owns a target until the extension
announces it via `targets`, and that for now it routes to the most recently admitted live session for
that surface, with full target-table routing deferred to a follow-up.

What is already right and must not regress: per-target serialization (`registry.ts:128`) and the
`surface + browserId + targetId + generation` dispatch key (`registry.ts:253`).

**Intended fix.** Build the session-to-target table from the `targets` frame each session sends, and
resolve `dispatch` through it, refusing with an explicit error when no session claims the key.

**State: closed.** `packages/webui/src/server/browser-bridge/registry.ts` now keeps a
`targetOwners` table (`registry.ts:166`) mapping a `browserId`/`targetId` key to the session that
announced it, together with the generation at announcement time (`registry.ts:243`).

`resolveTargetRoute` (`registry.ts`, private) resolves a command against that table and refuses rather
than guessing, in three distinct ways:

| Condition | Refusal |
| --- | --- |
| No session announced the key | `no bridge session announced target "<browserId>/<targetId>"` |
| The announced generation is behind the command's | `target "…" moved on: command generation N, announced generation M` |
| The owning session is gone from the session table | refused, with a comment saying refusing beats delivering to a stale socket |

The close hook drops ownership when a session ends (`registry.ts:256`). Per-target serialization is
unchanged, so the two properties coexist: commands for one target queue behind each other, different
targets proceed in parallel.

### F5 — MAJOR — the Full CDP switch had no command path

**What was wrong.** The Full CDP switch had no command path and no enforcement, so turning it on
granted nothing and turning it off withheld nothing.

**State: closed.** A full path now exists, end to end:

| Stage | Where |
| --- | --- |
| Restricted command vocabulary pinned in the contract | `WEBUI_BROWSER_RESTRICTED_COMMANDS`, `packages/webui/src/shared/contracts/browser.ts:285` — 28 names |
| Operation registered | `sendBrowserCommand` (`shared/operation-names.ts:56`, `server/operation/browser.ts:73`) |
| Port surface | `WebuiBrowserPort.sendCommand` (`runtime/port.ts:661`, wired in `runtime/harness/browser.ts:79`) |
| Enforcement | `WebuiBrowserService.sendCommand` (`browser-service.ts:419`) |

The gate runs in the required order. The surface switch is checked first
(`browser-service.ts:425`), so a disabled surface is refused with
`browser_surface_not_authorized` regardless of `fullCdp`. Only then does
`isBrowserCommandAllowed(authorization, command, WEBUI_BROWSER_RESTRICTED_COMMANDS)`
(`browser-service.ts:431`) decide; a command outside the restricted set with `fullCdp` off is refused
with `browser_capability_denied` and is never forwarded on the chance the provider would accept it.

The predicate this uses is unchanged and is the one named in the finding:
`isBrowserCommandAllowed` (`runtime/browser/authorization.ts:127`). What was missing before was a
caller, and it has one now.

### F6 — MAJOR — image frames were not fenced to the selected generation

**What was wrong.** A frame for a target the panel was no longer showing could be delivered and
displayed as if it were the chosen page.

**State: closed.** `WebuiBrowserService.#frameMatchesSelection`
(`packages/webui/src/runtime/browser/browser-service.ts:396`) compares all four identity fields —
surface, browserId, targetId and generation (`browser-service.ts:403`–`382`) — and returns `false`
when nothing is selected. The stream loop drops every frame that does not match
(`browser-service.ts:370`: `if (!this.#frameMatchesSelection(surface, frame)) continue;`).

That is the check this document's section on the panel required, applied at the server rather than
left to the client.

### F7 — MAJOR — these documents disagreed with the tree

**What was wrong.** Three published statements no longer matched the code, and a reader had no way to
know which half to believe:

| Statement | Where it was wrong |
| --- | --- |
| "No code in the tree handles this today: nothing under `packages/` matches `Not attached` or the CDP `-32000` code for a capture path." | False. `WebuiIsolatedChromiumProvider.#withAttachmentRetry` (`provider.ts:588`) retries exactly this, bounded by `ATTACHMENT_RETRY_WINDOW_MS` = 3 000 ms (`provider.ts:50`) and `ATTACHMENT_RETRY_DELAY_MS` = 100 ms (`provider.ts:52`). It now wraps eleven sends, including `Page.captureScreenshot` (`provider.ts:448`), `Page.startScreencast` (`provider.ts:272`) and all three input commands |
| "Windows \| Credential Manager, through DPAPI \| the platform's own protected storage" as a description of the store | Half right, half wrong. The store is a DPAPI round trip, but it is reached through **PowerShell**, not through the platform's protected storage API: `powershell.exe -NoProfile -NonInteractive -Command`, with `ConvertFrom-SecureString` / `ConvertTo-SecureString` (`credential-store.ts:464`, `:477`). At the moment the review was written the code instead invoked **`cmdkey`** and had no read-back; the DPAPI implementation landed during the correction. The document now names the command and flags the row as under active revision |
| "Measured on the validation host" presented beside a per-OS availability table | Overreaching. `credential-store-evidence.json` covers one Linux host. It shows `providers.secretTool: false` and `providers.kwallet: false` **on that machine**, with `gnomeKeyringDaemon: true` and `dbusSession: true` — i.e. no Secret Service *client* on one host. It says nothing about Linux in general, and nothing whatsoever about macOS or Windows |

**What changed.** Every implementation statement in this directory was re-checked against the source
and corrected. Each document now opens with a status line separating `measured`, `implemented` and
`not yet measured`, and separates them inline where a document mixed them. Stale line citations were
corrected (`isWebuiBrowserSurfaceAuthorized` `browser.ts:85` → `:100`;
`browser_credential_store_unavailable` `browser.ts:224` → `:239`;
`fullCdpApplies` `browser.ts:276` → declaration `:280`, field `:291`), as were stale claims that no
browser operation was registered and that `runtime/port.ts` had no browser member — both are false in
the current tree, and the trace in
[`06-runtime-authorization-trace.md`](06-runtime-authorization-trace.md) now says so.

The CDP probe artifact did support the claims made about it, and those were kept: Chrome 152.0.7977.82,
41 of 44 probed commands supported, real pointer/keyboard/text input, and the attachment race — a
capture failing with `Not attached to an active page (-32000)` immediately after a navigation and
succeeding on the retry after the probe's 750 ms settle wait, with a 3636-byte PNG.

## Ticket status

The reviewer's per-ticket assessment, corrected against the tree where the documents claimed more:

| Ticket | State | Note |
| --- | --- | --- |
| t08 | **satisfied since this review** | The Full CDP operation and its enforcement both exist now (F5): `sendBrowserCommand` → `WebuiBrowserService.sendCommand`, surface check first, then the switch |
| **t06** | **not satisfied** | No Agent browser-tool adapter reaches the WebUI browser service. A search for `sendBrowserInput`, `listBrowserTargets` and `createBrowserAdapter` returns no hit under `packages/agent-tools/` or `packages/agent-modules/` |
| **t10, t11, t12** | **not satisfied** | Blocked entirely on F3. The bridge modules are correct and command routing is fixed (F4), but nothing connects them to the upgrade path, so none of them can be exercised |
| **t17, t18** | **not satisfied** | No implementing code found in the tree |
| t01, t02, t03, t04, t05, t07, t09, t13, t14, t15, t16 | partially satisfied | Partly built and partly unwired, as the enforcement points in [`06-runtime-authorization-trace.md`](06-runtime-authorization-trace.md) record per row |

## What this document does not establish

- It does not claim any platform other than the probed Linux host was validated.
- It does not claim the probe exercised the provider's own retry loop. The probe measured the failure
  and the settle; the retry in `provider.ts` is read from source, not observed running.
- It does not claim the bridge works end to end. F4 is closed in the source, but F3 still blocks the
  whole path, so no bridge behaviour in these documents has been observed running.
- It does not claim the closed rows were verified by running them. F1, F2, F4, F5 and F6 are closed by
  source inspection. Only F7 is closed by this document set itself.

## Related

| Concern | Document |
| --- | --- |
| What was measured, and on which host | [`01-capability-matrix.md`](01-capability-matrix.md) |
| The bridge wire protocol and its routing | [`02-bridge-protocol.md`](02-bridge-protocol.md) |
| Admission, and why it is unwired | [`03-extension-admission.md`](03-extension-admission.md) |
| The per-OS credential mechanisms | [`04-pairing-credentials.md`](04-pairing-credentials.md) |
| Target identity and the generation counter | [`05-target-identity.md`](05-target-identity.md) |
| Switch → enforcement point, per row | [`06-runtime-authorization-trace.md`](06-runtime-authorization-trace.md) |
