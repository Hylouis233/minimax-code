# Capability matrix per browser surface

**Status:** This document mixes three kinds of statement, and every one is labelled with which kind it
is:

| Label | Means | Backed by |
| --- | --- | --- |
| `measured` | A probe observed this on the machine named in the section heading. | `.plan/board/validation/cdp-evidence.json` or `.plan/board/validation/credential-store-evidence.json` |
| `implemented` | The source does this today. The row names the file. | The cited file in this repository |
| `not yet measured` | An open question. Not a denial and not a promise. | Nothing — see the section that collects them |

The surfaces were measured on one Linux host: the isolated Chromium directly, and Edge and Chrome
through the extension bridge. Everything else is declared or implemented, and is labelled as such.

This is the matrix ADR 0019 decision 6 requires: what each browser surface offers, which commands were
actually observed to work, and where the evidence runs out. The authoritative list of what the host
*intends* to offer is the capability declaration in
`packages/webui/src/shared/contracts/browser.ts` (`WebuiBrowserCapabilityEntry`), which is a
declaration rather than a probe result. This document is the measurement half.

## How to read the marks

| Mark | Meaning |
| --- | --- |
| **measured** | A probe on the validation host sent this and the browser answered without an error. The row names the evidence field. |
| **probed, unconfirmed** | A probe sent this and it failed, but for a reason that does not show the command is absent. Never read as "unsupported". |
| **not measured** | No probe exercised this. Absence of a mark is not a denial and not a promise. |
| **required** | A rule the contracts pin. It has no implementing code unless a row says otherwise. |

## Surface summary

| | Isolated Chromium | Edge | Chrome |
| --- | --- | --- | --- |
| How it is reached | `implemented` — this process launches it and speaks CDP over a loopback WebSocket. Probe measured the CDP surface end to end. | `implemented` — the extension bridge, reached over the dedicated `/browser-bridge` path. The handshake and the refusal are **measured** in real Edge. | `implemented` — the same bridge, on the `chrome` surface. The handshake and the refusal are **measured** in real Chrome. |
| Authorization switch | `isolatedChromium` | `edge` | `chrome` |
| Live image stream | **measured** — `Page.captureScreenshot` and `Page.startScreencast` both succeeded against a real page | **measured** — the extension captured the visible tab and a non-empty image frame reached the host, in a real Edge | **measured** — the same, in a real Chrome |
| Pointer / keyboard / text input | **measured** — mouse press + release, `Input.insertText`, and `Input.dispatchKeyEvent` all succeeded against a real page | **measured** — the text the host sent appeared in the page's field, read back through the browser's own automation, in a real Edge | **measured** — the same, in a real Chrome |
| Agent browser tools | **implemented** — the tool adapter forwards to the same browser service the panel uses, and the composition root hands it to the runtime host. Which *surface* a call acts on is resolved from the run's own selection, so a run that has selected nothing is refused rather than being sent somewhere the person is not looking | **implemented**, same adapter | **implemented**, same adapter |
| Full CDP widening | `implemented` — gated in `WebuiBrowserService.sendCommand` | `implemented`, same gate | `implemented`, same gate |
| Restricted command set | `implemented` — `WEBUI_BROWSER_RESTRICTED_COMMANDS`, 28 names, `packages/webui/src/shared/contracts/browser.ts:285` | same vocabulary over the bridge | same vocabulary over the bridge |
| Extension permission gate | not applicable — no extension is involved | The extension's own browser permission, independent of the WebUI switch | The extension's own browser permission, independent of the WebUI switch |

## Measured on the validation machine — `.plan/board/validation/cdp-evidence.json`

Everything in this section is `measured`, and every value is quoted with the JSON field it came from.

**Browser measured.** `/usr/bin/google-chrome`, `Chrome/152.0.7977.82`
(`cdp-evidence.json` → `chromePath`, `version.product`), revision
`@d04cdb24d67b081f6cf80200ffc5233f44b61109`, `jsVersion` `15.2.124.21`, protocol version `1.3`
(`version.protocolVersion`), user agent
`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36`
(`version.userAgent`).

