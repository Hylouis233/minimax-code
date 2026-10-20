// The extension bridge protocol.
//
// The bridge is the only way this process reaches the person's own browser.
// It is a WebSocket on loopback, but it is **not** the WebUI's own WebSocket:
// it has its own path, its own admission and its own credential, because the
// thing that connects to it is a browser extension, not the WebUI page.
//
// | Declaration | Wire purpose | Producer | Consumers |
// | --- | --- | --- | --- |
// | `WEBUI_BROWSER_BRIDGE_PATH` | The dedicated path the bridge listens on. | Host. | Extension. |
// | `WebuiBrowserBridgeClientFrame` | A frame the extension sends to the host. | Extension. | Bridge session. |
// | `WebuiBrowserBridgeHostFrame` | A frame the host sends to the extension. | Host. | Extension. |
// | `WebuiBrowserBridgeChallenge` | The nonce the host issues to prove possession. | Host. | Extension. |
// | `WebuiBrowserBridgeProof` | The extension's answer to a challenge. | Extension. | Bridge session. |
// | `signWebuiBrowserBridgeProof` | Computes the proof over a challenge and a secret. | Both sides. | Bridge session; extension. |
// | `verifyWebuiBrowserBridgeProof` | Checks a proof, in constant time. | Host. | Bridge session. |
//
// Pairing is challenge-response rather than a shared bearer token: the secret
// never crosses the wire in a form that could be replayed from a packet
// capture, and a captured proof is useless because it is bound to a fresh
// nonce. The one thing the secret does cross the wire in is the *initial*
// pairing, and only once, over the loopback interface, to establish a
// credential that then lives in the OS secure store.

/** The dedicated path the bridge listens on. It is not the WebUI's own path. */
export const WEBUI_BROWSER_BRIDGE_PATH = "/browser-bridge";

/**
 * The signature scheme.
 *
 * HMAC-SHA256 over `nonce || separator || keyId`, so a proof cannot be replayed
 * against a different challenge or a different key.
 */
export const WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM = "HMAC-SHA256" as const;

/**
 * The separator between the nonce and the key id in the signed material.
 *
 * Written as an explicit escape rather than as a literal space: the separator
 * is part of what is signed, so the two implementations must agree on the
 * exact byte, and a literal whitespace character is exactly the kind of thing
 * an editor or a diff can change without anybody noticing. The two
 * implementations are pinned to the same test vector, which is what catches
 * this.
 */
const WEBUI_BROWSER_BRIDGE_PROOF_SEPARATOR = "\u0020";

/** The challenge the host issues when a client first connects. */
export interface WebuiBrowserBridgeChallenge {
  readonly kind: "challenge";
  /** A fresh, single-use nonce. */
  readonly nonce: string;
  readonly algorithm: typeof WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM;
  /** Which stored credential the host expects the answer to use. */
  readonly keyId: string;
}

/** The client's answer to a challenge. */
export interface WebuiBrowserBridgeProof {
  readonly kind: "proof";
  readonly keyId: string;
  /** The nonce this proof answers, echoed so the host cannot mix two challenges. */
  readonly nonce: string;
  /** Base64 HMAC-SHA256 over the signed material. */
  readonly signature: string;
  /**
   * The algorithm the proof was made with, echoed from the challenge.
   *
   * Optional because an older extension does not send it, and absent is
   * readable: the host issued exactly one algorithm and verifies against that
   * one. A *different* algorithm is not read as absent — it is refused.
   */
  readonly algorithm?: typeof WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM;
}

/** The client frames: what the extension says to the host. */
export type WebuiBrowserBridgeClientFrame =
  | {
      readonly kind: "hello";
      readonly browser: "edge" | "chrome";
      readonly browserId: string;
      readonly extensionVersion: string;
    }
  | WebuiBrowserBridgeProof
  | { readonly kind: "targets"; readonly targets: readonly WebuiBrowserBridgeTarget[] }
  | { readonly kind: "frame"; readonly frame: WebuiBrowserBridgeImageFrame }
  | {
      readonly kind: "input-result";
      readonly commandId: string;
      readonly accepted: boolean;
      readonly error?: string;
    }
  | { readonly kind: "pong"; readonly nonce: string };

/** The host frames: what the host says to the extension. */
export type WebuiBrowserBridgeHostFrame =
  | WebuiBrowserBridgeChallenge
  | { readonly kind: "ready"; readonly sessionId: string }
  | {
      readonly kind: "input";
      readonly commandId: string;
      readonly command: WebuiBrowserBridgeInputCommand;
    }
  | { readonly kind: "ping"; readonly nonce: string }
  | { readonly kind: "closed"; readonly reason: string };

