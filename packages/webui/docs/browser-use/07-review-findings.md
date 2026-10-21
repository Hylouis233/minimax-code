# Review findings — WebUI Browser Use

**Seven review rounds** have been run against this change. Six of them were run
by a `codex` `gpt-6-luna` reviewer reading the source rather than the
description; the seventh was the final acceptance pass, run against the
finished tree and against the acceptance criteria the tickets state. This
document records what each round found and what was done about it.

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

## Round 4

> Verdict: the plan cannot be closed. The credential exchange and the run-scoped
> selection exist, but the panel's image stream stays attached to the target that
> was selected when the stream started, the Agent tool path has no connection to
> the surface the panel is showing, and the extension's allowlisted `Origin` does
> not authenticate an extension.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| N1 | BLOCKER | Admission trusts the `Origin` header to select an allowlisted extension id, and the host then encrypts its credential to the public key that peer supplies. A local process can spoof the allowlisted origin, supply its own key, decrypt the credential and answer the challenge. | `open` |
| N2 | MAJOR | Changing the selected target did not retarget the active image stream. | `fixed` |
| N3 | MAJOR | The Agent tool path silently used the isolated Chromium even when the panel was showing Edge or Chrome. | `fixed` |
| N4 | MAJOR | The published documents still said the tool adapter did not exist and that the host and the extension minted independent credentials. | `fixed` |

### N1 — the bridge is now authenticated by an installation key

This is the one finding that is a **design** gap rather than a defect, and the
ADR's amendment A1 already names the shape of the answer: the extension needs
an **installation key** that a local process does not have, and the exchange
must be bound to it.

What the tree does today, stated plainly so nobody has to infer it:

- The host selects the allowlisted extension id from the `Origin` header.
- The host then seals its pairing credential to the **public key that peer
  supplied**, and sends it.
- A local process can put any `Origin` on a loopback socket, so it can be
  admitted as the allowlisted extension, supply its own ephemeral key, decrypt
  the credential and answer the challenge.

The exchange therefore protects the credential **in transit** and nothing more.
It is not an authentication of the peer. The bridge must be treated as
**unauthenticated against a local process** until the installation key lands,
and the credential must not be regarded as secret from anything that can
reach loopback.

**What is needed.** A per-installation key that the extension holds and a
local process does not, provisioned when the extension is installed and
configured, and bound into the exchange so that only the holder of that key
can complete it. The credential would then only ever be sealed to a key the
host has already seen prove possession of the installation key. The native
messaging route the ADR's research findings already list is the other
candidate, and it has the same property: a registered host process, not a
spoofable `Origin` header.

Until that exists, the honest position is the one this document takes: the
external surfaces are **not** safe against an attacker who can reach loopback,
and the switch that enables them should be understood as enabling them for
**the person's browser**, not as a boundary against a local process.

### A residual gap the N2 fix left behind — now closed

The panel used to open its image stream once per `(surface, runId)`. Opened
**before** the run had selected anything, the service refused it — which is
the required behaviour — and the panel then showed no live frames until the
surface or the run changed.

The subscription is now tied to the run's **selected target**: when the person
picks a target the stream opens, and when the run's target moves the previous
subscription is closed and a new one opened for the new target. The decision
is a pure function in the projection
(`selectWebuiBrowserStreamTarget` / `webuiBrowserStreamTargetKey`), so it is
tested without a DOM renderer — the client test environment has none.

### N2, N3, N4

- **N2** — The stream now follows the run's current selection: a selection
  change restarts the provider stream for the new target and stops the
  previous target's stream, so a screencast is not left running for a tab the
  person moved away from. The existing identity and generation fences still
  drop a frame that belongs to a superseded target.
- **N3** — The tool path no longer defaults to the isolated Chromium. It acts
  on the surface the **run** selected, and a run that has selected nothing is
  **refused** with a stable browser error code rather than being sent to a
  browser the person is not looking at.
- **N4** — The stale claims in this document and in
  `03-extension-admission.md` are corrected.

## Round 5 — found by probing the real browser

No review round caught this one, because every test of the extension runs
against its **TypeScript source**. A probe against a real Chrome shows the
gap: the extension **registers** — the service worker is created and the
extension id is `ijoijfjbpmfdebiopnbodncfgdjmgjce` — but the manifest points
`background.service_worker` at `src/background/service-worker.ts`.

**A browser extension runtime executes JavaScript only.** The worker therefore
registers and then cannot run, and the extension as packaged cannot drive a
browser at all. The evidence is in
`.plan/board/validation/extension-load-evidence.json`; the probe is
`.plan/board/validation/probe-extension-load.mjs`.

