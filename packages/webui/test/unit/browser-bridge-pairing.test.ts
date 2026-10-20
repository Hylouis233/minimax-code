// Pairing is the credential lifecycle. The tests pin the behavioural
// claims the ADR makes:
//
//   * Each browser owns a distinct, high-entropy credential; the two
//     browsers never share.
//   * A valid challenge/proof round-trips through `verifyProof`.
//   * A wrong nonce, wrong key id, or tampered signature is rejected.
//   * A challenge can be answered only once.
//   * Re-enabling mints a fresh credential, distinct from the prior one.
//   * Disabling revokes the credential and rejects every later
//     presentation of the old one.

import { describe, expect, it } from "vitest";

import {
  BrowserBridgePairing,
  createInMemorySecureCredentialStore,
  generateBridgeCredential,
  PairingSwitchedOffError,
  signWebuiBrowserBridgeProof,
} from "../../src/server/browser-bridge/index.js";

const KNOWN_EXTENSION_IDS = new Set([
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab", // 32 letters, all in the a-p range — matches `chrome-extension://` id regex
]);
const DEV_EXTENSION_IDS = new Set([
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbba",
]);

function makePairing(surface: "edge" | "chrome") {
  return new BrowserBridgePairing({
    surface,
    credentialStore: createInMemorySecureCredentialStore(),
    allowedExtensionIds:
      surface === "edge" ? KNOWN_EXTENSION_IDS : DEV_EXTENSION_IDS,
  });
}

describe("BrowserBridgePairing — initial state", () => {
  it("starts disabled with no credential", () => {
    const pairing = makePairing("edge");
    expect(pairing.enabled).toBe(false);
    expect(pairing.keyId).toBeUndefined();
    expect(pairing.status().enabled).toBe(false);
  });
});

describe("BrowserBridgePairing — admit extension ids", () => {
  it("admits ids on the allowlist", () => {
    const edge = makePairing("edge");
    const chrome = makePairing("chrome");
    expect(edge.admitsExtensionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab")).toBe(true);
    expect(chrome.admitsExtensionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbba")).toBe(true);
  });

  it("rejects ids that are not on the allowlist", () => {
    const edge = makePairing("edge");
    // Chrome's id is not on edge's allowlist.
    expect(edge.admitsExtensionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbba")).toBe(false);
  });
});

describe("BrowserBridgePairing — challenge and proof", () => {
  it("round-trips a proof for a fresh credential", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const challenge = await pairing.issueChallenge();
    expect(challenge.kind).toBe("challenge");
    expect(challenge.algorithm).toBe("HMAC-SHA256");
    expect(challenge.keyId).toBe(pairing.keyId);
    expect(challenge.nonce.length).toBeGreaterThanOrEqual(32);
    const signed = await pairing.signProof(challenge.nonce);
    const valid = await pairing.verifyProof({
      kind: "proof",
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      signature: signed,
    });
    expect(valid).toBe(true);
  });

  it("refuses a wrong nonce", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const challenge = await pairing.issueChallenge();
    const signed = await pairing.signProof(challenge.nonce);
    const valid = await pairing.verifyProof({
      kind: "proof",
      keyId: challenge.keyId,
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      signature: signed,
    });
    expect(valid).toBe(false);
  });

  it("refuses a wrong key id", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const challenge = await pairing.issueChallenge();
    const signed = await pairing.signProof(challenge.nonce);
    const valid = await pairing.verifyProof({
      kind: "proof",
      keyId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
      nonce: challenge.nonce,
      signature: signed,
    });
    expect(valid).toBe(false);
  });

  it("refuses a tampered signature", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const challenge = await pairing.issueChallenge();
    const signed = await pairing.signProof(challenge.nonce);
    const tampered = signed.endsWith("A")
      ? signed.slice(0, -1) + "B"
      : signed.slice(0, -1) + "A";
    const valid = await pairing.verifyProof({
      kind: "proof",
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      signature: tampered,
    });
    expect(valid).toBe(false);
  });

  it("refuses a proof when the switch is off", async () => {
    const pairing = makePairing("edge");
    await expect(pairing.issueChallenge()).rejects.toBeInstanceOf(PairingSwitchedOffError);
  });

  it("refuses the same challenge twice (single-use nonce)", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const challenge = await pairing.issueChallenge();
    const signed = await pairing.signProof(challenge.nonce);
    const first = await pairing.verifyProof({
      kind: "proof",
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      signature: signed,
    });
    expect(first).toBe(true);
    expect(pairing.outstandingNonceCount()).toBe(0);
    const second = await pairing.verifyProof({
      kind: "proof",
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      signature: signed,
    });
    expect(second).toBe(false);
  });

  it("emits a different nonce per call", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const a = await pairing.issueChallenge();
    const b = await pairing.issueChallenge();
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe("BrowserBridgePairing — credential lifecycle", () => {
  it("mints a fresh, distinct credential on each enable", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const first = pairing.keyId;
    const firstSecret = await loadStoredSecret(pairing);
    await pairing.enable();
    const second = pairing.keyId;
    const secondSecret = await loadStoredSecret(pairing);
    expect(first).not.toBe(second);
    expect(Buffer.from(firstSecret!).toString("hex")).not.toBe(
      Buffer.from(secondSecret!).toString("hex"),
    );
  });

  it("rejects the OLD credential after re-enable, even when re-presented late", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const oldKeyId = pairing.keyId;
    const oldChallenge = await pairing.issueChallenge();
    const oldSigned = await pairing.signProof(oldChallenge.nonce);
    // Forget the nonce — we want the test to fail because the credential
    // was revoked, not because the nonce was spent.
    pairing.forgetChallenge(oldChallenge.nonce);
    await pairing.enable();
    // Now feed the OLD proof back.
    const valid = await pairing.verifyProof({
      kind: "proof",
      keyId: oldKeyId!,
      nonce: oldChallenge.nonce,
      signature: oldSigned,
    });
    expect(valid).toBe(false);
  });

  it("refuses ALL operations after disable", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    await pairing.disable();
    expect(pairing.enabled).toBe(false);
    await expect(pairing.issueChallenge()).rejects.toBeInstanceOf(PairingSwitchedOffError);
    expect(pairing.status().enabled).toBe(false);
  });

  it("drops the disabled secret from the underlying credential store", async () => {
    const store = createInMemorySecureCredentialStore();
    const pairing = new BrowserBridgePairing({
      surface: "edge",
      credentialStore: store,
      allowedExtensionIds: KNOWN_EXTENSION_IDS,
    });
    await pairing.enable();
    const enabledKeyId = pairing.keyId!;
    expect(await store.load(enabledKeyId)).toBeDefined();
    await pairing.disable();
    expect(await store.load(enabledKeyId)).toBeUndefined();
  });
});

