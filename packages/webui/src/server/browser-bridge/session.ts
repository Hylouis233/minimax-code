// One bridge session = one connected extension on the `/browser-bridge`
// WebSocket.
//
// A session owns the lifecycle that the admission path deliberately does
// NOT handle:
//
//   1. The host sends a fresh challenge immediately after the upgrade
//      accepts.
//   2. The extension answers with a proof; the session verifies it.
//   3. On success the host emits `ready` and the session is open.
//   4. The host sends `input` commands and awaits `input-result` from the
//      extension for each one. The deadline distinguishes "the bridge is
//      unreachable" (timeout) from "the extension refused this command"
//      (an explicit `accepted: false` result).
//   5. The session closes when the socket closes or a fatal condition
//      happens (revocation, repeated bad proof, store unavailable).
//
// The session is deliberately unaware of the registry: it does not know
// which browser it serves, only which pairing. That decoupling lets the
// registry rotate pairings without managing the wire state itself.

import { EventEmitter } from "node:events";
import type { WebSocket, RawData } from "ws";

import {
  type WebuiBrowserBridgeChallenge,
  type WebuiBrowserBridgeClientFrame,
  type WebuiBrowserBridgeEcdhPublicKey,
  type WebuiBrowserBridgeHostFrame,
  type WebuiBrowserBridgeImageFrame,
  type WebuiBrowserBridgeInputCommand,
  type WebuiBrowserBridgeProof,
  type WebuiBrowserBridgeTarget,
} from "../../shared/contracts/browser-bridge.js";

import { PairingSwitchedOffError, BrowserBridgePairing } from "./pairing.js";
import {
  bridgeOperationReconnectDelayMs,
  withBridgeOperationRetry,
  BridgeOperationError,
} from "./reconnect.js";

const DEFAULT_OPERATION_DEADLINE_MS = 15_000;
const DEFAULT_PING_INTERVAL_MS = 10_000;
const MAX_INFLIGHT_COMMANDS = 32;

/** The shape of a single command's outcome. */
export type BrowserBridgeCommandOutcome =
  | { readonly kind: "accepted"; readonly commandId: string }
  | { readonly kind: "rejected"; readonly commandId: string; readonly reason: string }
  | { readonly kind: "timeout"; readonly commandId: string; readonly reason: string };

/** Frames the host receives from the extension, exposed via the session. */
export interface BrowserBridgeSessionEvents {
  /** A `targets` frame arrived. The current target list replaces the prior. */
  targets: (browserId: string, targets: readonly BrowserBridgeBridgeTargetExport[]) => void;
  /** A `frame` arrived carrying an image. */
  frame: (image: BrowserBridgeBridgeImageFrameExport) => void;
  /** The session was closed. */
  closed: (reason: BrowserBridgeSessionCloseReason) => void;
  /** The session is fully open and the host can send commands. */
  ready: () => void;
}

/** The minimum `WebuiBrowserBridgeTarget` shape other modules consume. */
export interface BrowserBridgeBridgeTargetExport {
  readonly browserId: string;
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
  readonly generation: number;
}

/** The minimum `WebuiBrowserBridgeImageFrame` shape other modules consume. */
export interface BrowserBridgeBridgeImageFrameExport {
  readonly browserId: string;
  readonly targetId: string;
  readonly generation: number;
  readonly data: string;
  readonly format: "png" | "jpeg";
  readonly sequence: number;
}

/** Why a session closed. */
export type BrowserBridgeSessionCloseReason =
  | { readonly kind: "remote" }
  | { readonly kind: "proof_failed" }
  | { readonly kind: "switched_off" }
  | { readonly kind: "store_unavailable" }
  | { readonly kind: "host_revoked" }
  | { readonly kind: "host_error"; readonly error: string };

