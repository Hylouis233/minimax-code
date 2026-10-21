// The credential must never appear in output.
//
// The ticket asks for a test that *observes* a credential never appearing in
// captured log output, and that is a different kind of assertion from the
// others in this area: the others check what the code decides, and this one
// checks what the code *emits*. A credential that reaches a log has been
// disclosed — logs are copied, shipped and read by people who are not the
// person whose browser it is.
//
// So the whole exchange is run with the output captured: the console, both
// process streams, and the frames the host sends. The credential the host
// minted is watched in every form it could take — the raw bytes, the base64
// the store keeps, the hex — and none of them may appear.
//
// The frames are captured too, because a credential that travels in the clear
// inside the `pair` frame would be a disclosure too. It must be sealed.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  BrowserBridgeServer,
  exportWebuiBrowserBridgeEcdhPublicKey,
  generateWebuiBrowserBridgeEcdhKeyPair,
  type SecureCredentialStore,
} from "../../src/server/browser-bridge/index.js";
import { WEBUI_BROWSER_BRIDGE_PATH } from "../../src/shared/contracts/browser-bridge.js";
import type { WebuiBrowserBridgeHostFrame } from "../../src/shared/contracts/browser-bridge.js";

const EDGE_EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab";
const BROWSER_ID = "edge-instance-1";

/**
 * A store that remembers what it was asked to keep.
 *
 * The in-memory store deliberately hides its contents, and it should: the
 * production code must not be able to read the secret back casually. This
 * spy exists so the *test* can see the bytes, which is the one place they
 * have to be visible.
 */
function createSpyStore(): { readonly store: SecureCredentialStore; readonly secrets: Uint8Array[] } {
  const secrets: Uint8Array[] = [];
  const entries = new Map<string, { secret: Uint8Array; savedAt: number }>();
  return {
    secrets,
    store: {
      async isAvailable() {
        return true;
      },
      async save(keyId, secret) {
        secrets.push(secret);
        entries.set(keyId, { secret, savedAt: Date.now() });
      },
      async load(keyId) {
        return entries.get(keyId)?.secret;
      },
      async delete(keyId) {
        entries.delete(keyId);
      },
      async list() {
        return [...entries.keys()].map((keyId) => ({
          keyId,
          fingerprint: "spy",
          savedAt: 0,
        }));
      },
    },
  };
}

/**
 * Captures everything the process writes while a body runs.
 *
 * The console methods and both process streams are the places a diagnostic
 * ends up. A credential in any of them has been disclosed.
 */
async function captureOutput<T>(body: () => Promise<T>): Promise<{ readonly value: T; readonly output: string }> {
  const chunks: string[] = [];
  const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = new Map<string, (...args: unknown[]) => void>();
  for (const method of consoleMethods) {
    originals.set(method, console[method].bind(console));
    console[method] = (...args: unknown[]) => {
      chunks.push(args.map((arg) => String(arg)).join(" "));
    };
  }
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const value = await body();
    return { value, output: chunks.join("\n") };
  } finally {
    for (const method of consoleMethods) {
      console[method] = originals.get(method)! as typeof console.log;
    }
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

describe("WebUI bridge credential secrecy", () => {
  const open: (() => Promise<void>)[] = [];

  afterEach(async () => {
    while (open.length > 0) {
      await open.pop()?.();
    }
  });

  it("never writes the credential to the console, the process streams, or a frame", async () => {
    const spy = createSpyStore();
    const bridge = new BrowserBridgeServer({
      host: "127.0.0.1",
      dev: true,
      credentialStore: spy.store,
      env: { MAVIS_BROWSER_EDGE_EXTENSION_IDS: EDGE_EXTENSION_ID },
    });
    await bridge.start();
    await bridge.enableSurface("edge");
    const httpServer: Server = createServer();
    const frames: WebuiBrowserBridgeHostFrame[] = [];
    let client: WebSocket | undefined;

    httpServer.on("upgrade", (request, socket, head) => {
      bridge.handleUpgrade(request, socket, head);
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (httpServer.address() as AddressInfo).port;
    open.push(async () => {
      client?.terminate();
      await bridge.close();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    });

    const captured = await captureOutput(async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${WEBUI_BROWSER_BRIDGE_PATH}`, {
        headers: { origin: `chrome-extension://${EDGE_EXTENSION_ID}/` },
      });
      client = socket;
      socket.on("message", (data) => {
        try {
          frames.push(JSON.parse(String(data)) as WebuiBrowserBridgeHostFrame);
        } catch {
          // Not a bridge frame.
        }
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });

      // The extension introduces itself with its own ephemeral public key, and
      // answers the challenge with the installation key — the branch in which
      // the host seals the credential and sends it.
      const { publicKey } = await generateWebuiBrowserBridgeEcdhKeyPair();
      socket.send(
        JSON.stringify({
          kind: "hello",
          browser: "edge",
          browserId: BROWSER_ID,
          extensionVersion: "1.0.0",
          publicKey: await exportWebuiBrowserBridgeEcdhPublicKey(publicKey),
        }),
      );
      const pairing = bridge.pairings.get("edge");
      if (!pairing) throw new Error("no edge pairing");
      const challenge = await waitForKind(frames, "challenge");
      socket.send(
        JSON.stringify({
          kind: "proof",
          keyId: challenge.installationKeyId,
          nonce: challenge.nonce,
          signature: await pairing.signInstallationKeyProof(challenge.nonce),
        }),
      );
      await waitForKind(frames, "pair");
      await waitForKind(frames, "ready");
    });

    // The host stored what it keeps: the installation key and the pairing
    // credential. Both are secret material, so neither may appear in output.
    expect(spy.secrets.length).toBeGreaterThanOrEqual(1);
    for (const secret of spy.secrets) {
      expect(secret.byteLength).toBeGreaterThan(0);
    }

    // Every form a secret could take in a log.
    const forms = spy.secrets.flatMap((secret) => [
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("hex"),
      Buffer.from(secret).toString("utf8"),
    ]);
    for (const form of forms) {
      expect(captured.output).not.toContain(form);
    }

    // And the frames the host sent must not carry them either: the credential
    // travels sealed, not in the clear.
    const pairFrame = frames.find((frame) => frame.kind === "pair");
    expect(pairFrame).toBeDefined();
    const pairText = JSON.stringify(pairFrame);
    for (const form of forms) {
      expect(pairText).not.toContain(form);
    }
  });
});

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
