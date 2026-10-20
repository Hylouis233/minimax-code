// Challenge-response pairing against the WebUI bridge.
//
// Pairing is not a bearer token. The host issues a fresh nonce and expects an
// HMAC over that nonce, so a proof lifted off the loopback socket is useless
// against the next connection, and the secret itself never travels at all.
//
// The credential is **host-authored**. The browser-extension does not mint
// one of its own, because two independently minted credentials never match:
// the host would never accept a proof against the wrong secret. Instead, the
// host delivers its credential, encrypted under an ECDH key the extension
// mints per connection, in a `pair` frame — and **that** is the credential
// the extension stores in `chrome.storage.local`. A re-enable on the host
// side means a fresh credential that arrives on the next connect and
// replaces the stored one.
//
// The secret lives in `chrome.storage.local` — not `storage.sync`, which would
// replicate it to a signed-in Google account outside this browser. It is read
// from storage on every connection rather than cached in a module variable,
// because an MV3 service worker is terminated at will and must still be able
// to answer a challenge after it restarts.
//
// The WebUI per-start connection token is never read here. That credential is
// the WebUI's own, and borrowing it would make the bridge's admission
// indistinguishable from the WebUI's.

import {
  decodeWebuiBrowserBridgeBase64,
  encodeWebuiBrowserBridgeBase64,
  openWebuiBrowserBridgePairingCredential,
  signWebuiBrowserBridgeProof,
  WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM,
  type WebuiBrowserBridgeChallenge,
  type WebuiBrowserBridgePair,
  type WebuiBrowserBridgeProof,
} from "./protocol.js";

/** The `chrome.storage.local` key the credential is stored under. */
export const WEBUI_BROWSER_BRIDGE_PAIRING_STORAGE_KEY = "webui.browserBridge.pairing.v1";

/**
 * 32 bytes of entropy for the HMAC key.
 *
 * 256 bits is the hash width, so the key is not the weak link; below that it
 * would be.
 */
export const WEBUI_BROWSER_BRIDGE_SECRET_BYTES = 32;

export interface WebuiBrowserBridgePairingCredential {
  readonly keyId: string;
  readonly secret: Uint8Array;
}

/** The storage surface pairing needs. Narrow on purpose so tests can fake it. */
export interface WebuiBrowserBridgePairingStore {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
  clear(): Promise<void>;
}

export interface WebuiBrowserBridgeStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/**
 * Adapts a `chrome.storage` area to the pairing store.
 *
 * The area is passed in rather than reached for globally so that the choice
 * between `local` and `sync` is made by the caller, in one place, where it can
 * be reviewed.
 */
export function webuiBrowserBridgePairingStore(
  area: WebuiBrowserBridgeStorageArea,
  key: string = WEBUI_BROWSER_BRIDGE_PAIRING_STORAGE_KEY,
): WebuiBrowserBridgePairingStore {
  return {
    async read() {
      return (await area.get(key))[key];
    },
    async write(value) {
      await area.set({ [key]: value });
    },
    async clear() {
      await area.remove(key);
    },
  };
}

/** Fills a buffer with `crypto.getRandomValues`. */
export function webuiBrowserBridgeRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * The credential for this browser, **as stored**.
 *
 * Returns `undefined` when storage has no credential or holds one whose
 * bytes are missing or too short. The credential is host-authored: this
 * function never mints one, because two independently-minted credentials
 * never match and the host would never accept a proof against the wrong
 * secret. The `pair` frame is the only path that puts credentials here.
 *
 * A stored credential whose bytes are missing or too short returns
 * `undefined` rather than being repaired: half a credential is not a
 * credential, and the host would reject it with a pairing error the person
 * cannot act on.
 */
export async function loadWebuiBrowserBridgePairingCredential(
  store: WebuiBrowserBridgePairingStore,
): Promise<WebuiBrowserBridgePairingCredential | undefined> {
  const stored = await store.read();
  return readStoredCredential(stored);
}

/**
 * Decrypts and stores a host-authored credential.
 *
 * Called by the client when a `pair` frame arrives. The host's credential
 * is authoritative: any prior stored value is replaced. The decryption is
 * the symmetric counterpart of the host's seal, with the same `info`,
 * salt, and AES-GCM IV handling; any tamper fails the AES-GCM auth and
 * rejects the frame, so a captured or rogue `pair` cannot read as a valid
 * credential.
 */
export async function applyWebuiBrowserBridgePairingCredential(
  store: WebuiBrowserBridgePairingStore,
  cipher: WebuiBrowserBridgePair,
  ownPrivateKey: CryptoKey,
): Promise<WebuiBrowserBridgePairingCredential> {
  const secret = await openWebuiBrowserBridgePairingCredential(cipher, ownPrivateKey);
  const credential: WebuiBrowserBridgePairingCredential = {
    keyId: cipher.keyId,
    secret,
  };
  await store.write({
    keyId: credential.keyId,
    secret: encodeWebuiBrowserBridgeBase64(credential.secret),
  });
  return credential;
}

/**
 * Answers a challenge with this browser's credential.
 *
 * The key id is echoed rather than chosen: answering a challenge for a different
 * credential would produce a proof the host cannot attribute, and answering one
 * that asks for an unknown algorithm would be a downgrade.
 */
export async function answerWebuiBrowserBridgeChallenge(
  challenge: WebuiBrowserBridgeChallenge,
  credential: WebuiBrowserBridgePairingCredential,
): Promise<WebuiBrowserBridgeProof> {
  if (challenge.algorithm !== WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM) {
    throw new Error(`browser bridge: unsupported challenge algorithm ${challenge.algorithm}`);
  }
  if (challenge.keyId !== credential.keyId) {
    throw new Error("browser bridge: challenge names a credential this browser does not hold");
  }
  return {
    kind: "proof",
    keyId: credential.keyId,
    nonce: challenge.nonce,
    algorithm: challenge.algorithm,
    signature: await signWebuiBrowserBridgeProof(credential.secret, challenge.nonce, credential.keyId),
  };
}

/**
 * Forgets the credential.
 *
 * Revocation is the host's decision — it tells the extension to drop the pairing
 * — so this is only ever called on that instruction, never on a failed
 * verification, which is what keeps a replayed proof from destroying a pairing
 * the person did not ask to give up.
 */
export async function clearWebuiBrowserBridgePairingCredential(
  store: WebuiBrowserBridgePairingStore,
): Promise<void> {
  await store.clear();
}

/** The browser names the key id is prefixed with. */
export type WebuiBrowserBridgeBrowserName = "edge" | "chrome";

function readStoredCredential(
  stored: unknown,
): WebuiBrowserBridgePairingCredential | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const record = stored as Record<string, unknown>;
  if (typeof record.keyId !== "string" || record.keyId.length === 0) return undefined;
  if (typeof record.secret !== "string" || record.secret.length === 0) return undefined;
  let secret: Uint8Array;
  try {
    secret = decodeWebuiBrowserBridgeBase64(record.secret);
  } catch {
    return undefined;
  }
  if (secret.length < WEBUI_BROWSER_BRIDGE_SECRET_BYTES) return undefined;
  return { keyId: record.keyId, secret };
}