/** One target the extension reports. */
export interface WebuiBrowserBridgeTarget {
  readonly browserId: string;
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
  readonly generation: number;
}

/** One frame the extension delivers. */
export interface WebuiBrowserBridgeImageFrame {
  readonly browserId: string;
  readonly targetId: string;
  readonly generation: number;
  /** Base64 image bytes. */
  readonly data: string;
  readonly format: "png" | "jpeg";
  readonly sequence: number;
}

/** An input command the host asks the extension to deliver. */
export type WebuiBrowserBridgeInputCommand =
  | {
      readonly kind: "pointer";
      readonly targetId: string;
      readonly generation: number;
      readonly x: number;
      readonly y: number;
      readonly button: "left" | "middle" | "right";
      readonly clickCount: number;
    }
  | {
      readonly kind: "key";
      readonly targetId: string;
      readonly generation: number;
      readonly key: string;
      readonly code?: string;
      readonly text?: string;
      readonly modifiers: readonly ("alt" | "ctrl" | "meta" | "shift")[];
    }
  | {
      readonly kind: "text";
      readonly targetId: string;
      readonly generation: number;
      readonly text: string;
    };

/**
 * The bytes a proof is computed over.
 *
 * The key id is inside the signed material so a proof captured for one
 * credential cannot be presented against another.
 */
export function webuiBrowserBridgeProofMaterial(nonce: string, keyId: string): string {
  return `${nonce}${WEBUI_BROWSER_BRIDGE_PROOF_SEPARATOR}${keyId}`;
}

/**
 * Computes the proof for a challenge.
 *
 * The same function runs on both sides: the extension signs with the secret it
 * holds, the host verifies with the secret it stored. Keeping one function
 * removes the possibility of the two sides disagreeing about the construction.
 *
 * Web Crypto is used rather than `node:crypto` so the extension — which runs
 * in a browser, not in Node — computes byte-for-byte the same signature. The
 * base64 encoding is likewise done without `Buffer`, which is a Node global and
 * is absent in an MV3 service worker. The two implementations are pinned to the
 * same test vector.
 */
export async function signWebuiBrowserBridgeProof(
  secret: Uint8Array,
  nonce: string,
  keyId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(new TextEncoder().encode(webuiBrowserBridgeProofMaterial(nonce, keyId))),
  );
  return encodeBase64(new Uint8Array(signature));
}

/**
 * Copies bytes into a plain `ArrayBuffer`.
 *
 * Web Crypto's `BufferSource` is declared over `ArrayBuffer`, but a
 * `Uint8Array` is generic over its buffer, and the compiler will not accept a
 * view whose buffer might be a `SharedArrayBuffer`. Copying into a buffer this
 * function owns removes the question instead of casting it away.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * Verifies a proof against a stored secret.
 *
 * The comparison is constant-time, and a wrong length is a failure rather than
 * an exception: a proof that does not even have the right shape is still just
 * a wrong proof.
 */
export async function verifyWebuiBrowserBridgeProof(
  secret: Uint8Array,
  proof: WebuiBrowserBridgeProof,
  expectedNonce: string,
  expectedKeyId: string,
): Promise<boolean> {
  if (proof.keyId !== expectedKeyId) return false;
  if (proof.nonce !== expectedNonce) return false;
  // An absent algorithm is the older extension, which the host issued exactly
  // one algorithm to. A *different* algorithm is not "older": it is a proof
  // made by something else, and it is refused.
  if (
    proof.algorithm !== undefined &&
    proof.algorithm !== WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM
  ) {
    return false;
  }
  const expected = await signWebuiBrowserBridgeProof(secret, proof.nonce, proof.keyId);
  return constantTimeEqual(expected, proof.signature);
}

/**
 * Base64 without `Buffer`.
 *
 * `Buffer` is a Node global; an MV3 service worker does not have it. `btoa`
 * does exist in both, so the bytes are turned into a binary string and handed
 * to it. The chunked loop keeps the argument below the argument limit of
 * `String.fromCharCode` for long inputs.
 */
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/**
 * Compares two strings without leaking where they differ.
 *
 * The length difference is not hidden — it is observable in the length itself —
 * but the *position* of the first differing character is not, which is what a
 * timing attack on a signature needs.
 */
function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}
