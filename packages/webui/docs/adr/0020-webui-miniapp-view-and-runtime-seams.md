# WebUI Mini App view and its runtime seams

**Status:** Accepted as product direction; implementation pending.
**Date:** 2026-10-20.

The WebUI will host Mini Apps. A Mini App's page is rendered as an iframe the client loads
from a loopback origin that the WebUI service proxies. The Mini App's own page bridge — the
`window.mcode.miniapp.*` namespace a Mini App page uses to call its host — is provided by a
browser rewrite of the desktop client's preload bridge, injected by that same proxy.

There are two presentations. **Inline**, the Mini App view occupies a view inside the WebUI
workspace panel. **Standalone**, a browser tab is opened through a URL deep link; the tab runs the
full WebUI client, but the only content it shows is the Mini App view. The standalone view has no
in-page close control: the tab is the Mini App's own. The deep link selects a session and a Mini
App, and the service injects its runtime configuration into every page it serves, so a tab opened
this way is an ordinary client with the same credential as any other.

The Mini App page is a first-party plugin page. The desktop client hosts it in a native
`WebContentsView` and draws none of it; the browser and Electron are both Chromium, so the page
itself renders identically in the WebUI. Everything the port actually needs from the desktop
client is three capabilities, and each has a browser-side counterpart.

## What the browser cannot do, and what replaces it

1. **Injecting the loopback credential.** The desktop client injects the Host-issued credential
   into the Mini App's own requests with `session.webRequest.onBeforeSendHeaders`. A browser
   cannot add a header to an iframe navigation or to the page's subresources, so where the
   contract keeps the credential guard, a Mini App reached directly is rejected. The WebUI
   service therefore proxies the Mini App's origin, and injects the credential there; whether it
   injects one at all follows from the contract baseline below.
2. **Injecting the page bridge.** The desktop client injects the bridge with a preload
   (`contextBridge.exposeInMainWorld`). A parent page cannot script a cross-origin iframe, so the
   bridge cannot be installed from the client. The proxy rewrites the Mini App's HTML and injects
   a browser build of the same bridge. The bridge reaches the host over `postMessage` to the WebUI
   client, which already holds the client credential and the stream.
3. **Hosting the page.** The desktop client positions a native view with `setBounds`. The browser
   uses an iframe, whose placement is the document's own layout. This is strictly simpler: the
   coordinate protocol the desktop client needs to keep the native view aligned with the panel
   does not exist here.

The proxy must listen on its own loopback origin, separate from the WebUI's own origin. Serving a
Mini App from the WebUI's origin would make the iframe same-origin: it would then run in the
WebUI's renderer process, so a hung Mini App page would hang the whole client, and the page could
read the WebUI session token off its parent frame. A separate origin keeps the page in its own
process and keeps the client credential out of its reach. The Mini App view is therefore **not**
sandboxed; its isolation comes from origin separation, not from a sandbox attribute. That is the
opposite of the workspace file preview, which deliberately renders an untrusted document in a
sandboxed, opaque-origin iframe.

## What is not carried over

- **Native window semantics.** The desktop client's detached presentation is a separate operating
  system window with always-on-top, click-through, transparent, frameless and skip-taskbar options
  and persisted window bounds. A browser tab cannot express any of them. The WebUI keeps the part
  that a browser can honour — the Mini App alone on screen, and a tab the user can drag to a second
  display — and drops the native window options.
- **The page-side window handle.** `window.mcode.miniapp.window` and its `inline`/`window` mode
  switch have no browser equivalent that is worth carrying. The standalone view is a presentation
  the client chooses, not a mode a Mini App page can request.
- **Host-to-page injection.** The desktop client can inject into an embedded page: the agent cursor
  overlay and the comment bridge. A cross-origin Mini App page cannot be reached that way, so a
  Mini App page does not get them.
- **Moving one live page between presentations.** The desktop client moves the same
  `WebContents` into a window and back into the File Panel, so the page is one instance with one
  state. A browser tab is a separate document. A Mini App shown in two places is two documents:
  server-side state is shared, in-page state is not.

## Runtime seams

Three changes make the Mini App capability reachable from this client. None of them introduces
new domain behaviour; they expose what the runtime already owns.

- **The Mini App service is enabled for this client's runtime owner kind.**
  `resolveRuntimeMiniAppOptions` in `packages/local-runtime-v2/src/service/miniapp/composition.ts`
  returns no options unless the owner kind is `electron`, so in the WebUI process the Mini App
  supervisor is never initialized and `miniappAvailable` is false. That gate becomes a cell of the
  runtime owner policy instead of a kind comparison of its own. The policy table
  (`packages/local-runtime/src/runtime/runtime-owner-policy.ts`) already resolves once per host and
  already drives the other owner-derived service gates — `wiring.cronService`,
  `wiring.channelService`, `wiring.schedulerHost` — from that one descriptor; the Mini App gate
  is decided outside it, which is why a change to this client's row cannot reach it. The Mini App
  service becomes a wiring cell, this client's row carries it, and `resolveRuntimeMiniAppOptions`
  reads the cell rather than the raw kind string. Two consequences follow. The explicit Mini App
  options the function already accepts become reachable for every row that carries the cell, not
  only the Electron row. And the two places that read the function — the service composition and
  the `miniappAvailable` capability flag — are driven by the same cell, so the flag can no longer
  disagree with the service.