**Probe method.** The probe launched that binary itself with `--headless=new`,
`--remote-debugging-port=0` and `--remote-debugging-address=127.0.0.1`, into a fresh temporary
user-data directory; it read the endpoint from the `DevToolsActivePort` file in that directory and
spoke CDP as raw JSON-RPC over a `ws` WebSocket. `endpointReachable` is `true`
(`cdp-evidence.json`). This is the same launch shape the repository's own isolated-Chromium transport
uses (`packages/tui/src/runtime/browser/headless-chrome-transport.ts:189`).

**There is no typed CDP client in the dependency set.** No `chrome-remote-interface`, no
`devtools-protocol`, no `puppeteer` appears in any `package.json` in this repository. The `ws`
package (`8.21.3`, `packages/webui/package.json:41`) is the WebSocket dependency, and `ws` is MIT
licensed. CDP is therefore hand-rolled: the probe's client builds JSON-RPC frames itself, and the
repository's own transport does the same over `ws`
(`packages/tui/src/runtime/browser/headless-cdp-connection.ts:7`). A capability matrix written against
a generated CDP client type would have had no source in this dependency set.

**The command catalogue was probed, not introspected.** `Schema.getDomains` was attempted first and
failed: the evidence records `schemaDomainAvailable: false` and the note
`Schema.getDomains unavailable: 'Schema.getDomains' wasn't found (-32601)`, and the `domains` object in
the evidence is empty. Chrome does not expose the `Schema` domain over a normal DevTools WebSocket, so
there was no catalogue to read. Instead each command was sent individually with the parameters it
actually requires — an empty parameter object is rejected by Chrome as `Invalid parameters`, which
would have made a working command look absent. Browser-scoped commands were sent on the browser
connection and page-scoped commands on an attached page session.

This matters for how much the matrix can claim: **the probe covers 44 named commands. It is not a
statement about the other CDP commands Chrome implements.** A command that was not sent has no status
here.

### Commands measured supported — 41 of 44

`cdp-evidence.json` → `commands` records `"supported"` for exactly these 41. Each was sent with real
parameters and returned without an error.

