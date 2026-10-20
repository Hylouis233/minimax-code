// The extension's copy of the WebUI browser-bridge wire protocol.
//
// It duplicates `packages/webui/src/shared/contracts/browser-bridge.ts` on
// purpose. An extension is loaded by the browser as plain ES modules with no
// node_modules and no bundler, so it cannot resolve a workspace package, and the
// ADR forbids importing WebUI implementation modules across the bridge boundary
// anyway. The duplication is kept safe by two things: the names here match the
// host's names one for one, so a diff of the two files is meaningful, and both
// sides are pinned to the same signature test vector — a change to the
// construction on either side breaks exactly one suite.

/** The dedicated path the bridge listens on. It is not the WebUI's own path. */
export const WEBUI_BROWSER_BRIDGE_PATH = "/browser-bridge";

/** The only signature scheme the bridge admits. */
export const WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM = "HMAC-SHA256" as const;

/** The external browsers this extension bridges. */
export type WebuiBrowserBridgeBrowser = "edge" | "chrome";

export interface WebuiBrowserBridgeChallenge {
  readonly kind: "challenge";
  /** A fresh, single-use nonce. */
  readonly nonce: string;
  readonly algorithm: typeof WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM;
  /** Which stored credential the host expects the answer to use. */
  readonly keyId: string;
}

export interface WebuiBrowserBridgeProof {
  readonly kind: "proof";
  readonly keyId: string;
  /** The nonce this proof answers, echoed so the host cannot mix two challenges. */
  readonly nonce: string;
  /** Base64 HMAC-SHA256 over the proof material. */
  readonly signature: string;
  /**
   * The algorithm the proof was made with, echoed from the challenge.
   *
   * The host verifies against exactly one algorithm, so an absent value is
   * readable as an older extension. Echoing it anyway keeps the two sides of
   * the wire saying the same thing.
   */
  readonly algorithm?: typeof WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM;
}

export interface WebuiBrowserBridgeTarget {
  readonly browserId: string;
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
  readonly generation: number;
}

export interface WebuiBrowserBridgeImageFrame {
  readonly browserId: string;
  readonly targetId: string;
  readonly generation: number;
  /** Base64 image bytes. */
  readonly data: string;
  readonly format: "png" | "jpeg";
  readonly sequence: number;
}

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

export type WebuiBrowserBridgeClientFrame =
  | {
      readonly kind: "hello";
      readonly browser: WebuiBrowserBridgeBrowser;
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

/**
 * The codes the extension itself can report.
 *
 * The full vocabulary belongs to the host contract; this is the subset that a
 * failure inside the extension can honestly claim, kept with the same strings so
 * the panel and the Agent's tools branch on them without the extension importing
 * the host module.
 */
export const WEBUI_BROWSER_BRIDGE_ERROR_CODES = [
  "browser_target_stale",
  "browser_target_unknown",
  "browser_command_invalid",
  "browser_provider_failed",
  "browser_provider_unavailable",
  "browser_operation_timeout",
  "browser_operation_cancelled",
  "browser_pairing_rejected",
] as const;

export type WebuiBrowserBridgeErrorCode = (typeof WEBUI_BROWSER_BRIDGE_ERROR_CODES)[number];

export interface WebuiBrowserBridgeError {
  readonly code: WebuiBrowserBridgeErrorCode;
  readonly message: string;
  /** Whether waiting for the same operation to become possible again could help. */
  readonly retryable: boolean;
}

export function webuiBrowserBridgeError(
  code: WebuiBrowserBridgeErrorCode,
  message: string,
  retryable: boolean,
): WebuiBrowserBridgeError {
  return { code, message, retryable };
}

/**
 * The bytes a proof is computed over.
 *
 * The key id is inside the signed material so a proof captured for one
 * credential cannot be presented against another.
 */
export function webuiBrowserBridgeProofMaterial(nonce: string, keyId: string): string {
  return `${nonce} ${keyId}`;
}

/**
 * Computes the proof for a challenge.
 *
 * Web Crypto rather than `node:crypto`, because this runs in a browser service
 * worker where `node:crypto` does not exist, and base64 is built from `btoa`
 * rather than `Buffer` for the same reason.
 */
export async function signWebuiBrowserBridgeProof(
  secret: Uint8Array,
  nonce: string,
  keyId: string,
): Promise<string> {
  // Copied into a fresh buffer first: `crypto.subtle` only accepts a buffer that
  // is known not to be shared, and a caller's `Uint8Array` may have come from a
  // storage decode with a wider backing store.
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(webuiBrowserBridgeProofMaterial(nonce, keyId)),
  );
  return encodeWebuiBrowserBridgeBase64(new Uint8Array(signature));
}

