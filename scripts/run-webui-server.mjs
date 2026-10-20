// Development-only WebUI runtime server. Vite serves the browser client; this
// process owns the loopback WebSocket service on WEBUI_SERVER_PORT.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.WEBUI_SERVER_TSX) {
  const tsconfigPath = fileURLToPath(
    new URL("../tsconfig.standalone.json", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx/esm", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: tsconfigPath,
        WEBUI_SERVER_TSX: "1",
      },
    },
  );
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
} else {
  const os = await import("node:os");
  const path = await import("node:path");
  const { createWebuiRuntimeHost, createHarnessPortFromHost, createBrowserAdapter, WebuiTerminalManager } =
    await import("../packages/webui/src/runtime/index.ts");
  const { WebuiService, createOperationRegistry } =
    await import("../packages/webui/src/server/index.ts");
  const { BrowserBridgeServer } =
    await import("../packages/webui/src/server/browser-bridge/index.ts");
  const dataDir =
    process.env.MINIMAX_DATA_DIR?.trim() || path.join(os.homedir(), ".minimax");
  const tcpPort = Number(process.env.WEBUI_SERVER_PORT ?? 8787);
  const clientDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist-webui/client",
  );
  // The extension bridge is assembled here rather than inside the adapter: the
  // layer matrix forbids `src/runtime/**` from importing `src/server/**`, so
  // this file — outside the layer system — is the one place that can hold the
  // bridge, hand its provider factory to the adapter and give the same instance
  // to the service's `/browser-bridge` upgrade branch. `dev: true` is passed
  // through unchanged; the bridge's admission ignores it by design.
  const browserBridge = new BrowserBridgeServer({ host: "127.0.0.1", dev: true });
  await browserBridge.start();
  // The browser adapter is built before the runtime host, because the host is
  // what takes the browser provider: the adapter reads its authorization
  // switches through the host, so the host is attached to it immediately after.
  //
  // The same binding carries both faces of the one browser session — the port
  // the browser operations bind to, and the Agent's browser tools. Building the
  // tool adapter anywhere else would put the Agent on a second browser, and the
  // panel would show the first.
  const browser = createBrowserAdapter({ dataDir, bridge: browserBridge });
  const assembled = await createWebuiRuntimeHost({
    dataDir,
    appVersion: "webui-dev",
    browserProvider: {
      adapter: browser.toolAdapter,
      close: () => browser.close(),
    },
    // One compact Browser tool over the restricted command set. The detailed
    // per-action tools would re-offer the same actions under their own names.
    browserToolExposure: "compact",
  });
  browser.attachHost(assembled.host);
  const port = createHarnessPortFromHost(assembled.host);
  // The registry and the terminal port are assembled here, by the host, and the
  // network service binds what it was handed (T14). The manager itself belongs to
  // this service's resource scope — one per service, not a host-wide singleton
  // (T15) — and the service ends every PTY it owns in `close()`.
  const terminal = new WebuiTerminalManager();
  // The adapter is absent when the host cannot answer the browser
  // authorization at all, and the browser operations then stay unregistered.
  //
  // The bridge's pairings follow the switches, so the persisted authorization
  // has to reach them before the service starts serving.
  await browser.initialize();
  const service = new WebuiService({
    port,
    operations: createOperationRegistry(port, terminal, browser.port, browserBridge),
    terminal,
    tcpPort,
    dev: true,
    clientDir,
    browserBridge,
  });
  const info = await service.start();
  console.log(`[webui] server listening at ${info.boundUrl}`);
  const close = async () => {
    await service.close();
    await browser.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}
