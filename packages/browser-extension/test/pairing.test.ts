// No browser is involved here: `chrome.storage` is replaced by the small fakes
// below, and `crypto.getRandomValues` is injected wherever pairing would call it.
// What the fakes cover is the storage and randomness the extension depends on;
// nothing here talks to a real Chrome.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerWebuiBrowserBridgeChallenge,
  clearWebuiBrowserBridgePairingCredential,
  loadWebuiBrowserBridgePairingCredential,
  webuiBrowserBridgePairingStore,
  WEBUI_BROWSER_BRIDGE_PAIRING_STORAGE_KEY,
  WEBUI_BROWSER_BRIDGE_SECRET_BYTES,
  type WebuiBrowserBridgeStorageArea,
} from "../src/pairing.js";
import {
  encodeWebuiBrowserBridgeBase64,
  verifyWebuiBrowserBridgeProof,
} from "../src/protocol.js";

function fakeArea(): WebuiBrowserBridgeStorageArea & { readonly values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  return {
    values,
    async get(key) {
      const keys = key === null ? Object.keys(values) : Array.isArray(key) ? key : [key];
      const read: Record<string, unknown> = {};
      for (const name of keys) if (name in values) read[name] = values[name];
      return read;
    },
    async set(items) {
      Object.assign(values, items);
    },
    async remove(key) {
      for (const name of Array.isArray(key) ? key : [key]) delete values[name];
    },
  };
}

/** Deterministic "random" bytes so the generated secret can be asserted on. */
function countingRandomBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_value, index) => (index + 1) % 256);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pairing credential", () => {
  it("creates a high-entropy credential on first use and reuses it afterwards", async () => {
    const area = fakeArea();
    const store = webuiBrowserBridgePairingStore(area);

    const created = await loadWebuiBrowserBridgePairingCredential(store, "edge", countingRandomBytes);

    expect(created.secret).toHaveLength(WEBUI_BROWSER_BRIDGE_SECRET_BYTES);
    expect(WEBUI_BROWSER_BRIDGE_SECRET_BYTES).toBeGreaterThanOrEqual(32);
    expect(created.keyId.startsWith("edge-")).toBe(true);
    expect(area.values[WEBUI_BROWSER_BRIDGE_PAIRING_STORAGE_KEY]).toBeDefined();

    // A restarted service worker reads the credential again rather than finding
    // it gone: this is the whole reason the secret lives in storage.
    const reloaded = await loadWebuiBrowserBridgePairingCredential(store, "edge", countingRandomBytes);
    expect(reloaded.keyId).toBe(created.keyId);
    expect([...reloaded.secret]).toEqual([...created.secret]);
  });

  it("replaces a stored credential whose secret is missing or too short", async () => {
    const area = fakeArea();
    const store = webuiBrowserBridgePairingStore(area);
    await area.set({
      [WEBUI_BROWSER_BRIDGE_PAIRING_STORAGE_KEY]: {
        keyId: "edge-broken",
        secret: encodeWebuiBrowserBridgeBase64(new Uint8Array(4)),
      },
    });

    const credential = await loadWebuiBrowserBridgePairingCredential(store, "edge", countingRandomBytes);

    // A different credential, not a patched one: the host's stored record is
    // keyed by this id, and quietly reusing the old id with new bytes would
    // present a credential the host believes it has already rejected.
    expect(credential.keyId).not.toBe("edge-broken");
    expect(credential.secret).toHaveLength(WEBUI_BROWSER_BRIDGE_SECRET_BYTES);
    const stored = area.values[WEBUI_BROWSER_BRIDGE_PAIRING_STORAGE_KEY] as {
      keyId: string;
      secret: string;
    };
    expect(stored.keyId).toBe(credential.keyId);
  });

  it("forgets the credential only when the caller asks it to", async () => {
    const area = fakeArea();
    const store = webuiBrowserBridgePairingStore(area);
    await loadWebuiBrowserBridgePairingCredential(store, "chrome", countingRandomBytes);

    await clearWebuiBrowserBridgePairingCredential(store);

    expect(area.values[WEBUI_BROWSER_BRIDGE_PAIRING_STORAGE_KEY]).toBeUndefined();
  });
});