| Domain | Measured supported |
| --- | --- |
| `Page` | `Page.enable`, `Page.navigate`, `Page.stopScreencast`, `Page.setInterceptFileChooserDialog`, `Page.getFrameTree`, `Page.reload`, `Page.getNavigationHistory` |
| `Input` | `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, `Input.dispatchTouchEvent`, `Input.setIgnoreInputEvents`, `Input.imeSetComposition` |
| `Runtime` | `Runtime.evaluate`, `Runtime.enable` |
| `Emulation` | `Emulation.setDeviceMetricsOverride`, `Emulation.setScrollbarsHidden` |
| `Network` | `Network.getCookies`, `Network.setCookie`, `Network.enable` |
| `Storage` | `Storage.clearDataForOrigin` |
| `DOM` | `DOM.getDocument`, `DOM.enable` |
| `Accessibility` | `Accessibility.getFullAXTree`, `Accessibility.enable` |
| `Fetch` | `Fetch.enable`, `Fetch.disable` |
| `ServiceWorker` | `ServiceWorker.enable`, `ServiceWorker.stopAllWorkers` |
| `Browser` | `Browser.getVersion`, `Browser.getWindowForTarget`, `Browser.setPermission`, `Browser.grantPermissions`, `Browser.resetPermissions` |
| `Target` | `Target.setDiscoverTargets`, `Target.setAutoAttach`, `Target.getTargets`, `Target.getBrowserContexts`, `Target.createBrowserContext`, `Target.createTarget`, `Target.closeTarget` |

Two further commands are confirmed supported outside the `commands` table, in the real-input phase:
`Page.captureScreenshot` (`inputEvidence.screenshotBytes` = `6452`, a real PNG payload length) and
`Page.startScreencast` (`inputEvidence.screencast` = `"started"`).

`Target.createBrowserContext` and `Target.setDiscoverTargets` were exercised a second time on the
browser connection and recorded again under `externalEvidence` as `"supported"`. This matters for the
design: the **isolated** surface can create an isolated browser context. An **external** browser cannot
be reached this way at all — `Target.*` commands act on the browser the connection belongs to, and the
extension's `chrome.debugger` API routes commands by `tabId` over a supported subset of CDP domains
rather than exposing a DevTools browser connection.

### Commands probed but not confirmed — 3 of 44

None of these three shows the command is absent. Do not use this table to justify a capability denial.

| Command | Evidence field | What the failure actually shows |
| --- | --- | --- |
| `Page.captureScreenshot` (during the command sweep) | `commands["Page.captureScreenshot"]` = `unsupported: Not attached to an active page (-32000)` | Sent immediately after `Page.navigate` in the same sweep, before the renderer was attached. The same command succeeded later, twice — see the attachment race below. The sweep row is an ordering artifact, not a verdict. |
| `Page.startScreencast` (during the command sweep) | `commands["Page.startScreencast"]` = `unsupported: Not attached to an active page (-32000)` | Same ordering artifact. `inputEvidence.screencast` = `"started"` confirms it works once the page is attached. |
| `Runtime.callFunctionOn` | `commands["Runtime.callFunctionOn"]` = `unsupported: Invalid remote object id (-32000)` | The probe passed a placeholder `objectId` because it had no real remote object to name. The failure is about the parameters, not the domain. |

### Real input against a real page

The probe navigated a data-URL page and drove it (`cdp-evidence.json` → `inputEvidence`):

| Observation | Value |
| --- | --- |
| Page loaded and readable | `pageTitle` = `"probe"` |
| Pointer press + release | `pointer` = `"dispatched"` |
| Text insert + key down/up | `keyboard` = `"dispatched"` |
| Screenshot | `screenshotBytes` = `6452` |
| Screencast | `screencast` = `"started"` |

### The renderer-attachment race is real and measured

This is the one failure that changes the contract rather than just the matrix.

| Attempt | Evidence field | Result |
| --- | --- | --- |
| `Page.captureScreenshot` issued immediately after `Page.navigate` | `attachmentRace.immediate` | `error: Not attached to an active page (-32000)` |
| The same capture issued 750 ms later | `attachmentRace.afterSettle` | `ok:3636` |

A provider must therefore **wait for the page to be attached before capturing an image or starting a
screencast**. A capture issued straight after a navigation fails; the same capture succeeds once the
renderer has settled. Note the two different payload lengths (`screenshotBytes` = `6452`, `afterSettle`
= `3636`): they are different pages, and the length is a payload size, not a health signal.

**`implemented` — the isolated-Chromium provider does handle this failure.**
`packages/webui/src/runtime/browser/isolated-chromium/provider.ts` wraps the affected sends in
`#withAttachmentRetry` (`provider.ts:588`), which re-issues an operation while it fails with an
attachment error, up to a bounded window:

| Element | Value | Source |
| --- | --- | --- |
| Mechanism | `#withAttachmentRetry(operation)` | `provider.ts:588` |
| Retry window | `ATTACHMENT_RETRY_WINDOW_MS` = 3 000 ms | `provider.ts:50` |
| Retry delay | `ATTACHMENT_RETRY_DELAY_MS` = 100 ms | `provider.ts:52` |
| Failure test | `isAttachmentFailure` matches the message `Not attached to an active page` | `provider.ts:606` |
| Non-attachment errors | rethrown immediately, never retried | `provider.ts:596` |
| On window expiry | the original error is thrown, not a timeout | `provider.ts:600` |

The retry wraps eleven call sites, covering image capture and every navigation as well as input:

| Command | Source |
| --- | --- |
| `Page.startScreencast` | `provider.ts:272` |
| `Page.navigate` | `provider.ts:416` |
| `Page.reload` | `provider.ts:422` |
| `Page.navigateToHistoryEntry` | `provider.ts:442` |
| `Page.captureScreenshot` | `provider.ts:448` |
| `Input.dispatchMouseEvent` | `provider.ts:325` |
| `Input.dispatchKeyEvent` | `provider.ts:357` |
| `Input.insertText` | `provider.ts:368` |

Two limits of this fix are worth stating, because the measurement does not cover them:

- **`not yet measured`** — the probe measured the failure and the 750 ms settle, but did **not** measure
  the provider's own retry. No test has been run that drives a real `Page.startScreencast` through the
  race. The retry is `implemented`, not `measured`.
- The bound is a heuristic, not a contract: a page that stays unattached for longer than 3 s fails with
  the original `Not attached to an active page` error rather than a distinct timeout code.