/** The session's dependencies. */
export interface BrowserBridgeSessionOptions {
  /** The pairing this session authenticates against. */
  readonly pairing: BrowserBridgePairing;
  /** The underlying WebSocket the admission path handed us. */
  readonly socket: WebSocket;
  /**
   * Operation deadline in milliseconds — the bridge's "we still think it
   * might come back" window per the ADR. Defaults to 15 seconds.
   */
  readonly operationDeadlineMs?: number;
  /**
   * Liveness ping cadence. The session emits `ping` and awaits `pong`
   * within one interval; a missed pong is a transient retry rather than a
   * fatal close.
   */
  readonly pingIntervalMs?: number;
  /**
   * Wall-clock source; tests inject a deterministic clock.
   */
  readonly now?: () => number;
  /**
   * Sleep function; tests inject a deterministic sleeper.
   */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * The id the host assigns to the session. Surfaced in the `ready` frame
   * so the client can correlate events.
   */
  readonly sessionId: string;
}

/**
 * One connected extension. The session is an `EventEmitter` so wiring
 * code can subscribe to inbound events without rebuilding the registry for
 * each new piece of behaviour.
 */
export class BrowserBridgeSession extends EventEmitter {
  readonly pairing: BrowserBridgePairing;
  readonly sessionId: string;

  private readonly socket: WebSocket;
  private readonly operationDeadlineMs: number;
  private readonly pingIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** The current challenge nonce, or `undefined` while the session is open. */
  private activeChallenge: WebuiBrowserBridgeChallenge | undefined;
  /** Whether the session has been fully admitted. */
  private admitted = false;
  /** The hello frame the extension opens with, cached so the pairing can run. */
  private helloFrame: { readonly publicKey?: WebuiBrowserBridgeEcdhPublicKey } | undefined;
  /** Why the session closed, captured for `closed` emission. */
  private closeReason: BrowserBridgeSessionCloseReason | undefined;
  /** The set of command ids awaiting an `input-result` reply. */
  private readonly inflight = new Map<
    string,
    { resolve: (outcome: BrowserBridgeCommandOutcome) => void; reject: (error: Error) => void; deadline: number }
  >();
  /** Ping nonce → resolver. A pong answers the latest ping. */
  private readonly pendingPings = new Map<string, () => void>();

  constructor(options: BrowserBridgeSessionOptions) {
    super();
    this.pairing = options.pairing;
    this.socket = options.socket;
    this.sessionId = options.sessionId;
    this.operationDeadlineMs =
      options.operationDeadlineMs ?? DEFAULT_OPERATION_DEADLINE_MS;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.socket.on("message", (data, isBinary) => {
      void this.handleMessage(data, isBinary);
    });
    this.socket.on("close", () => {
      if (!this.closeReason) this.closeReason = { kind: "remote" };
      this.teardown();
    });
    this.socket.on("error", (error) => {
      if (!this.closeReason) this.closeReason = { kind: "host_error", error: error.message };
      this.teardown();
    });
    // The challenge is gated on the extension's `hello`: a `pair` frame has
    // to leave ahead of it, and that needs the extension's public key.
  }

  /**
   * Boots the post-hello handshake.
   *
   * The session is constructed on the upgrade, but `pair` and `challenge`
   * wait until the extension's `hello` arrives so the host can build an ECDH
   * cipher the extension can actually open.
   */
  beginHelloGatedHandshake(): void {
    void this.sendPairAndChallenge();
  }

  /**
   * Sends the pairing transfer (if any) and then the challenge.
   *
   * Order matters: a `pair` frame carries the host's credential, which is
   * what the extension answers the challenge against. Reversing the order
   * would leave the extension signing with a credential it does not yet
   * have.
   */
  private async sendPairAndChallenge(): Promise<void> {
    const hello = this.helloFrame;
    if (!hello) return;
    if (this.closeReason) return;
    try {
      if (hello.publicKey) {
        const sealed = await this.pairing.sealCredentialForExtension(hello.publicKey);
        if (sealed.kind === "sealed") {
          this.sendFrameOrClose({
            kind: "pair",
            keyId: sealed.keyId,
            publicKey: sealed.publicKey,
            salt: sealed.salt,
            payload: sealed.payload,
          });
          if (this.closeReason) return;
        }
        // `off`: the surface's pairing has no credential. The host sends no
        // `pair` frame, so the extension cannot complete the handshake —
        // admission already refused the connection, and the session will
        // close once `issueChallenge` is asked.
      }
      const challenge = await this.pairing.issueChallenge();
      this.activeChallenge = challenge;
      this.sendFrameOrClose(challenge);
    } catch (error) {
      if (error instanceof PairingSwitchedOffError) {
        this.close({ kind: "switched_off" });
        return;
      }
      this.close({ kind: "host_error", error: errorMessage(error) });
    }
  }

