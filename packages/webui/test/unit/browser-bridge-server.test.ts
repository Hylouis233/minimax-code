// The providers the bridge lends to the browser service.
//
// The bridge is only worth anything if the Edge and Chrome surfaces resolve to
// the live extension session: the panel's image stream, the panel's input and
// the Agent's browser tools all address the session through these providers.
// These tests drive the real chain — a loopback `http.Server`, the production
// `WebuiWebSocketServer` and a real `BrowserBridgeServer` — with a real `ws`
// extension client, so what is asserted is what a paired extension would see.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  BrowserBridgeServer,
  createInMemorySecureCredentialStore,
} from "../../src/server/browser-bridge/index.js";
import { WebuiWebSocketServer } from "../../src/server/websocket-server.js";
import { WEBUI_BROWSER_BRIDGE_PATH } from "../../src/shared/contracts/browser-bridge.js";
import { createWebuiCredential } from "../../src/server/credentials.js";
import type {
  WebuiBrowserImageFrame,
  WebuiBrowserInputCommand,
} from "../../src/shared/contracts/browser.js";

const EDGE_EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab";
const BROWSER_ID = "edge-instance-1";
const TARGET_ID = "TAB-1";

interface Harness {
  readonly bridge: BrowserBridgeServer;
  readonly httpServer: Server;
  readonly wsServer: WebuiWebSocketServer;
  readonly port: number;
  close(): Promise<void>;
}

const openHarnesses: Harness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

async function startHarness(): Promise<Harness> {
  const bridge = new BrowserBridgeServer({
    host: "127.0.0.1",
    dev: true,
    credentialStore: createInMemorySecureCredentialStore(),
    env: { MAVIS_BROWSER_EDGE_EXTENSION_IDS: EDGE_EXTENSION_ID },
  });
  await bridge.start();
  // The bridge does not switch a surface on by itself: the browser switches
  // own the pairings, and the service is where the two meet. A test switches
  // on exactly the surfaces its environment configures, which is what the
  // persisted switches do in a running host.
  await bridge.enableSurface("edge");
  const httpServer = createServer();
  const wsServer = new WebuiWebSocketServer({
    maxMessageBytes: 256 * 1024,
    heartbeatIntervalMs: 15_000,
    host: "127.0.0.1",
    boundTcpPort: () => (httpServer.address() as AddressInfo | null)?.port,
    credential: createWebuiCredential(),
    dev: true,
    operations: new Map(),
    isAccepting: () => true,
    browserBridge: bridge,
  });
  httpServer.on("upgrade", wsServer.handleUpgrade);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const harness: Harness = {
    bridge,
    httpServer,
    wsServer,
    port: (httpServer.address() as AddressInfo).port,
    close: async () => {
      await bridge.close();
      wsServer.closeConnections();
      await wsServer.close();
      // A test that failed mid-handshake can leave a half-open socket; the
      // listener would otherwise wait for it for the platform TCP timeout.
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
  openHarnesses.push(harness);
  return harness;
}

interface BridgeFrame {
  readonly kind: string;
  readonly [key: string]: unknown;
}

/**
 * A real extension client.
 *
 * Every frame is recorded from the moment the socket exists, before `open` is
 * awaited. That matters: the host issues its challenge as soon as the upgrade
 * completes, so a listener attached after `await open` can miss it.
 */
interface BridgeClient {
  readonly socket: WebSocket;
  readonly frames: BridgeFrame[];
  readonly opened: Promise<void>;
  waitFor<T extends object>(kind: string, timeoutMs?: number): Promise<T & BridgeFrame>;
}

function connectClient(url: string, headers: Record<string, string>): BridgeClient {
  const frames: BridgeFrame[] = [];
  const socket = new WebSocket(url, { headers });
  socket.on("message", (data) => {
    try {
      frames.push(JSON.parse(String(data)) as BridgeFrame);
    } catch {
      // Not a bridge frame; the session reports that itself.
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`upgrade refused with ${response.statusCode}`));
    });
    socket.once("error", reject);
  });
  const waitFor = async <T extends object>(
    kind: string,
    timeoutMs = 4_000,
  ): Promise<T & BridgeFrame> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = frames.find((frame) => frame.kind === kind);
      if (found) return found as T & BridgeFrame;
      if (Date.now() > deadline) throw new Error(`timed out waiting for a "${kind}" frame`);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  };
  return { socket, frames, opened, waitFor };
}

/**
 * Connect as an allowed extension, answer the challenge with the pairing's own
 * credential, and wait until the host reports the session ready.
 */