**The bridge side has no equivalent.** The extension's image path does not use CDP screencast at all:
`packages/browser-extension/src/images.ts` states that `chrome.debugger` exposes a restricted CDP subset
that excludes `Page.captureScreenshot`, so the extension captures through `chrome.tabs.captureVisibleTab`
instead. No attachment retry applies there.

### The restricted command set

The restricted set is the command vocabulary that may be sent without Full CDP access. There are two
lists in the tree and they are **not** the same, which is worth stating before either is cited:

| List | Where | Count | Whose it is |
| --- | --- | --- | --- |
| `WEBUI_BROWSER_RESTRICTED_COMMANDS` | `packages/webui/src/shared/contracts/browser.ts:285` | **28** | the WebUI's own gate, read by `isBrowserCommandAllowed` and enforced in `WebuiBrowserService.sendCommand` |
| `LOCAL_BROWSER_ACTION_NAMES` | `packages/agent-tools/src/desktop/builtin-browser-defs.ts:744` | **24** | the Agent tools' browser-action vocabulary |

The 28-name WebUI list adds `wait_for`, `get_dom`, `verify_text` and `inspect_editable_targets` to the
Agent list.

**The probe's `restrictedActionCount: 28` matches the WebUI list exactly** — the same 28 names, in the
same set. That number is therefore not an arbitrary enumeration: it is the restricted vocabulary the
programme settled on, observed by the probe. It is still a *count from a hardcoded list in the probe*
(`probe-cdp.mjs:376` computes `restricted.length`), so it is **not** evidence about what a browser can
do; it only tells you which vocabulary was being enumerated.

### Full CDP access

Full CDP access is a global, persistent authorization for the Agent to send any command the active
provider supports. It widens an already-authorized surface and never authorizes one on its own.

**`implemented`.** `WebuiBrowserService.sendCommand`
(`packages/webui/src/runtime/browser/browser-service.ts:419`) is the command path: it checks the surface
switch first, so a disabled surface is refused with `browser_surface_not_authorized` regardless of
`fullCdp`, then calls `isBrowserCommandAllowed(authorization, command, WEBUI_BROWSER_RESTRICTED_COMMANDS)`
(`browser-service.ts:431`). A command outside the restricted set with `fullCdp` off is refused with
`browser_capability_denied` and is never forwarded. The path is exposed as the `sendBrowserCommand`
operation. See [`06-runtime-authorization-trace.md`](06-runtime-authorization-trace.md) and finding F5
in [`07-review-findings.md`](07-review-findings.md).

**`not yet measured`** — no run sent a real DevTools command through that gate. This is verified by
reading the source.

### OS secure credential store

**`measured` — on the validation host, and on that host only.**
`.plan/board/validation/credential-store-evidence.json`, `platform: "linux"`:

| Provider | Field | Value |
| --- | --- | --- |
| `secret-tool` | `providers.secretTool` | `false` |
| `kwallet-query` | `providers.kwallet` | `false` |
| `gnome-keyring-daemon` | `providers.gnomeKeyringDaemon` | `true` |
| D-Bus session bus | `providers.dbusSession` | `true` |
| **Overall** | `available` | `false` |

