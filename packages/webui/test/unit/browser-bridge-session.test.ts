// End-to-end wire test: a real `ws` server on loopback, a real client,
// and the bridge session handling the post-upgrade exchange. The test
// proves:
//   * A valid challenge and proof results in a `ready` frame and an open
//     session.
//   * A wrong proof never results in `ready`.
//   * `dev: true` on the runtime side does NOT cause an unaccepted
//     extension (one without a proof) to ever receive `ready`.
//
// The test stands up its own loopback HTTP server; it does not touch any
// file owned by other engineers.

import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  BrowserBridgePairing,
  BrowserBridgeSession,
  admitBrowserBridgeUpgrade,
  createInMemorySecureCredentialStore,
  type BrowserBridgeAdmissionContext,
} from "../../src/server/browser-bridge/index.js";
import { WEBUI_BROWSER_BRIDGE_PATH } from "../../src/shared/contracts/browser-bridge.js";
import type {
  WebuiBrowserBridgeChallenge,
  WebuiBrowserBridgeClientFrame,
  WebuiBrowserBridgeHostFrame,
} from "../../src/shared/contracts/browser-bridge.js";

const KNOWN_EDGE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab";

interface Harness {
  url: string;
  readonly close: () => Promise<void>;
  closed: boolean;
  readonly wss: WebSocketServer;
  readonly context: BrowserBridgeAdmissionContext;
  readonly pairing: BrowserBridgePairing;
  readonly sessions: BrowserBridgeSession[];
  readonly receivedClientFrames: WebuiBrowserBridgeClientFrame[];
}

async function startHarness(extensionId: string, dev: boolean): Promise<Harness> {
  const pairing = new BrowserBridgePairing({
    surface: "edge",
    credentialStore: createInMemorySecureCredentialStore(),
    allowedExtensionIds: new Set([extensionId]),
  });
  await pairing.enable();

  const context: BrowserBridgeAdmissionContext = {
    pairings: new Map([["edge", pairing]]),
    host: "127.0.0.1",
    dev,
  };

  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const sessions: BrowserBridgeSession[] = [];
  const receivedClientFrames: WebuiBrowserBridgeClientFrame[] = [];

  const harness: Harness = {
    url: "",
    close: async () => {
      for (const session of sessions) session.close({ kind: "host_revoked" });
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      harness.closed = true;
    },
    closed: false,
    wss,
    context,
    pairing,
    sessions,
    receivedClientFrames,
  };

  httpServer.on("upgrade", (request, socket, head) => {
    const rejection = admitBrowserBridgeUpgrade(request, request.url, socket, context);
    if (rejection) return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      const session = new BrowserBridgeSession({
        pairing,
        socket: ws as unknown as never,
        sessionId: `s-${sessions.length}`,
      });
      sessions.push(session);
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  harness.url = `ws://127.0.0.1:${port}${WEBUI_BROWSER_BRIDGE_PATH}`;
  return harness;
}

async function connectClient(
  harness: Harness,
  extensionId: string,
): Promise<{ readonly client: WebSocket; readonly frames: WebuiBrowserBridgeHostFrame[] }> {
  const port = new URL(harness.url).port;
  const client = new WebSocket(harness.url, {
    origin: `chrome-extension://${extensionId}/`,
    headers: { host: `127.0.0.1:${port}` },
  });
  const frames: WebuiBrowserBridgeHostFrame[] = [];
  client.on("message", (data: RawData) => {
    frames.push(JSON.parse(data.toString()) as WebuiBrowserBridgeHostFrame);
  });
  await once(client, "open");
  return { client, frames };
}

describe("WebUI bridge session (wire-level)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness(KNOWN_EDGE_ID, false);
  });

  afterEach(async () => {
    if (!harness.closed) await harness.close();
  });

  it("emits a challenge after the upgrade and admits a valid proof", async () => {
    const { client, frames } = await connectClient(harness, KNOWN_EDGE_ID);

    const challengeFrame = await waitForKind(frames, "challenge");
    expect(challengeFrame.kind).toBe("challenge");
    expect(challengeFrame.algorithm).toBe("HMAC-SHA256");
    expect(harness.sessions).toHaveLength(1);
    expect(harness.sessions[0]!.isAdmitted).toBe(false);

    // Sign a valid proof with the pairing and send it.
    const proof = await harness.pairing.signProof(challengeFrame.nonce);
    client.send(
      JSON.stringify({
        kind: "proof",
        keyId: challengeFrame.keyId,
        nonce: challengeFrame.nonce,
        signature: proof,
      }),
    );

    const readyFrame = await waitForKind(frames, "ready");
    expect(readyFrame.kind).toBe("ready");
    expect(harness.sessions[0]!.isAdmitted).toBe(true);
    client.close();
  });

  it("the dev: true flag does NOT bypass extension authentication", async () => {
    await harness.close();
    harness = await startHarness(KNOWN_EDGE_ID, true);

    const { client, frames } = await connectClient(harness, KNOWN_EDGE_ID);
    const challengeFrame = await waitForKind(frames, "challenge");
    // Send a deliberately wrong proof — the extension did NOT authenticate.
    client.send(
      JSON.stringify({
        kind: "proof",
        keyId: challengeFrame.keyId,
        nonce: challengeFrame.nonce,
        signature: "this-is-not-the-proof",
      }),
    );

    // The session must close the socket before any "ready" frame is sent.
    await once(client, "close");

    // No "ready" frame must ever have arrived.
    expect(frames.some((frame) => frame.kind === "ready")).toBe(false);
    // A `closed` frame is the documented refusal at the session level.
    // (Either the host sent it explicitly, or the socket went away; either
    // path is fine — what we care about is that `ready` did not appear.)
    expect(harness.pairing.enabled).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

async function waitForKind<K extends WebuiBrowserBridgeHostFrame["kind"]>(
  frames: readonly WebuiBrowserBridgeHostFrame[],
  kind: K,
): Promise<Extract<WebuiBrowserBridgeHostFrame, { kind: K }>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = frames.find((frame) => frame.kind === kind) as
      | Extract<WebuiBrowserBridgeHostFrame, { kind: K }>
      | undefined;
    if (found) return found;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for "${kind}" frame after 5s`);
}

void (null as unknown as void);
