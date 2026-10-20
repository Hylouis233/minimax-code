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
//
// The last third of the file is the credential *transfer*: the host seals its
// own credential to the extension's per-connection public key, the extension
// opens it, and the credential it recovers answers a real challenge. Those
// tests deliberately do not share a secret between the two sides, because
// doing so is the defect the exchange exists to remove — a suite that fakes
// the shared secret proves nothing about two independently minted ones.

import { describe, expect, it } from "vitest";

import {
  BrowserBridgePairing,
  createInMemorySecureCredentialStore,
  exportWebuiBrowserBridgeEcdhPublicKey,
  generateBridgeCredential,
  generateWebuiBrowserBridgeEcdhKeyPair,
  openWebuiBrowserBridgePairingCredential,
  PairingSwitchedOffError,
  sealWebuiBrowserBridgePairingCredential,
  signWebuiBrowserBridgeProof,
  verifyWebuiBrowserBridgeProof,
  WEBUI_BROWSER_BRIDGE_PAIR_AES_IV_BYTES,
  WEBUI_BROWSER_BRIDGE_PAIR_HKDF_INFO,
  WEBUI_BROWSER_BRIDGE_PAIR_HKDF_SALT_BYTES,
  type WebuiBrowserBridgeEcdhPublicKey,
  type WebuiBrowserBridgePair,
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

/* ========================================================================== */
/* The credential transfer, host and extension both real                    */
/* ========================================================================== */

/** The extension's side of one connection: a fresh ephemeral key pair. */
async function extensionHandshake(): Promise<{
  readonly privateKey: CryptoKey;
  readonly publicKey: WebuiBrowserBridgeEcdhPublicKey;
}> {
  const { privateKey, publicKey } = await generateWebuiBrowserBridgeEcdhKeyPair();
  return { privateKey, publicKey: await exportWebuiBrowserBridgeEcdhPublicKey(publicKey) };
}

/**
 * Replays what the extension's service worker does when a `pair` frame lands:
 * open it and take the credential it recovers. No store is involved — what is
 * under test is the bytes that cross, not how Chrome persists them.
 */
async function extensionAppliesPair(
  frame: WebuiBrowserBridgePair,
  ownPrivateKey: CryptoKey,
): Promise<{ readonly keyId: string; readonly secret: Uint8Array }> {
  const secret = await openWebuiBrowserBridgePairingCredential(frame, ownPrivateKey);
  return { keyId: frame.keyId, secret };
}

/** Turn a sealed result into the wire frame the session would send. */
function toPairFrame(
  sealed: { keyId: string; publicKey: WebuiBrowserBridgeEcdhPublicKey; salt: string; payload: string },
): WebuiBrowserBridgePair {
  return {
    kind: "pair",
    keyId: sealed.keyId,
    publicKey: sealed.publicKey,
    salt: sealed.salt,
    payload: sealed.payload,
  };
}

describe("the pairing exchange — host and extension both real", () => {
  it("delivers a credential the recovered secret can answer a challenge with", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();

    // The extension opens a connection and offers its per-connection key.
    const extension = await extensionHandshake();

    // The host seals its own credential to that key.
    const sealed = await pairing.sealCredentialForExtension(extension.publicKey);
    expect(sealed.kind).toBe("sealed");
    if (sealed.kind !== "sealed") throw new Error("unreachable");

    // The extension opens the frame and keeps what it recovered.
    const credential = await extensionAppliesPair(toPairFrame(sealed), extension.privateKey);

    // The host issues a challenge naming the same key id.
    const challenge = await pairing.issueChallenge();
    expect(challenge.keyId).toBe(credential.keyId);

    // The extension signs with what it recovered...
    const proof = await signWebuiBrowserBridgeProof(
      credential.secret,
      challenge.nonce,
      credential.keyId,
    );

    // ...and the host accepts it against its own stored secret. Nothing between
    // the two sides is shared except the wire.
    expect(
      await pairing.verifyProof({
        kind: "proof",
        keyId: credential.keyId,
        nonce: challenge.nonce,
        signature: proof,
      }),
    ).toBe(true);
  });

  it("delivers the credential again on a second connection, replacing the stored one", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();

    // Connection one: credential A.
    const first = await extensionHandshake();
    const firstSealed = await pairing.sealCredentialForExtension(first.publicKey);
    if (firstSealed.kind !== "sealed") throw new Error("unreachable");
    const firstStored = await extensionAppliesPair(toPairFrame(firstSealed), first.privateKey);

    // The person turns the switch off and on again: the credential is revoked
    // and a fresh one minted. The extension cannot reach it on its own.
    await pairing.enable();
    expect(pairing.keyId).not.toBe(firstSealed.keyId);

    // Connection two: the host sends the new credential unasked.
    const second = await extensionHandshake();
    const secondSealed = await pairing.sealCredentialForExtension(second.publicKey);
    if (secondSealed.kind !== "sealed") throw new Error("unreachable");
    const secondStored = await extensionAppliesPair(toPairFrame(secondSealed), second.privateKey);

    // Replaced, not merged.
    expect(secondStored.keyId).not.toBe(firstStored.keyId);
    expect(hexOf(secondStored.secret)).not.toBe(hexOf(firstStored.secret));

    // And the new credential answers.
    const challenge = await pairing.issueChallenge();
    expect(
      await pairing.verifyProof({
        kind: "proof",
        keyId: secondStored.keyId,
        nonce: challenge.nonce,
        signature: await signWebuiBrowserBridgeProof(
          secondStored.secret,
          challenge.nonce,
          secondStored.keyId,
        ),
      }),
    ).toBe(true);
  });

  it("sends no credential at all when the surface's switch is off", async () => {
    const pairing = makePairing("edge");
    // Never enabled: there is nothing to seal.
    const extension = await extensionHandshake();

    expect(await pairing.sealCredentialForExtension(extension.publicKey)).toEqual({ kind: "off" });
    expect(pairing.enabled).toBe(false);
    // And nothing for a proof to be checked against either.
    await expect(pairing.issueChallenge()).rejects.toBeInstanceOf(PairingSwitchedOffError);
  });

  it("sends no credential once the switch has been turned back off", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const extension = await extensionHandshake();
    expect((await pairing.sealCredentialForExtension(extension.publicKey)).kind).toBe("sealed");

    await pairing.disable();

    expect(await pairing.sealCredentialForExtension(extension.publicKey)).toEqual({ kind: "off" });
  });

  it("keeps the two surfaces' transfers independent", async () => {
    const edge = makePairing("edge");
    const chrome = makePairing("chrome");
    await edge.enable();
    await chrome.enable();
    const extension = await extensionHandshake();

    const edgeSealed = await edge.sealCredentialForExtension(extension.publicKey);
    const chromeSealed = await chrome.sealCredentialForExtension(extension.publicKey);
    if (edgeSealed.kind !== "sealed" || chromeSealed.kind !== "sealed") throw new Error("unreachable");

    const edgeCredential = await extensionAppliesPair(toPairFrame(edgeSealed), extension.privateKey);
    const chromeCredential = await extensionAppliesPair(
      toPairFrame(chromeSealed),
      extension.privateKey,
    );

    // A credential from one surface does not answer the other's challenge.
    expect(edgeCredential.keyId).not.toBe(chromeCredential.keyId);
    const challenge = await edge.issueChallenge();
    expect(
      await edge.verifyProof({
        kind: "proof",
        keyId: chromeCredential.keyId,
        nonce: challenge.nonce,
        signature: await signWebuiBrowserBridgeProof(
          chromeCredential.secret,
          challenge.nonce,
          chromeCredential.keyId,
        ),
      }),
    ).toBe(false);
  });

  it("cannot be opened by a key that is not the one offered in hello", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const mine = await extensionHandshake();
    const sealed = await pairing.sealCredentialForExtension(mine.publicKey);
    if (sealed.kind !== "sealed") throw new Error("unreachable");

    const someoneElse = await extensionHandshake();

    await expect(
      extensionAppliesPair(toPairFrame(sealed), someoneElse.privateKey),
    ).rejects.toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* What actually crosses the wire                                             */
/* -------------------------------------------------------------------------- */

describe("the pairing exchange — the secret never crosses in the clear", () => {
  it("carries no secret in any encoding and declares no secret field", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const extension = await extensionHandshake();
    const sealed = await pairing.sealCredentialForExtension(extension.publicKey);
    if (sealed.kind !== "sealed") throw new Error("unreachable");
    const hostSecret = (await loadStoredSecret(pairing))!;

    const serialised = JSON.stringify(toPairFrame(sealed));

    // Neither the base64, the base64url nor the hex of the secret appears
    // anywhere in the frame — and there is no field that carries it either.
    expect(serialised).not.toContain(Buffer.from(hostSecret).toString("base64"));
    expect(serialised).not.toContain(hexOf(hostSecret));
    expect(serialised).not.toContain(Buffer.from(hostSecret).toString("base64url"));
    expect(serialised).not.toContain("secret");
    // The key id IS in the clear, which is correct: it is not secret, and the
    // challenge names it.
    expect(Object.keys(JSON.parse(serialised) as Record<string, unknown>).sort()).toEqual([
      "keyId",
      "kind",
      "payload",
      "publicKey",
      "salt",
    ]);
  });

  it("uses a fresh salt and IV on every seal", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const extension = await extensionHandshake();

    const first = await pairing.sealCredentialForExtension(extension.publicKey);
    const second = await pairing.sealCredentialForExtension(extension.publicKey);
    if (first.kind !== "sealed" || second.kind !== "sealed") throw new Error("unreachable");

    expect(first.salt).not.toBe(second.salt);
    // The IV is the head of the payload, so the first base64 quantum differs
    // even though both payloads start with the same IV length.
    expect(first.payload.slice(0, 24)).not.toBe(second.payload.slice(0, 24));
  });

  it("fails to open a tampered payload rather than returning half a credential", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const extension = await extensionHandshake();
    const sealed = await pairing.sealCredentialForExtension(extension.publicKey);
    if (sealed.kind !== "sealed") throw new Error("unreachable");

    const payload = Buffer.from(sealed.payload, "base64");
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0x01;

    await expect(
      extensionAppliesPair({ ...toPairFrame(sealed), payload: payload.toString("base64") }, extension.privateKey),
    ).rejects.toBeDefined();
  });

  it("fails to open when the salt is not the one the host generated", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const extension = await extensionHandshake();
    const sealed = await pairing.sealCredentialForExtension(extension.publicKey);
    if (sealed.kind !== "sealed") throw new Error("unreachable");

    await expect(
      extensionAppliesPair(
        {
          ...toPairFrame(sealed),
          salt: Buffer.alloc(WEBUI_BROWSER_BRIDGE_PAIR_HKDF_SALT_BYTES, 7).toString("base64"),
        },
        extension.privateKey,
      ),
    ).rejects.toBeDefined();
  });

  it("fails to open a payload too short to be an AES-GCM frame", async () => {
    const pairing = makePairing("edge");
    await pairing.enable();
    const extension = await extensionHandshake();
    const sealed = await pairing.sealCredentialForExtension(extension.publicKey);
    if (sealed.kind !== "sealed") throw new Error("unreachable");

    await expect(
      extensionAppliesPair(
        { ...toPairFrame(sealed), payload: Buffer.alloc(8).toString("base64") },
        extension.privateKey,
      ),
    ).rejects.toThrow(/too short/);
  });
});

