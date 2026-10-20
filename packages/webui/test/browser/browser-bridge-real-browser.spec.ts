// The browser bridge, against a real Chrome with the real extension.
//
// The external path has only ever been exercised against a synthetic peer. A
// synthetic peer proves the protocol; it does not prove that a browser can
// load the extension, run its service worker, hold a key in
// `chrome.storage.local` and answer a challenge with it.
//
// This spec does both halves against a real Chrome:
//
//   * the **happy path** — the extension loads, is provisioned, connects and
//     completes the handshake, and the host reports a connected surface;
//   * the **refusal** — the same extension without the installation key is
//     refused, and the host reports no connected surface.
//
// The refusal is the half that matters. A test that only proves the happy
// path would pass against a bridge that hands its credential to anybody.

import { execFile } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium, type BrowserContext, type Worker } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { BrowserBridgeServer } from "../../src/server/browser-bridge/server.js";
import { createInMemorySecureCredentialStore } from "../../src/server/browser-bridge/credential-store.js";

const run = promisify(execFile);

/**
 * The slice of the extension API this spec uses.
 *
 * The callbacks below are serialized and run inside the extension's service
 * worker, where `chrome` exists; the WebUI's test tsconfig does not carry the
 * extension's ambient types, so the slice it uses is declared here rather than
 * pulling a whole API surface into a test that touches four members of it.
 */
declare const chrome: {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
    session: {
      get(key: string): Promise<Record<string, unknown>>;
    };
  };
  runtime: { reload(): Promise<void>; sendMessage(message: unknown): Promise<unknown> };
};
// The spec lives at packages/webui/test/browser/, so the repository root is
// four levels up from the file's directory.
const repoRoot = resolve(new URL("../../../..", import.meta.url).pathname);
const extensionDist = join(repoRoot, "packages/browser-extension/dist");

/** The storage keys the extension keeps its configuration under. */
const ORIGIN_STORAGE_KEY = "webui.browserBridge.origin";
const INSTALLATION_KEY_STORAGE_KEY = "webui.browserBridge.installationKey.v1";

/** How long to wait for the extension to connect before calling it a failure. */
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * Builds the extension.
 *
 * The source directory is not loadable: a browser extension runtime executes
 * JavaScript only, and the source manifest points the service worker at a
 * `.ts` file. The build is what a browser can actually run.
 */
async function buildExtension(): Promise<void> {
  await run("pnpm", ["--filter", "@mavis/browser-extension", "build"], {
    cwd: repoRoot,
    timeout: 120_000,
  });
}

/** The extension's id, read off the service worker's URL. */
function extensionIdOf(worker: Worker): string {
  const match = /^chrome-extension:\/\/([a-p]{32})\//u.exec(worker.url());
  if (!match) throw new Error(`unexpected service worker url: ${worker.url()}`);
  return match[1]!;
}

/**
 * Launches Chrome with the built extension loaded.
 *
 * The id of an unpacked extension is derived from its load path, so it is
 * stable for this directory — but it is read at runtime rather than
 * hard-coded, because a different path means a different id and a hard-coded
 * one would silently stop matching the allowlist.
 */
async function launchWithExtension(channel: "msedge" | "chromium"): Promise<{
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  profileDir: string;
}> {
  const profileDir = await mkdtemp(join(tmpdir(), "webui-bridge-real-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    // "chromium" is the bundled browser and "msedge" is the installed Edge.
    // The extension is one package for both, and the only thing that differs
    // is the browser it runs in — which is exactly what this suite measures.
    channel,
    args: [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30_000 });
  return { context, worker, extensionId: extensionIdOf(worker), profileDir };
}

/**
 * Provisions the extension and restarts its service worker.
 *
 * The worker reads the host's address when it starts and exits if there is
 * none, so the storage has to be written *before* the worker next runs. It is
 * written from inside the running worker and the worker is then reloaded,
 * which is what a person pasting into the options page amounts to.
 */
async function provision(
  worker: Worker,
  context: BrowserContext,
  extensionId: string,
  origin: string,
  installationKey: string | undefined,
): Promise<void> {
  await worker.evaluate(
    async ({ originKey, keyKey, secret, host }) => {
      // The host is passed in by name. A bare `origin` here would resolve to
      // the *extension's* origin — a service worker has one — and the
      // extension would then try to connect to itself.
      await chrome.storage.local.set({ [originKey]: host });
      if (secret) {
        await chrome.storage.local.set({ [keyKey]: { secret } });
      } else {
        await chrome.storage.local.remove(keyKey);
      }
    },
    {
      originKey: ORIGIN_STORAGE_KEY,
      keyKey: INSTALLATION_KEY_STORAGE_KEY,
      secret: installationKey,
      host: origin,
    },
  );
  // Wake the worker the way the options page does. A Manifest V3 service
  // worker is lazy, so saving the key does not by itself start it, and the
  // message has to come from a *page* — a message sent by the worker is not
  // delivered to the worker's own listener.
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.evaluate(
      (type) => chrome.runtime.sendMessage({ type }),
      "webui-bridge-reconnect",
    );
  } finally {
    await page.close();
  }
}