describe("BrowserBridgePairing — surviving a restart", () => {
  it("keeps the credential the extension still holds when the host restarts", async () => {
    // One store, two host processes: the second is the first one restarted.
    const store = createInMemorySecureCredentialStore();
    const first = new BrowserBridgePairing({
      surface: "edge",
      credentialStore: store,
      allowedExtensionIds: KNOWN_EXTENSION_IDS,
    });
    await first.enable();
    const keyIdBefore = first.keyId!;

    // The host restarts. It must NOT mint a fresh credential: the extension
    // still holds the old one, and a fresh secret on this side would leave the
    // two unable to prove possession of the same thing.
    const restarted = new BrowserBridgePairing({
      surface: "edge",
      credentialStore: store,
      allowedExtensionIds: KNOWN_EXTENSION_IDS,
    });
    await restarted.restore();
    expect(restarted.keyId).toBe(keyIdBefore);

    // The extension's proof, made with the secret it kept, is accepted.
    const secret = await store.load(keyIdBefore);
    expect(secret).toBeDefined();
    const challenge = await restarted.issueChallenge();
    const proof = await signWebuiBrowserBridgeProof(
      secret!,
      challenge.nonce,
      challenge.keyId,
    );
    const valid = await restarted.verifyProof({
      kind: "proof",
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      signature: proof,
    });
    expect(valid).toBe(true);
  });

  it("mints a fresh credential when the surface was switched off in between", async () => {
    const store = createInMemorySecureCredentialStore();
    const first = new BrowserBridgePairing({
      surface: "edge",
      credentialStore: store,
      allowedExtensionIds: KNOWN_EXTENSION_IDS,
    });
    await first.enable();
    const keyIdBefore = first.keyId!;

    // The person switched the browser off, then the host restarted. The
    // credential was revoked, so there is nothing to restore and a fresh one
    // is minted.
    await first.disable();

    const restarted = new BrowserBridgePairing({
      surface: "edge",
      credentialStore: store,
      allowedExtensionIds: KNOWN_EXTENSION_IDS,
    });
    await restarted.restore();
    expect(restarted.keyId).toBeDefined();
    expect(restarted.keyId).not.toBe(keyIdBefore);
  });
});

describe("BrowserBridgePairing — browser isolation", () => {
  it("the two bridges never share a credential", async () => {
    const edge = makePairing("edge");
    const chrome = makePairing("chrome");
    await edge.enable();
    await chrome.enable();
    expect(edge.keyId).not.toBe(chrome.keyId);
    const edgeSecret = await loadStoredSecret(edge);
    const chromeSecret = await loadStoredSecret(chrome);
    expect(Buffer.from(edgeSecret!).toString("hex")).not.toBe(
      Buffer.from(chromeSecret!).toString("hex"),
    );
  });

  it("disabling one bridge does not disturb the other", async () => {
    const edge = makePairing("edge");
    const chrome = makePairing("chrome");
    await edge.enable();
    await chrome.enable();
    const chromeKeyBefore = chrome.keyId;
    await edge.disable();
    expect(edge.enabled).toBe(false);
    expect(chrome.enabled).toBe(true);
    expect(chrome.keyId).toBe(chromeKeyBefore);
  });
});

describe("BrowserBridgePairing — proof construction pinning", () => {
  it("uses the same construction as the shared contract module", async () => {
    // The pairing must not diverge from the contract's signer. A test
    // here pins both code paths to the same algorithm by computing the
    // signature with the shared signer and asserting the pairing accepts
    // it.
    const pairing = makePairing("edge");
    await pairing.enable();
    const challenge = await pairing.issueChallenge();
    // Reach into the in-memory store to fetch the secret and re-sign with
    // the shared module — this is what an extension would do.
    const secret = await loadStoredSecret(pairing);
    const signed = await signWebuiBrowserBridgeProof(secret!, challenge.nonce, challenge.keyId);
    const valid = await pairing.verifyProof({
      kind: "proof",
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      signature: signed,
    });
    expect(valid).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

async function loadStoredSecret(
  pairing: BrowserBridgePairing,
): Promise<Uint8Array | undefined> {
  const store = (pairing as unknown as {
    credentialStore: { load: (keyId: string) => Promise<Uint8Array | undefined> };
  }).credentialStore;
  if (!pairing.keyId) return undefined;
  return store.load(pairing.keyId);
}

// Keep an import that anchors tree-shaking in case a refactor drops `generateBridgeCredential`.
void generateBridgeCredential;