- **The control plane enters the harness as a forwarding facade.** The desktop client keeps the
  Mini App control plane in its Electron main process, behind IPC channels that reach a utility
  broker; there is no Mini App method on `CliService` there or here. The runtime already owns the
  behaviour in
  `packages/local-runtime-v2/src/application/session/process-local-miniapp-application.ts`, which
  lists and opens Mini Apps. The client entry is a forwarding method on `CliService` over that
  application, bound as a WebUI operation in the usual five places. The WebUI does not reimplement
  Mini App lifecycle logic in its server, and it does not reach around the facade into the
  application bag.
- **The presenter stays a host-owned port.** `MiniAppPresenter` is documented as the desktop
  client's native presenter and is absent outside it. The WebUI supplies the browser
  implementation: its `open` means the client should show that Mini App, and its `close` means the
  client stops showing it. The port's shape — open and close by session and plugin — is already
  platform-neutral, so the browser implementation fits it without changing the contract.

## The contract baseline is an open question

The Mini App contract in this repository is one generation behind the Mini App implementation
shipped in the desktop client. The facts, verified against both:

- `packages/shared/src/miniapp-surface.ts` here is 54 lines. The shipped client's is 1267, and adds
  the loopback credential header (`x-mavis-miniapp-token`), the page-bridge contracts for the
  composer, the agent and the window handle, and the split between starting a Mini App and
  opening its page.
- The shipped client guards the Mini App's own HTTP server: every request must carry the
  Host-issued credential and the exact loopback host, or it is answered 401, and the same guard
  covers WebSocket upgrades. This repository's runtime has no such guard.
- This repository and the public upstream are identical on these files, and the newer contract
  appears nowhere in the upstream tree. It exists only in the internal tree the desktop client was
  built from, so no upstream synchronization will deliver it.

This matters because the WebUI shares the data directory with the desktop client (ADR 0006), so
the Mini App packages installed on a machine are the newer generation, and their pages call the
newer page bridge. The bridge is therefore required for those packages to work. The credential
guard is a separate question: without it the Mini App's loopback port answers any local process
that finds it, which is weaker than the desktop client but is not worse than this repository's
current behaviour, which is to have no Mini App service at all.

The options are to forward-port the page-bridge contracts and the browser bridge only, leaving the
guard for later; to forward-port the whole contract including the runtime guard, at the cost of
bringing an unpublished internal contract into this repository ahead of upstream; or to build the
carrying surface first and settle the contract when the work starts. The bridge rewrite cannot be
finished before this is settled, because the API surface it must implement is defined by the
contract. This ADR records the question; it does not settle it.

## Open implementation questions

1. **The contract baseline.** Which of the three options above is taken, and therefore whether the
   proxy injects a credential at all.
2. **The bridge rewrite.** Which page-bridge methods the browser build implements, which
   error codes it reproduces exactly, and how the agent request identifiers, the permission reply
   and the questionnaire answer path cross the `postMessage` boundary.
3. **The proxy's own shape.** Its loopback origin and route layout, what it forwards, how it
   handles the Mini App's WebSocket connections, and which response headers it must drop so the
   page can be framed at all.
4. **The entry point.** Where a user opens a Mini App from in this client. The plugin business
   already lists installed plugins; a Mini App entry needs its own home, and the composer and
   agent paths that open Mini Apps in the desktop client need a counterpart.
5. **The standalone view's session semantics.** Which session the deep link selects, what the view
   shows when that session has ended, and how the tab behaves when the Mini App's runtime stops
   while the tab is open.
6. **The inline view's home.** Which workspace panel view hosts the Mini App, how it coexists with
   the file tree, the preview and the terminal, and what happens to a Mini App open when the panel
   is closed.

## Research findings

- The desktop client hosts a Mini App in a native view and moves that same view into its own
  window; returning it to the panel is described in the desktop client's own code as returning it
  to the File Panel host (`app/dist/main/modules/browser/embedded-browser-manager.js`,
  `detachMiniAppTab` and `attachMiniAppTab`).
- The desktop client injects the loopback credential at the session layer, scoped to the managed
  tab's own origin (`app/dist/main/modules/browser/miniapp-loopback-auth.js`).
- The desktop client injects the page bridge with an Electron preload, and the bridge's own
  namespace is `window.mcode.miniapp` with a message, an agent and a window part
  (`app/dist/main/modules/browser/miniapp-preload.js`).
- The shipped client guards the Mini App's HTTP server in the Mini App's own process, before
  plugin code observes a request
  (`app/node_modules/@mavis/local-runtime-v2/src/service/miniapp/process/node-runtime/host-runner.ts`).
- The desktop client's Mini App control plane is Electron main-process IPC over a utility broker,
  and none of it is on `CliService`
  (`app/dist/main/ipc/miniApp.ipc.js`, `app/dist/main/modules/local-runtime/utility/miniapp-broker.js`).
- This client injects its runtime configuration into every page it serves, so a tab opened by
  deep link is an ordinary client (`packages/webui/src/server/http/client-assets.ts`).
- This client already renders one foreign document in an iframe, under the opposite isolation
  choice: a sandboxed, opaque origin (`packages/webui/src/client/features/workspace/ui/WorkspaceHtmlPreview.tsx`,
  `packages/webui/src/server/http/workspace-file.ts`).
- The runtime owner policy is resolved once per host into a descriptor that the harness reads its
  cells from, and the Mini App gate is decided outside that descriptor. The same repository
  documents the Mini App, greeting and context-inspector gates as owner-kind branches that no
  change to this client's row reaches
  (`packages/local-runtime-v2/src/services.ts`,
  `packages/local-runtime-v2/src/service/llm-context-inspector/initialize.ts`,
  `packages/webui/docs/known-gaps.md` §2).