  /**
   * Whether the session is fully admitted and the host may send commands.
   */
  get isAdmitted(): boolean {
    return this.admitted;
  }

  /** Why the session closed, if it has. */
  get lastCloseReason(): BrowserBridgeSessionCloseReason | undefined {
    return this.closeReason;
  }

  /**
   * Send an input command and wait for the extension's reply. The deadline
   * is per the bridge's "we still think it might come back" window — when
   * it expires we report a timeout, not a refusal. A reply that names the
   * same `commandId` with `accepted: false` is reported as a rejection
   * WITHOUT retry, since the extension has spoken and there is nothing to
   * recover.
   */
  async sendInput(
    command: WebuiBrowserBridgeInputCommand,
    options?: { readonly deadlineMs?: number },
  ): Promise<BrowserBridgeCommandOutcome> {
    if (!this.admitted) {
      return {
        kind: "timeout",
        commandId: commandIdOf(command),
        reason: "session is not yet admitted",
      };
    }
    if (this.inflight.size >= MAX_INFLIGHT_COMMANDS) {
      return {
        kind: "rejected",
        commandId: commandIdOf(command),
        reason: "too many in-flight commands on this session",
      };
    }
    const commandId = commandIdOf(command);
    const deadline = options?.deadlineMs ?? this.operationDeadlineMs;
    const deadlineAt = this.now() + deadline;
    const result = await withBridgeOperationRetry<BrowserBridgeCommandOutcome>(
      (attempt) => this.singleAttempt(commandId, command, attempt, deadlineAt),
      { deadlineMs: deadline, now: this.now, sleep: this.sleep },
    );
    if (result.kind === "timeout" && result.commandId === commandId) {
      return { kind: "timeout", commandId, reason: result.reason };
    }
    return result;
  }

  /**
   * Send a `closed` frame and terminate the underlying socket with the
   * given reason. Idempotent.
   */
  close(reason: BrowserBridgeSessionCloseReason): void {
    if (this.closeReason) return;
    this.closeReason = reason;
    const body: WebuiBrowserBridgeHostFrame = { kind: "closed", reason: describeClose(reason) };
    try {
      this.sendFrame(body);
    } catch {
      // The socket may already be torn down; the close itself will follow.
    }
    this.teardown();
  }

  /* ---------------------------------------------------------------------- */
  /* Wire protocol                                                          */
  /* ---------------------------------------------------------------------- */

  private async handleMessage(data: RawData, _isBinary: boolean): Promise<void> {
    const text = messageToText(data);
    if (text === undefined) {
      this.close({ kind: "host_error", error: "non-text frame" });
      return;
    }
    let frame: WebuiBrowserBridgeClientFrame;
    try {
      frame = JSON.parse(text) as WebuiBrowserBridgeClientFrame;
    } catch {
      this.close({ kind: "host_error", error: "invalid JSON frame" });
      return;
    }
    switch (frame.kind) {
      case "proof":
        await this.handleProof(frame);
        break;
      case "hello":
        // Capture the public key once. A second `hello` is ignored: the
        // session's identity is the first one, and any later frame would
        // either say the same thing or be a downgrade.
        if (!this.helloFrame) {
          this.helloFrame = {
            publicKey: isEcdhPublicKey(frame.publicKey) ? frame.publicKey : undefined,
          };
          this.beginHelloGatedHandshake();
        }
        break;
      case "targets":
        this.emit(
          "targets",
          frame.targets[0]?.browserId ?? "",
          frame.targets.map(toTargetExport),
        );
        break;
      case "frame":
        this.emit("frame", toFrameExport(frame.frame));
        break;
      case "input-result":
        await this.handleInputResult(frame);
        break;
      case "pong":
        this.handlePong(frame.nonce);
        break;
      default: {
        const exhaustive: never = frame;
        void exhaustive;
      }
    }
  }