/** Starts the bridge behind an HTTP server the spec owns. */
async function startBridge(
  extensionId: string,
  surface: "edge" | "chrome",
): Promise<{
  bridge: BrowserBridgeServer;
  origin: string;
  close: () => Promise<void>;
}> {
  const bridge = new BrowserBridgeServer({
    host: "127.0.0.1",
    dev: true,
    credentialStore: createInMemorySecureCredentialStore(),
    // The allowlist is per surface, and so is the pairing. A browser running
    // the extension has to be admitted on **its own** surface, or the Edge
    // run would prove nothing about the Edge switch.
    env:
      surface === "edge"
        ? { MAVIS_BROWSER_EDGE_EXTENSION_IDS: extensionId }
        : { MAVIS_BROWSER_CHROME_EXTENSION_IDS: extensionId },
  });
  await bridge.start();
  await bridge.enableSurface(surface);

  const http = createServer((_request, response) => {
    response.writeHead(426).end();
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : 0;
  http.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    bridge.handleUpgrade(request, socket, head);
  });
  return {
    bridge,
    // The extension takes the loopback origin in its http form and converts
    // it to ws, the way the WebUI's own workspace-file URL does. It also
    // appends the bridge path itself, so the origin must not carry one.
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await bridge.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

async function waitForConnected(
  bridge: BrowserBridgeServer,
  surface: "edge" | "chrome",
  connected: boolean,
  worker?: Worker,
): Promise<void> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (bridge.snapshot().surfaces[surface].connected === connected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Both sides record what they thought happened; without them a failure here
  // says only "not connected", which is not a diagnosis.
  const snapshot = bridge.snapshot().surfaces[surface];
  const lastError = await worker
    ?.evaluate(() => chrome.storage.session.get("webui.browserBridge.lastError"))
    .catch(() => undefined);
  throw new Error(
    `the surface did not reach connected=${connected}: host=${JSON.stringify(snapshot)} extension=${JSON.stringify(lastError)}`,
  );
}

/**
 * The browsers the extension is exercised against.
 *
 * Edge and Chrome are both installed on this machine, and the extension is one
 * package for both, so the acceptance runs against each.
 */
const BROWSERS = [
  { channel: "chromium", surface: "chrome" },
  { channel: "msedge", surface: "edge" },
] as const;

test.describe("the browser bridge, against a real browser", () => {
  test.beforeAll(async () => {
    await buildExtension();
  });

  for (const { channel, surface } of BROWSERS) {
    test(`the extension completes the handshake on the ${surface} surface in ${channel} once it can prove the installation key`, async () => {
      test.setTimeout(180_000);
      const { context, worker, extensionId, profileDir } = await launchWithExtension(channel);
      const started = await startBridge(extensionId, surface);
      try {
        // The key belongs to the surface the browser is being admitted on.
        const view = await started.bridge.readInstallationKey(surface);
        expect(view).toBeDefined();

        await provision(worker, context, extensionId, started.origin, view!.key);
        await waitForConnected(started.bridge, surface, true, worker);

        // The host is the authority: it is the host that decides a surface is
        // connected, not the extension's own belief that it connected.
        // The **matching** surface: an Edge-hosted extension has to be
        // admitted on the Edge surface, which is a separate switch, a
        // separate credential and a separate allowlist.
        expect(started.bridge.snapshot().surfaces[surface].connected).toBe(true);
        expect(started.bridge.snapshot().surfaces[surface].enabled).toBe(true);
      } finally {
        await started.close();
        await context.close();
        await rm(profileDir, { recursive: true, force: true });
      }
    });

    test(`an extension that cannot prove the installation key is refused on the ${surface} surface in ${channel}`, async () => {
      test.setTimeout(180_000);
      const { context, worker, extensionId, profileDir } = await launchWithExtension(channel);
      const started = await startBridge(extensionId, surface);
      try {
        // The same extension, connected to the same host, but with no key.
        await provision(worker, context, extensionId, started.origin, undefined);
        await waitForConnected(started.bridge, surface, false, worker);

        // It must not have been admitted, and the host must not have handed it a
        // credential.
        expect(started.bridge.snapshot().surfaces[surface].connected).toBe(false);
      } finally {
        await started.close();
        await context.close();
        await rm(profileDir, { recursive: true, force: true });
      }
    });
  }
});