describe("challenge answering", () => {
  it("answers a challenge with a proof the host can verify", async () => {
    const credential = await loadWebuiBrowserBridgePairingCredential(
      webuiBrowserBridgePairingStore(fakeArea()),
      "edge",
      countingRandomBytes,
    );
    const challenge = {
      kind: "challenge",
      nonce: "nonce-abc",
      algorithm: "HMAC-SHA256",
      keyId: credential.keyId,
    } as const;

    const proof = await answerWebuiBrowserBridgeChallenge(challenge, credential);

    expect(proof.kind).toBe("proof");
    expect(proof.keyId).toBe(credential.keyId);
    expect(proof.nonce).toBe("nonce-abc");
    await expect(verifyWebuiBrowserBridgeProof(credential.secret, proof, "nonce-abc", credential.keyId)).resolves.toBe(
      true,
    );
  });

  it("answers a fresh challenge after a worker restart with the same credential", async () => {
    const store = webuiBrowserBridgePairingStore(fakeArea());
    const before = await loadWebuiBrowserBridgePairingCredential(store, "chrome", countingRandomBytes);
    // A restarted worker builds the client again from storage alone.
    const after = await loadWebuiBrowserBridgePairingCredential(store, "chrome", countingRandomBytes);
    const challenge = {
      kind: "challenge",
      nonce: "nonce-after-restart",
      algorithm: "HMAC-SHA256",
      keyId: after.keyId,
    } as const;

    const proof = await answerWebuiBrowserBridgeChallenge(challenge, after);

    expect(proof.keyId).toBe(before.keyId);
    await expect(
      verifyWebuiBrowserBridgeProof(after.secret, proof, "nonce-after-restart", after.keyId),
    ).resolves.toBe(true);
    // The proof is bound to its nonce, so the previous challenge's proof cannot
    // stand in for this one.
    await expect(
      verifyWebuiBrowserBridgeProof(after.secret, proof, "nonce-before-restart", after.keyId),
    ).resolves.toBe(false);
  });

  it("refuses a challenge for a credential it does not hold or an algorithm it does not implement", async () => {
    const credential = await loadWebuiBrowserBridgePairingCredential(
      webuiBrowserBridgePairingStore(fakeArea()),
      "edge",
      countingRandomBytes,
    );

    await expect(
      answerWebuiBrowserBridgeChallenge(
        { kind: "challenge", nonce: "n", algorithm: "HMAC-SHA256", keyId: "edge-someone-else" },
        credential,
      ),
    ).rejects.toThrow(/does not hold/);
    await expect(
      answerWebuiBrowserBridgeChallenge(
        { kind: "challenge", nonce: "n", algorithm: "HMAC-SHA1" as "HMAC-SHA256", keyId: credential.keyId },
        credential,
      ),
    ).rejects.toThrow(/algorithm/);
  });
});

describe("secret handling", () => {
  it("never writes the secret to the console", async () => {
    const calls: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }
    const store = webuiBrowserBridgePairingStore(fakeArea());
    const credential = await loadWebuiBrowserBridgePairingCredential(store, "edge", countingRandomBytes);
    await answerWebuiBrowserBridgeChallenge(
      { kind: "challenge", nonce: "nonce-abc", algorithm: "HMAC-SHA256", keyId: credential.keyId },
      credential,
    );

    expect(calls).toEqual([]);
    const encoded = encodeWebuiBrowserBridgeBase64(credential.secret);
    expect(JSON.stringify(calls)).not.toContain(encoded);
    expect(JSON.stringify(calls)).not.toContain("edge-");
  });
});