/**
 * Checks a proof against a stored secret.
 *
 * The host verifies every proof it admits; the extension keeps the same check so
 * its own round trip is verifiable in tests without a host process, and so a
 * wiring mistake on this side fails as a wrong proof rather than as a silent
 * connection. The comparison is length-then-byte-constant-time, which is as
 * strong as it gets over two base64 strings of public data.
 */
export async function verifyWebuiBrowserBridgeProof(
  secret: Uint8Array,
  proof: WebuiBrowserBridgeProof,
  expectedNonce: string,
  expectedKeyId: string,
): Promise<boolean> {
  if (proof.keyId !== expectedKeyId) return false;
  if (proof.nonce !== expectedNonce) return false;
  const expected = await signWebuiBrowserBridgeProof(secret, proof.nonce, proof.keyId);
  return constantTimeEqual(expected, proof.signature);
}

/** Base64 over bytes, without `Buffer`. */
export function encodeWebuiBrowserBridgeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Bytes from base64, without `Buffer`. */
export function decodeWebuiBrowserBridgeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/**
 * The loopback WebSocket URL for a configured host origin.
 *
 * Only loopback origins are accepted: the bridge is a local-only surface, and an
 * extension that can reach any origin could be pointed at a remote listener by
 * anything that can write its storage.
 */
export function webuiBrowserBridgeUrl(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:") {
    throw new Error(`browser bridge: unsupported origin protocol ${parsed.protocol}`);
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`browser bridge: origin host must be loopback, got ${parsed.hostname}`);
  }
  return `${parsed.origin}${WEBUI_BROWSER_BRIDGE_PATH}`;
}

export type WebuiBrowserBridgeFrameParse =
  | { readonly ok: true; readonly frame: WebuiBrowserBridgeHostFrame }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses one frame from the host.
 *
 * A frame that is not one this protocol declares is a protocol violation, not
 * something to ignore: the caller closes the socket with the returned reason
 * rather than carrying on against a stream it is no longer parsing correctly.
 */
export function parseWebuiBrowserBridgeHostFrame(raw: string): WebuiBrowserBridgeFrameParse {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "frame is not valid JSON" };
  }
  if (typeof value !== "object" || value === null) return { ok: false, reason: "frame is not an object" };
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case "challenge": {
      if (typeof candidate.nonce !== "string" || candidate.nonce.length === 0) {
        return { ok: false, reason: "challenge has no nonce" };
      }
      if (typeof candidate.keyId !== "string" || candidate.keyId.length === 0) {
        return { ok: false, reason: "challenge has no key id" };
      }
      if (candidate.algorithm !== WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM) {
        return { ok: false, reason: `challenge algorithm ${String(candidate.algorithm)} is not supported` };
      }
      return { ok: true, frame: candidate as unknown as WebuiBrowserBridgeHostFrame };
    }
    case "ready": {
      if (typeof candidate.sessionId !== "string") return { ok: false, reason: "ready has no session id" };
      return { ok: true, frame: candidate as unknown as WebuiBrowserBridgeHostFrame };
    }
    case "input": {
      if (typeof candidate.commandId !== "string") return { ok: false, reason: "input has no command id" };
      if (!isWebuiBrowserBridgeInputCommand(candidate.command)) {
        return { ok: false, reason: "input carries an invalid command" };
      }
      return { ok: true, frame: candidate as unknown as WebuiBrowserBridgeHostFrame };
    }
    case "ping": {
      if (typeof candidate.nonce !== "string") return { ok: false, reason: "ping has no nonce" };
      return { ok: true, frame: candidate as unknown as WebuiBrowserBridgeHostFrame };
    }
    case "closed": {
      if (typeof candidate.reason !== "string") return { ok: false, reason: "closed has no reason" };
      return { ok: true, frame: candidate as unknown as WebuiBrowserBridgeHostFrame };
    }
    default:
      return { ok: false, reason: `unknown frame kind ${String(candidate.kind)}` };
  }
}

/** Whether an input command has the shape the wire protocol declares. */
export function isWebuiBrowserBridgeInputCommand(value: unknown): value is WebuiBrowserBridgeInputCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  if (typeof command.targetId !== "string" || command.targetId.length === 0) return false;
  if (typeof command.generation !== "number") return false;
  switch (command.kind) {
    case "pointer":
      return (
        typeof command.x === "number" &&
        typeof command.y === "number" &&
        typeof command.button === "string" &&
        typeof command.clickCount === "number"
      );
    case "key":
      return typeof command.key === "string" && Array.isArray(command.modifiers);
    case "text":
      return typeof command.text === "string";
    default:
      return false;
  }
}