async function pairEdge(harness: Harness): Promise<BridgeClient> {
  const client = connectClient(`ws://127.0.0.1:${harness.port}${WEBUI_BROWSER_BRIDGE_PATH}`, {
    origin: `chrome-extension://${EDGE_EXTENSION_ID}/`,
  });
  await client.opened;
  // A real extension introduces itself; the host reads the instance identity
  // off this frame.
  client.socket.send(
    JSON.stringify({
      kind: "hello",
      browser: "edge",
      browserId: BROWSER_ID,
      extensionVersion: "1.0.0",
    }),
  );
  const pairing = harness.bridge.pairings.get("edge");
  if (!pairing) throw new Error("no edge pairing");
  const challenge = await client.waitFor<{ nonce: string; keyId: string }>("challenge");
  const signature = await pairing.signProof(challenge.nonce);
  client.socket.send(
    JSON.stringify({ kind: "proof", keyId: challenge.keyId, nonce: challenge.nonce, signature }),
  );
  await client.waitFor("ready");
  // The provider is handed out on `ready`, so let the registration settle.
  await settle();
  return client;
}

const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
};

function announceTarget(client: BridgeClient, generation: number): void {
  client.socket.send(
    JSON.stringify({
      kind: "targets",
      targets: [
        {
          browserId: BROWSER_ID,
          targetId: TARGET_ID,
          title: "Example",
          url: "https://example.com/",
          generation,
        },
      ],
    }),
  );
}