  private async handleProof(proof: WebuiBrowserBridgeProof): Promise<void> {
    if (!this.activeChallenge) {
      this.close({ kind: "proof_failed" });
      return;
    }
    // The proof carries no `algorithm` field — the algorithm is implied by
    // the challenge it answers. (`verifyWebuiBrowserBridgeProof` already
    // runs HMAC-SHA256 over the canonical material.) A future-proof design
    // might pin the algorithm again here; the contract does not require it
    // today and we follow the wire.
    const challengeNonce = this.activeChallenge.nonce;
    const valid = await this.pairing.verifyProof(proof);
    if (!valid) {
      // Forget the nonce so it cannot be replayed later; the extension gets
      // one shot per challenge and the host does not chase further.
      this.pairing.forgetChallenge(challengeNonce);
      this.activeChallenge = undefined;
      this.close({ kind: "proof_failed" });
      return;
    }
    this.activeChallenge = undefined;
    this.admitted = true;
    const ready: WebuiBrowserBridgeHostFrame = { kind: "ready", sessionId: this.sessionId };
    try {
      this.sendFrame(ready);
      this.emit("ready");
    } catch (error) {
      this.close({ kind: "host_error", error: errorMessage(error) });
    }
  }

  private async handleInputResult(
    frame: { readonly kind: "input-result"; readonly commandId: string; readonly accepted: boolean; readonly error?: string },
  ): Promise<void> {
    const pending = this.inflight.get(frame.commandId);
    if (!pending) return;
    this.inflight.delete(frame.commandId);
    if (frame.accepted) {
      pending.resolve({ kind: "accepted", commandId: frame.commandId });
    } else {
      pending.resolve({
        kind: "rejected",
        commandId: frame.commandId,
        reason: frame.error ?? "extension refused the command",
      });
    }
  }

  private async singleAttempt(
    commandId: string,
    command: WebuiBrowserBridgeInputCommand,
    _attempt: number,
    deadlineAt: number,
  ): Promise<
    | { readonly kind: "success"; readonly value: BrowserBridgeCommandOutcome }
    | { readonly kind: "transient"; readonly message: string }
    | { readonly kind: "terminal"; readonly reason: "refused" | "cancelled" | "unknown"; readonly message: string }
  > {
    const remaining = deadlineAt - this.now();
    if (remaining <= 0) {
      return { kind: "terminal", reason: "unknown", message: "deadline already elapsed" };
    }
    try {
      this.sendFrame({ kind: "input", commandId, command });
    } catch (error) {
      return { kind: "transient", message: errorMessage(error) };
    }
    const outcome = await new Promise<BrowserBridgeCommandOutcome>((resolve, reject) => {
      this.inflight.set(commandId, {
        resolve,
        reject,
        deadline: deadlineAt,
      });
    });
    if (outcome.kind === "rejected") {
      return {
        kind: "terminal",
        reason: "refused",
        message: outcome.reason,
      };
    }
    if (outcome.kind === "timeout") {
      return { kind: "terminal", reason: "unknown", message: outcome.reason };
    }
    return { kind: "success", value: outcome };
  }

  private sendFrame(frame: WebuiBrowserBridgeHostFrame): void {
    const text = JSON.stringify(frame);
    // The frame may carry opaque identifiers; we don't log the body. The
    // brief forbids writing credentials to logs, but the broader rule is
    // "never put session material into a log line", and we apply it to
    // every frame regardless of whether it is sensitive.
    this.socket.send(text);
  }