/* -------------------------------------------------------------------------- */
/* The cross-implementation vector                                            */
/* -------------------------------------------------------------------------- */

describe("the pairing exchange — the cross-implementation vector", () => {
  /**
   * The same numbers `packages/browser-extension/test/protocol.test.ts` asserts.
   * Two hand-written copies of this cipher — one on Node, one in a browser
   * service worker — agree only because this string is the tie-breaker between
   * them. A change to the curve, the `info`, the salt length or the plaintext
   * encoding on either side breaks exactly one suite.
   */
  const HOST_PRIVATE_JWK = {
    kty: "EC",
    crv: "P-256",
    x: "XKwRVe-iSDOdOSBcT7wi5-6UDoXhSi_sJIva2FRwf-A",
    y: "JOmNw0lXPLULOJ02rq1ElmxknaPEkcoSGN7aHuVzYZk",
    d: "JGSt5D3d1wIlUCrVHgcNvnsFK8uMWG_YUCcHFsySgd0",
  } as const;
  const EXTENSION_PUBLIC: WebuiBrowserBridgeEcdhPublicKey = {
    kty: "EC",
    crv: "P-256",
    x: "E97C62Slhb6xSK8jBY_vKNp_bXdZdUyq2z16I_ozyCA",
    y: "-h7QnrdbdOmS5Wgxe8VSGJWBLpsptMBSCKmLKYcockY",
  };
  const SALT = "AAECAwQFBgcICQoLDA0ODw==";
  const PLAINTEXT = "ABEiM0RVZneImaq7zN3u/w==";
  const PAYLOAD = "EBESExQVFhcYGRobrpzg8LW2dZC7oVrnYW8vU8zfjg8p/FNAc/YdMgkvUx7+O5ceWIULAw==";
  const SECRET_HEX = "00112233445566778899aabbccddeeff";

  /**
   * One continuous 0x00, 0x01, 0x02, … stream, so the first 16 bytes are the
   * salt and the next 12 are the IV — which is what the vector was built from.
   */
  function countingRandom(): (length: number) => Uint8Array {
    let next = 0;
    return (length: number) => {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = next++ & 0xff;
      return bytes;
    };
  }

  it("pins the agreed HKDF info and the salt and IV widths", () => {
    expect(WEBUI_BROWSER_BRIDGE_PAIR_HKDF_INFO).toBe("webui-browser-bridge-pair-v1");
    expect(WEBUI_BROWSER_BRIDGE_PAIR_HKDF_SALT_BYTES).toBe(16);
    expect(WEBUI_BROWSER_BRIDGE_PAIR_AES_IV_BYTES).toBe(12);
  });

  it("produces the exact payload the extension's suite opens", async () => {
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      { ...HOST_PRIVATE_JWK, key_ops: ["deriveBits"] },
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: HOST_PRIVATE_JWK.kty,
        crv: HOST_PRIVATE_JWK.crv,
        x: HOST_PRIVATE_JWK.x,
        y: HOST_PRIVATE_JWK.y,
        ext: true,
        key_ops: [],
      },
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );

    const cipher = await sealWebuiBrowserBridgePairingCredential(
      Buffer.from(SECRET_HEX, "hex"),
      EXTENSION_PUBLIC,
      { randomBytes: countingRandom(), hostKeyPair: { privateKey, publicKey } },
    );

    expect(cipher.salt).toBe(SALT);
    expect(cipher.payload).toBe(PAYLOAD);
    expect(cipher.publicKey).toEqual({
      kty: "EC",
      crv: "P-256",
      x: HOST_PRIVATE_JWK.x,
      y: HOST_PRIVATE_JWK.y,
    });
    // The plaintext the two suites agree on is `base64(secret)`.
    expect(Buffer.from(SECRET_HEX, "hex").toString("base64")).toBe(PLAINTEXT);
  });

  it("opens the same vector from the extension's fixed private key", async () => {
    const extensionPrivate = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: "E97C62Slhb6xSK8jBY_vKNp_bXdZdUyq2z16I_ozyCA",
        y: "-h7QnrdbdOmS5Wgxe8VSGJWBLpsptMBSCKmLKYcockY",
        d: "1xQC1vkpguxZrUo9vhBkgX76gSaP3yiIv7YjgJUa4CA",
        key_ops: ["deriveBits"],
      },
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );

    const secret = await openWebuiBrowserBridgePairingCredential(
      {
        publicKey: {
          kty: "EC",
          crv: "P-256",
          x: HOST_PRIVATE_JWK.x,
          y: HOST_PRIVATE_JWK.y,
        },
        salt: SALT,
        payload: PAYLOAD,
      },
      extensionPrivate,
    );

    expect(hexOf(secret)).toBe(SECRET_HEX);
    expect(Buffer.from(secret).toString("base64")).toBe(PLAINTEXT);
  });

  it("refuses a vector payload one bit from the agreed value", async () => {
    const extensionPrivate = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: "E97C62Slhb6xSK8jBY_vKNp_bXdZdUyq2z16I_ozyCA",
        y: "-h7QnrdbdOmS5Wgxe8VSGJWBLpsptMBSCKmLKYcockY",
        d: "1xQC1vkpguxZrUo9vhBkgX76gSaP3yiIv7YjgJUa4CA",
        key_ops: ["deriveBits"],
      },
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const payload = Buffer.from(PAYLOAD, "base64");
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0x01;

    await expect(
      openWebuiBrowserBridgePairingCredential(
        {
          publicKey: {
            kty: "EC",
            crv: "P-256",
            x: HOST_PRIVATE_JWK.x,
            y: HOST_PRIVATE_JWK.y,
          },
          salt: SALT,
          payload: payload.toString("base64"),
        },
        extensionPrivate,
      ),
    ).rejects.toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */

function hexOf(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