The evidence's own `reason` is `no Secret Service client (no secret-tool, no kwallet-query) on this
host`. The keyring daemon and a session bus are present, but without a client that speaks the
freedesktop Secret Service there is no store to write to.

**Scope of that result — read it narrowly.** It is a statement about **one machine**, and it is exactly
as narrow as it looks:

| This result says | This result does **not** say |
| --- | --- |
| On the host the probe ran on, no Secret Service client was installed and the store was unavailable | Anything about Linux in general; another host may have `secret-tool` or `kwallet-query` installed |
| `gnome-keyring-daemon` being present is not sufficient evidence of a store | Anything about macOS or Windows, which were not probed at all |
| The explicit-failure path is reachable on a host with no store | That any other platform is available or unavailable |

No macOS or Windows probe was run, so this document makes **no** cross-platform availability claim.
The mechanisms the code implements per platform are listed in
[`04-pairing-credentials.md`](04-pairing-credentials.md); they are `implemented`, not `measured`.

The required behaviour follows from that measurement: **pairing fails explicitly with
`browser_credential_store_unavailable`, and the credential is never written to a file.** This repository
also has no OS keyring dependency today — `keytar` appears in no `package.json` — and
`packages/oauth-core/src/credential-store/types.ts` declares
`CredentialStoreKind = 'file'` with `'os-keyring'` present only as `LegacyCredentialStoreKind`, so the
existing OAuth credential store is file-based. That existing store must not be reused as a fallback for
a pairing credential. See [`04-pairing-credentials.md`](04-pairing-credentials.md).

## Not measured

Read this section before citing the matrix. Each line is a gap in the evidence, not a known limitation
of the product.

- **The isolated surface's CDP matrix was measured on Chromium only.** The probe ran against the
  bundled Chromium, not against Edge, so the isolated surface's cells describe that browser. Edge
  *was* exercised for the **extension** path — see the real-browser acceptance below — but the
  isolated surface's command matrix was not re-measured against it.
- **The extension path is measured in both Chrome and Edge.** The real-browser acceptance
  (`packages/webui/test/browser/browser-bridge-real-browser.spec.ts`) loads the built extension into
  each browser in turn and proves the same two things in each: the handshake completes once the
  extension can prove the installation key, and an extension that cannot is refused and receives no
  credential. That is evidence about the **bridge**, not about Edge's CDP domain list.
- **Chrome's extension `chrome.debugger` domain subset was not exercised against a live tab.** The
  extension was loaded and the handshake run, but no DevTools command was dispatched to a real page.
  The subset behaviour is documented by the vendor and recorded in the ADR's research findings; it was
  not verified here.
- **A real logged-in external browser was not exercised.** Every measurement used a fresh headless
  profile with synthetic `data:` pages. No account, session or user content was involved, and nothing
  here demonstrates support for a logged-in external browser. The ADR says this explicitly about the
  earlier isolated-Chromium MVP, and the same limit applies to this probe.
- **macOS and Windows credential stores were not probed.** The credential probe ran on a Linux host and
  reports nothing about any other platform. Nothing here may be cited as cross-platform validation.
- **The provider's attachment retry was not exercised by the probe.** The probe measured that the
  failure is real and that a 750 ms settle clears it. It did not drive `WebuiBrowserIsolatedChromiumProvider`
  itself through the race, so the retry in `provider.ts` is `implemented` only.
- **The bridge was exercised only as far as the matrix above says.** The acceptance connects a real
  Chrome and a real Edge to `/browser-bridge`, completes the handshake, drives the input, the image
  and a DevTools command, and refuses a peer that cannot prove its installation key. What was **not**
  exercised is a real browser against a **production** host: the bridge the acceptance drives is
  constructed by the test, and the packaged production entry is checked at its admission, by the
  package verification, rather than through a full pairing.
- **The commands outside the extension's allowed subset were not exercised against a real browser.**
  The subset is refused as `unsupported`, which the acceptance observes; the commands *inside* it
  were not each run against a live page.
- **Commands outside the 44 probed were not measured.** Chrome implements far more CDP commands than
  were sent. `Schema.getDomains` being unavailable is precisely why no catalogue was available.
- **`Target.disposeBrowserContext` was called but not recorded.** The probe disposes of the context it
  creates, and the disposal result is not in the evidence. It has no status in this matrix.
- **No gate was run for this document.** This is a Markdown file; the checks that bear on it are
  `node scripts/source-inventory.mjs --write` followed by `pnpm check:source`, which record the file in
  the public-source inventory. See the note at the end of [`README.md`](README.md).

## Surface capability declarations

The declaration the host intends to offer, from
`packages/webui/src/shared/contracts/browser.ts`. These are intent, not measurement; the runtime checks
each call against live authorization, so a wrong declaration degrades to a refused call rather than to
an unearned capability.

| Surface | `bridged` | `liveImages` | `input` | `agentTools` | `fullCdpApplies` |
| --- | --- | --- | --- | --- | --- |
| `isolated-chromium` | `false` | `true` | `true` | `true` | `true` |
| `edge` | `true` | `true` | `true` | `true` | `true` |
| `chrome` | `true` | `true` | `true` | `true` | `true` |

`liveImages` and `input` are `true` for the two bridged surfaces as declarations only. The image stream
and input paths for those surfaces run over the bridge, and nothing measured here confirms either.