The fix is a build step: bundle the extension's TypeScript to JavaScript and
point the manifest at the built output. Until that lands, every claim about
the external path is a claim about the **source**, not about a browser.

This is the kind of gap that only a real browser finds, and it is the reason
the programme's evidence says "not yet measured" for the external surfaces
rather than claiming they work.

## Round 6 — the external path, against a real browser

A Playwright spec now drives a **real Chrome with the built extension loaded**
against a **real bridge server**: `packages/webui/test/browser/browser-bridge-real-browser.spec.ts`.

**What it proves.** An extension that cannot prove the installation key is
**refused**: the host reports the surface as configured and enabled but not
connected, and no credential crosses to the peer. That is the security property
that matters, and it is now established against a real browser rather than a
synthetic peer.

**What it now proves — both halves.** The happy path **passes**: the
extension completes the handshake once it can prove the installation key, and
the host reports the surface as connected. The refusal **passes**: the same
extension without the key is refused, and no credential crosses to the peer.

**The defect it found.** A Manifest V3 service worker is **lazy** — it starts
on an event and is torn down when it goes idle. Saving the installation key
did not wake it, so the extension sat there configured but unconnected, and the
options page told the person to *"Reconnect the extension to pair with the
host"* — a manual step that a person can get wrong and that nothing checks.
The options page now asks the worker to reconnect, and the worker answers.

**Both browsers.** Edge *is* installed on this machine
(`/usr/bin/microsoft-edge`, 151.0.4129.107) — an earlier note in this
document said otherwise, and that was wrong. The acceptance therefore runs
against **both** the bundled Chromium and the installed Edge, and all four
cases pass: the handshake completes in each, and an unprovisioned peer is
refused in each.

**What this means for the claims.** The external path is demonstrated working
against **two real browsers**, and the security property is demonstrated
against both. What is *not* established is Edge's DevTools domain parity with
Chrome's — ADR 0019 decision 6 forbids claiming identical CDP domains across
surfaces, and the extension's `chrome.debugger` subset was not dispatched
against a live tab. Ticket #193 stays open for that reason and for the store
builds, not because Edge is unavailable.

## Round 5

> Verdict: the plan is not closable. The real-browser test does launch both
> Chrome and Edge, but its bridge server enables the **Chrome** surface in both
> cases, so it does not establish independent Edge-surface acceptance. The
> published documents also still describe the bridge as unwired.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| N1 | MAJOR | The published documents contradict the current tree, and the review record contradicted itself about which browsers had been exercised. | `fixed` |
| N2 | MAJOR | The Edge browser test authenticated the **Chrome** surface, so the Edge switch, the Edge pairing credential and the Edge routing were never exercised. | `fixed` |

### What was done

- **N1** — The capability matrix, the bridge protocol and the extension
  admission document were reconciled against the tree: the bridge is wired, the
  Agent's tool adapter exists, and the measurement column says what was
  measured on which surface. The review record's own contradictory sentences
  about which browsers had been exercised were removed.
- **N2** — The acceptance is now parameterised by **surface**, not only by
  browser. The Chrome run is admitted on the `chrome` surface with the Chrome
  allowlist, and the Edge run on the `edge` surface with the Edge allowlist,
  and each asserts the matching surface's state. A single bug — reading the
  installation key from the wrong surface — was what the parameterisation
  exposed, and it is fixed.

## Round 6 — the external path, driven end to end in a real browser

The handshake acceptance proved that an extension can pair. It did not prove
that the **bridge** works — that a keystroke the host sends arrives in the page
the person is looking at, that the page's image reaches the host, or that a
DevTools command runs against the live tab. A new acceptance drives all three
through the real bridge, in real Chrome and real Edge, each on its own surface.

It found **four** defects, all of them real:

1. **The extension's frame parser had no `cdp` case.** A DevTools command was
   therefore rejected as an *unknown frame kind*, and the client closed the
   socket — which is why the first attempt reported "session closed before
   reply" rather than a refusal.
2. **A refusal was converted to a transport failure too early.** The session
   turned the extension's refusal into a terminal retry outcome, so the
   provider never saw it and the stable error code the contract promises never
   applied. A refusal is an **answer**, not a transport failure.
3. **The provider discarded the command's result**, so a caller had no way to
   read what the command produced.
4. **The extension could not capture the page at all.** `chrome.tabs.captureVisibleTab`
   requires the `<all_urls>` host permission or an `activeTab` permission
   granted by a user gesture on the page — and there is no gesture here, the
   host is asking for the picture. The permission is now declared, and the
   reason is recorded in the extension's README rather than left implicit.