describe("WebUI browser bridge — the providers it lends to the browser service", () => {
  it("answers undefined for a surface with no connected extension", async () => {
    const harness = await startHarness();
    // "Nothing is paired" and "you may not use this surface" are different
    // facts; the first is what an unpaired Chrome reports here.
    expect(harness.bridge.createProvider("edge")).toBeUndefined();
    expect(harness.bridge.createProvider("chrome")).toBeUndefined();
  });

  it("lists the announced targets of the live extension session", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge");
    expect(provider).toBeDefined();
    expect(provider?.surface).toBe("edge");
    // The instance identity comes from the extension's own `hello` frame.
    expect(provider?.browserId).toBe(BROWSER_ID);

    announceTarget(client, 4);
    await settle();

    const targets = await provider!.listTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0]?.id).toEqual({
      surface: "edge",
      browserId: BROWSER_ID,
      targetId: TARGET_ID,
      generation: 4,
    });
    expect(targets[0]?.title).toBe("Example");
    expect(targets[0]?.status).toBe("open");
    client.socket.terminate();
  });

  it("stops answering once the extension session goes away", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    expect(harness.bridge.createProvider("edge")).toBeDefined();
    client.socket.terminate();
    await settle();
    expect(harness.bridge.createProvider("edge")).toBeUndefined();
  });

  it("forwards a raw DevTools command rather than refusing it", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge");
    expect(provider).toBeDefined();

    // The runtime decides whether a raw DevTools method is allowed — the
    // Full CDP switch — and the provider does not keep a second opinion
    // about that. What it must not do is refuse the command on the surface's
    // own authority, because that would make the Full CDP switch a lie.
    const outcome = await provider!
      .sendCommand(
        { targetId: "tab-1", generation: 1 },
        "Page.navigate",
        { url: "https://example.com/" },
      )
      .catch((error: unknown) => error);
    expect(outcome).not.toMatchObject({ code: "browser_capability_denied" });
    client.socket.terminate();
  });

  it("drops an extension frame whose generation the announcement moved past", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge")!;
    announceTarget(client, 7);
    await settle();

    const received: WebuiBrowserImageFrame[] = [];
    await provider.startImageStream(TARGET_ID, (frame) => received.push(frame));
    // A frame produced for the page the tab was on before the announcement
    // moved on. Relabelling it with the announcement's generation would put
    // the previous page on screen as the current one, so it is dropped.
    client.socket.send(
      JSON.stringify({
        kind: "frame",
        frame: {
          browserId: BROWSER_ID,
          targetId: TARGET_ID,
          generation: 1,
          data: "c3RhbGU=",
          format: "png",
          sequence: 4,
        },
      }),
    );
    await settle();

    expect(received).toHaveLength(0);
  });

  it("holds no credential and admits no session for a surface that is off", async () => {
    const harness = await startHarness();
    // The surface is on because the harness switched it on, the way a
    // switched-on browser would.
    const on = harness.bridge.snapshot().surfaces.edge;
    expect(on.enabled).toBe(true);

    // Turning it off revokes the credential, closes the session and refuses
    // the old credential from then on. The other surface is untouched: the two
    // browsers' authorizations are independent.
    await harness.bridge.disableSurface("edge");
    const off = harness.bridge.snapshot().surfaces.edge;
    expect(off.enabled).toBe(false);
    expect(harness.bridge.createProvider("edge")).toBeUndefined();

    // A fresh session is refused: the pairing holds no credential to answer a
    // challenge with.
    const client = connectClient(`ws://127.0.0.1:${harness.port}${WEBUI_BROWSER_BRIDGE_PATH}`, {
      origin: `chrome-extension://${EDGE_EXTENSION_ID}/`,
    });
    await client.opened;
    client.socket.send(
      JSON.stringify({ kind: "hello", browser: "edge", browserId: "edge-1", extensionVersion: "1.0.0" }),
    );
    await settle();
    expect(harness.bridge.createProvider("edge")).toBeUndefined();
  });

  it("delivers an extension frame to startImageStream with the announced identity", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge")!;
    announceTarget(client, 7);
    await settle();

    const received: WebuiBrowserImageFrame[] = [];
    await provider.startImageStream(TARGET_ID, (frame) => received.push(frame));
    client.socket.send(
      JSON.stringify({
        kind: "frame",
        frame: {
          browserId: BROWSER_ID,
          targetId: TARGET_ID,
          // The frame's generation matches the announcement's, so it belongs to
          // the page the tab is on now.
          generation: 7,
          data: "aW1hZ2U=",
          format: "png",
          sequence: 3,
        },
      }),
    );
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0]?.target).toEqual({
      surface: "edge",
      browserId: BROWSER_ID,
      targetId: TARGET_ID,
      generation: 7,
    });
    expect(received[0]?.data).toBe("aW1hZ2U=");
    expect(received[0]?.format).toBe("png");
    expect(received[0]?.sequence).toBe(3);

    await provider.stopImageStream(TARGET_ID);
    client.socket.send(
      JSON.stringify({
        kind: "frame",
        frame: {
          browserId: BROWSER_ID,
          targetId: TARGET_ID,
          generation: 7,
          data: "aWdub3JlZA==",
          format: "png",
          sequence: 4,
        },
      }),
    );
    await settle();
    expect(received).toHaveLength(1);
    client.socket.terminate();
  });

  it("dispatches an input through the registry and answers accepted", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge")!;
    announceTarget(client, 1);
    await settle();

    const command: WebuiBrowserInputCommand = {
      kind: "pointer",
      target: { surface: "edge", browserId: BROWSER_ID, targetId: TARGET_ID, generation: 1 },
      x: 120,
      y: 240,
      button: "left",
      clickCount: 1,
    };
    const pending = provider.sendInput(command);
    const input = await client.waitFor<{ commandId: string }>("input");
    client.socket.send(
      JSON.stringify({ kind: "input-result", commandId: input.commandId, accepted: true }),
    );
    await expect(pending).resolves.toBeUndefined();
    client.socket.terminate();
  });

  it("refuses an input naming a target no session announced, in the registry's words", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge")!;

    // The routing is the registry's, so the refusal is the registry's explicit
    // one — this provider only chooses the code that goes with it.
    await expect(
      provider.sendInput({
        kind: "text",
        target: {
          surface: "edge",
          browserId: BROWSER_ID,
          targetId: "TAB-NEVER-ANNOUNCED",
          generation: 1,
        },
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "browser_target_unknown" });
    await expect(
      provider.sendInput({
        kind: "text",
        target: {
          surface: "edge",
          browserId: BROWSER_ID,
          targetId: "TAB-NEVER-ANNOUNCED",
          generation: 1,
        },
        text: "hello",
      }),
    ).rejects.toThrow(/no bridge session announced target/u);
    client.socket.terminate();
  });

  it("refuses an input whose generation the announcement has moved past", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge")!;
    announceTarget(client, 9);
    await settle();

    await expect(
      provider.sendInput({
        kind: "key",
        target: { surface: "edge", browserId: BROWSER_ID, targetId: TARGET_ID, generation: 8 },
        key: "a",
        modifiers: [],
      }),
    ).rejects.toMatchObject({ code: "browser_target_stale" });
    client.socket.terminate();
  });

  it("keeps close() a no-op so a borrowed provider cannot drop a live session", async () => {
    const harness = await startHarness();
    const client = await pairEdge(harness);
    const provider = harness.bridge.createProvider("edge")!;
    await provider.close();
    // The bridge owns the session's lifetime, not the provider's.
    expect(harness.bridge.createProvider("edge")).toBeDefined();
    client.socket.terminate();
  });
});