  /**
   * Same as `sendFrame`, but a throw on a closed socket closes the session
   * with a host error rather than escaping into an unhandled rejection.
   * Used for the gated handshake path so a race against a peer that closed
   * straight after `hello` ends in a clean teardown.
   */
  private sendFrameOrClose(frame: WebuiBrowserBridgeHostFrame): void {
    try {
      this.sendFrame(frame);
    } catch (error) {
      this.close({ kind: "host_error", error: errorMessage(error) });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  private handlePong(nonce: string): void {
    const resolver = this.pendingPings.get(nonce);
    if (resolver) {
      this.pendingPings.delete(nonce);
      resolver();
    }
  }

  private teardown(): void {
    if (!this.admitted && !this.closeReason) {
      this.closeReason = { kind: "remote" };
    }
    if (this.activeChallenge) {
      this.pairing.forgetChallenge(this.activeChallenge.nonce);
      this.activeChallenge = undefined;
    }
    for (const [commandId, pending] of this.inflight.entries()) {
      pending.resolve({ kind: "timeout", commandId, reason: "session closed before reply" });
    }
    this.inflight.clear();
    for (const resolver of this.pendingPings.values()) resolver();
    this.pendingPings.clear();
    try {
      this.socket.terminate();
    } catch {
      // already gone
    }
    const reason = this.closeReason ?? { kind: "remote" };
    this.emit("closed", reason);
  }
}

/** Look at the math: a typical retry is `delay = 250ms * 2^attempt`, capped. */
void bridgeOperationReconnectDelayMs;

/** Wrap an error without leaking the message text into a log line. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? "unknown error" : String(error);
}

/** Decode a `RawData` to UTF-8 text. */
function messageToText(data: RawData): string | undefined {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Compute a deterministic command id from an input command. */
function commandIdOf(command: WebuiBrowserBridgeInputCommand): string {
  // We don't need a cryptographic id; a counter would do. Keeping it human
  // readable makes wire captures (during bring-up) obvious in the logs.
  switch (command.kind) {
    case "pointer":
      return `ptr:${command.targetId}:${command.generation}:${command.x},${command.y}:${command.clickCount}`;
    case "key":
      return `key:${command.targetId}:${command.generation}:${command.key}:${command.modifiers.join("+")}`;
    case "text":
      return `text:${command.targetId}:${command.generation}:${command.text}`;
  }
}

/** Convert an inbound target to a less-coupled export shape. */
function toTargetExport(target: WebuiBrowserBridgeTarget): BrowserBridgeBridgeTargetExport {
  return {
    browserId: target.browserId,
    targetId: target.targetId,
    title: target.title,
    url: target.url,
    generation: target.generation,
  };
}

/** Convert an inbound image frame. */
function toFrameExport(frame: WebuiBrowserBridgeImageFrame): BrowserBridgeBridgeImageFrameExport {
  return {
    browserId: frame.browserId,
    targetId: frame.targetId,
    generation: frame.generation,
    data: frame.data,
    format: frame.format,
    sequence: frame.sequence,
  };
}

/** Map a close reason to a wire-safe string. */
function describeClose(reason: BrowserBridgeSessionCloseReason): string {
  switch (reason.kind) {
    case "remote":
      return "remote closed";
    case "proof_failed":
      return "pairing proof failed";
    case "switched_off":
      return "browser switch turned off";
    case "store_unavailable":
      return "credential store unavailable";
    case "host_revoked":
      return "host revoked the session";
    case "host_error":
      return `host error: ${reason.error}`;
  }
}

// Reference symbols that would otherwise be elided by tree-shaking.
void BridgeOperationError;

/**
 * Whether `value` is a structurally valid ECDH public-key JWK.
 *
 * Validation is structural rather than the full JOSE one — `webcrypto`'s own
 * `importKey` would catch the rest, but doing it here turns "host refuses to
 * pair without a public key" from a negative inference into an explicit
 * branch in the right place.
 */
function isEcdhPublicKey(value: unknown): value is WebuiBrowserBridgeEcdhPublicKey {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kty === "EC" &&
    candidate.crv === "P-256" &&
    typeof candidate.x === "string" &&
    candidate.x.length > 0 &&
    typeof candidate.y === "string" &&
    candidate.y.length > 0
  );
}