### The worker's termination, exercised

The same acceptance now terminates the extension's **service worker** while an
image stream is running — the browser closes the worker's target, which is what
the browser does when it reclaims an idle worker. The host sees the session
drop, the worker is woken by the next event, and the bridge is usable again:
a DevTools command against the live tab answers afterwards.

That is exercised in both Chrome and Edge, so the bridge's survival across a
worker restart is no longer an assertion about the code's shape but an
observation of the behaviour.

## Round 7 — the final acceptance pass

This round was run by the implementer against the finished tree, against the
acceptance criteria the tickets state, rather than by a reviewer reading the
diff. It found five things; all five are closed.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| P1 | MAJOR | The **packaged production entry did not set `packaged: true`**. The bridge read the development allowlist in both composition roots, so a packaged host accepted development identities — the one thing the packaged build is for is refusing. | `fixed` |
| P2 | MAJOR | Four of the adversarial cases the acceptance names — an oversized frame, a malformed frame, a duplicate extension connection, and a revocation during an in-flight action — had **no test at all**. | `fixed` |
| P3 | MAJOR | The credential lifecycle ticket asks for "a test that observes a credential never appearing in captured log output". **No such test existed.** | `fixed` |
| P4 | MAJOR | The published documents still described the input, image and DevTools paths as exercised against a **synthetic peer**. They are exercised against a real browser. | `fixed` |
| P5 | MINOR | The acceptance was not **recorded**: no run wrote down the browser version, the operating system, the settings and the observed result. | `fixed` |

### What was done

- **P1** — `release/webui-npm/bin/mcode-webui.mjs` now passes `packaged: true`
  to the bridge, so the packaged entry reads
  `MAVIS_BROWSER_STORE_EDGE_EXTENSION_IDS` / `MAVIS_BROWSER_STORE_CHROME_EXTENSION_IDS`
  and never the development variables. The development entry
  (`scripts/run-webui-server.mjs`) is the one that reads the development
  allowlist. The difference is now **measured**, not asserted, and for **each**
  store: the new `real-packaged` suite builds the Chrome Web Store artifact
  and the Edge Add-ons artifact from the one shared source, loads each in its
  own browser, and shows that the id the browser assigns is the id the key
  determines, that the two builds differ in the manifest's `key` and nothing
  else, that a packaged host admits them through the store allowlist, and that
  the same packaged host refuses them when the id is named only in the
  development allowlist.
- **P2** — `packages/webui/test/unit/browser-bridge-adversarial.test.ts` drives
  all four cases against a real `ws` server and a real client. The host
  survives the first two, the earlier session is replaced rather than left
  alive beside the newer one, and the in-flight action fails rather than
  hanging.
- **P3** — `packages/webui/test/unit/browser-bridge-credential-secrecy.test.ts`
  runs the whole pairing with the console and both process streams captured,
  and watches the host's stored secrets in every form they could take — raw
  bytes, base64, hex. None of them appears in the output, and none appears in
  the frames the host sent: the credential travels sealed.
- **P4** — the paragraph above is the correction: the external path is driven
  end to end in a real Chrome and a real Edge, each on its own surface.
- **P5** — the suites now write an acceptance record as they run, and the
  published matrix is written from it. See
  [`09-acceptance-record.md`](09-acceptance-record.md).

## What this document does not establish

- That the external path works end to end against a real Edge or Chrome for
  **every** behaviour. The handshake, the refusal, the input, the image, the
  DevTools command and the worker's termination are established, each on its
  own surface — the `chrome` surface in Chrome and the `edge` surface in Edge.
  What is not established is the **Agent's** path against a real browser, and
  the Full CDP switch through the runtime gate against a real browser: the
  bridge carries the command and the extension's allowlist refuses what is not
  in it, which is a different thing from the runtime switch.
- That the macOS, Windows or Linux credential-store forms behave as intended.
  The Linux form was probed on one host and was **unavailable** there; the
  macOS and Windows forms are asserted through an injected command runner, not
  executed.
- That the store identities exist. A store assigns them when the extension is
  first published, so the packaged acceptance uses a key generated at run time.
- That the Agent's browser tools address the same session as the panel **in a
  real browser**. The tool adapter exists and forwards to the same service, and
  which *surface* a tool call acts on is resolved from the run's own selection
  rather than from a default, so a run that has selected nothing is refused
  rather than being sent somewhere the person is not looking. What is not
  established is the whole path exercised end to end against a real browser in
  one run.
