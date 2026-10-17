// The event channel's health: what counts as "not going to work", what counts as
// "try again", and what a fatal state means.
//
// These are the facts the plan states about the long-lived link (V26): a dropped
// connection retries with a bounded, jittered, exponentially growing delay; a
// **protocol or capability** rejection is fatal because retrying sends the same
// frame; and a code this build has never seen is transient, because an unfamiliar
// code is a newer server rather than a malformed one.

import { describe, expect, it, vi } from "vitest";

import {
  createWebuiEventChannel,
  isFatalWebuiChannelCode,
  WEBUI_CHANNEL_MAX_RETRY_MS,
  webuiChannelRetryDelayMs,
} from "../../src/client/platform/event-channel.js";
import { WebuiErrorCode, WEBUI_PROTOCOL_VERSION } from "../../src/shared/envelope.js";

/** A socket that records what the channel wrote and lets a test drive it. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: "open" | "message" | "error" | "close", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  /** The request id the channel generated for this connection. */
  get requestId(): string {
    const frame = JSON.parse(this.sent[0] ?? "{}") as { requestId?: string };
    return frame.requestId ?? "";
  }
}

const lastSocket = (): FakeSocket => FakeSocket.instances[FakeSocket.instances.length - 1]!;

function channel(options: Partial<Parameters<typeof createWebuiEventChannel>[0]> = {}) {
  const onEvent = vi.fn();
  const onReconnect = vi.fn();
  const created = createWebuiEventChannel({
    websocketUrl: () => "ws://runtime.test/events",
    webSocket: FakeSocket as unknown as Parameters<typeof createWebuiEventChannel>[0]["webSocket"],
    baseRetryMs: 100,
    maxRetryMs: 400,
    jitter: () => 1,
    report: () => undefined,
    ...options,
  });
  // The channel *is* the watcher: call it to subscribe, and read `health` beside it.
  const unsubscribe = created(onEvent, onReconnect);
  return { channel: created, onEvent, onReconnect, unsubscribe };
}

describe("V26 · the delay before a retry is bounded and spread", () => {
  it("grows exponentially, jitters, and stops at the ceiling", () => {
    const at = (attempt: number, jitter: number) =>
      webuiChannelRetryDelayMs(attempt, { baseMs: 100, maxMs: 1_600, jitter: () => jitter });

    expect([1, 2, 3, 4].map((attempt) => at(attempt, 1))).toEqual([100, 200, 400, 800]);
    // Capped, then jittered below the cap — the ceiling still means something.
    expect(at(5, 1)).toBe(1_600);
    expect(at(9, 1)).toBe(1_600);
    expect(at(5, 0)).toBe(800);
    // The default ceiling is the 30 s interval a client will not exceed.
    expect(WEBUI_CHANNEL_MAX_RETRY_MS).toBe(30_000);
    expect(webuiChannelRetryDelayMs(20, { jitter: () => 1 })).toBe(30_000);
  });

  it("treats protocol and capability rejections as fatal, and an unknown code as transient", () => {
    expect(isFatalWebuiChannelCode(WebuiErrorCode.protocolMismatch)).toBe(true);
    expect(isFatalWebuiChannelCode(WebuiErrorCode.invalidEnvelope)).toBe(true);
    expect(isFatalWebuiChannelCode(WebuiErrorCode.capabilityUnavailable)).toBe(true);
    expect(isFatalWebuiChannelCode(WebuiErrorCode.capabilityNotReady)).toBe(true);
    // An open string: a code this build has never heard of is a newer server, and
    // guessing "fatal" from it would strand a client that could have reconnected.
    expect(isFatalWebuiChannelCode("some_code_from_the_future")).toBe(false);
  });
});

describe("V26 · one socket, one health signal", () => {
  it("reports open on the acknowledgement and reconnects once per connection", () => {
    const { channel: created, onReconnect } = channel();
    const socket = lastSocket();
    socket.emit("open");
    socket.emit("message", JSON.stringify({ protocolVersion: WEBUI_PROTOCOL_VERSION, kind: "response", requestId: socket.requestId, body: {} }));
    expect(created.health.state().kind).toBe("open");
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // A second acknowledgement on the same connection is not a reconnect.
    socket.emit("message", JSON.stringify({ protocolVersion: WEBUI_PROTOCOL_VERSION, kind: "response", requestId: socket.requestId, body: {} }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("goes transient with an attempt count and a delay when the socket closes", () => {
    const { channel: created } = channel({ baseRetryMs: 100, jitter: () => 1 });
    lastSocket().emit("close");
    const state = created.health.state();
    expect(state.kind).toBe("transient");
    if (state.kind === "transient") {
      expect(state.attempt).toBe(1);
      expect(state.retryInMs).toBe(100);
    }
  });

  it("stops retrying on a fatal rejection, and only a deliberate reconnect resumes", () => {
    const { channel: created } = channel();
    const socket = lastSocket();
    socket.emit("open");
    socket.emit(
      "message",
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "error",
        requestId: socket.requestId,
        code: WebuiErrorCode.capabilityNotReady,
        message: "terminal bridge is not ready",
      }),
    );
    const fatal = created.health.state();
    expect(fatal.kind).toBe("fatal");
    if (fatal.kind === "fatal") expect(fatal.code).toBe(WebuiErrorCode.capabilityNotReady);

    // A close after a fatal state does not restart the loop.
    socket.emit("close");
    expect(created.health.state().kind).toBe("fatal");

    // A deliberate act does: this is the one thing that ends a fatal condition.
    const before = FakeSocket.instances.length;
    created.health.reconnect();
    expect(FakeSocket.instances.length).toBe(before + 1);
    expect(created.health.state().kind).toBe("connecting");
  });

  it("keeps a protocol-valid frame from a different request from marking it healthy", () => {
    const { channel: created } = channel();
    const socket = lastSocket();
    socket.emit("open");
    socket.emit(
      "message",
      JSON.stringify({ protocolVersion: WEBUI_PROTOCOL_VERSION, kind: "response", requestId: "someone-else", body: {} }),
    );
    expect(created.health.state().kind).toBe("connecting");
  });
});
