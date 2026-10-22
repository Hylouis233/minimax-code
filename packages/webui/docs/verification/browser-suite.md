# The built-client browser suite

`pnpm test:webui-browser` drives the built client — `dist-webui/client/index.html`, `client.js` and
`styles.css` — in a real browser. Run `pnpm build:webui` first; the script installs the
lockfile-pinned Chromium revision when it is missing. The deterministic cases are evidence level 4 in
[`gates.md`](gates.md): the built client and its transport wiring are real, the server behind them is
not in the deterministic fixture cases. `native-runtime.spec.mjs` additionally boots the real
assembly, loopback service and native PTY bridge in a separate process with an isolated,
credential-free data directory. It serves the same built client in explicit loopback development
mode. It verifies process ownership and shutdown, not credential or provider authentication.

## What the fixture does

The fixture replaces the browser's `WebSocket` constructor before the built client script executes.
The client's normal `createWebuiTransport` path then sends real WebUI wire envelopes to the
deterministic in-page fixture. Session ids, messages, timestamps, cursors and stream events are
synthetic. This covers the built browser client and its transport wiring; it does **not** start the
production WebUI service or a runtime host. The native spec installs no fixture transport;
it verifies cross-page attach/detach, delayed create response, reload at five-process capacity,
explicit close and actual native exit events at service shutdown. It requires working `node-pty`
and runs in the browser gate, after the client build and Chromium installation.

Live and completed turn visibility is asserted from controlled stream frames while the indicator
remains unmodified.

## The browser family in the fixture

The fixture answers the **browser** operations too, with a synthetic browser: the switches
(`getBrowserAuthorization`, `setBrowserAuthorization`), the surfaces (`listBrowserCapabilities`), the
session's web tabs (`watchBrowserWebTabs`, `openBrowserWebTab`, `closeBrowserWebTab`), the page
(`watchBrowserFrames`), and the gestures and commands aimed at a page (`sendBrowserInput`,
`sendBrowserCommand`, `listBrowserTargets`, `selectBrowserTarget`). A test stages what the browser
holds with `window.__fixture.setBrowserTabs(...)`, marks the Agent's page with
`window.__fixture.setBrowserSelection(targetId)`, and turns a surface off with
`window.__fixture.setBrowserAuthorization(...)`.

The page the fixture paints is drawn by the fixture itself: a white sheet with the tab's title and
url on it. A one-pixel image would prove that the image path works and nothing else — a screenshot
of the panel would show a grey box — so the panel shows the page the test asked for.

What this proves is the **client's** half: that the panel draws a window, that the strip and the
toolbar follow what the runtime published, that the page the Agent is on is named where a browser
has no such mark, and that a gesture lands on the page in front. It does **not** prove the
runtime's browser behaviour. The isolated Chromium, the extension and the bridge are proven by the
runtime's own integration suites and by `browser-bridge-real-*.spec.mjs`, which launch a real
browser instead of answering from a page.

## Determinism

Playwright uses one pinned Linux viewport (1440×900, DPR 1, `zh-CN`, `Asia/Shanghai`, light colour
scheme, reduced motion). No screenshot and no whole-HTML snapshot is used, so a passing run means the
assertions held, not that a hash matched.

The harness starts with a random server id, and every test asserts that both `/health` and the served
page report **this run's** id. That assertion is registered on the `test` that `harness.mjs` exports,
so a spec gets it by importing `test` from there instead of from `@playwright/test` — it cannot be
left out by a new spec, and a test that runs against any other build fails instead of passing
quietly.

Playwright starts its own harness server on port 4179 and reuses an already-running one only when
`WEBUI_BROWSER_REUSE=1` is set. Without it, a busy port is an error rather than a silent adoption of
whatever process happens to answer there. Set `WEBUI_BROWSER_SERVER_ID` as well to give a
deliberately reused server a known id that matches the run. CI never reuses either way.

## Layout

The suite lives in `packages/webui/test/browser/`: one `*.spec.mjs` per surface, plus
`harness.mjs` (page helpers — fixture configuration, session switching, stream emission, selectors)
and `fixture.mjs` (the deterministic in-page transport). Run the directory rather than a hand-kept
list: Playwright collects every spec in it.

## Protocol startup acceptance

The browser reads the version handshake before constructing business owners. An incompatible
protocol renders the startup fallback without installing event ingress. An absent optional Terminal
bridge remains a local availability state and allows the other businesses to start. The capability
browser cases cover absent, not-ready, missing legacy roster, permission refusal and readiness after
reconnect. The provider case holds the first write while a second toggle changes pending intent.
