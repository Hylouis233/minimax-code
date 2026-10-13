// The wire skeleton the three socket-carrying operations share (U24).
//
// `request`, `stream` and `watchTerminal` used to write the same socket setup
// three times: mint a requestId, send the same envelope on `open`, parse each
// frame and drop anything that answers a different request. The consolidation
// lives in `openWireSession`, and these cases pin the part that is now shared —
// which nothing pinned before. The three callers' own policies (what settles
// them, whether a close is an error) stay covered where they already were, in
// `webui-service.test.ts`.
import { describe, expect, it } from "vitest";

import { createWebuiTransport } from "../../src/client/infrastructure/transport.js";

/** A socket that records what was sent and lets a test deliver frames. */
class ControllableSocket {
  static latest: ControllableSocket | undefined;

  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  private closed = false;

  constructor(_url: string) {
    ControllableSocket.latest = this;
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", {});
  }

  /** The request frame the transport wrote, parsed. */
  get request(): { requestId: string; operation: string; body: unknown; [key: string]: unknown } {
    return JSON.parse(this.sent[0] ?? "{}") as never;
  }

  deliver(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  /** A payload that is not JSON at all — `deliver` always stringifies to valid JSON. */
  deliverRaw(data: string): void {
    this.emit("message", { data });
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** The socket writes its request frame from an `open` microtask. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function transportWith(socket: typeof ControllableSocket) {
  return createWebuiTransport({
    websocketUrl: "ws://127.0.0.1:1",
    token: "fixture-token",
    webSocket: socket as unknown as NonNullable<
      Parameters<typeof createWebuiTransport>[0]["webSocket"]
    >,
  });
}

describe("the shared request envelope", () => {
  it("writes one request frame naming the operation, with a fresh id", async () => {
    const transport = transportWith(ControllableSocket);
    const pending = transport.loadSessions();
    await tick();
    const socket = ControllableSocket.latest!;
    const request = socket.request;
    expect(request).toMatchObject({
      protocolVersion: 1,
      kind: "request",
      operation: "listSessions",
      body: { name: "main", limit: 500 },
    });
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    socket.deliver({ kind: "response", requestId: request.requestId, body: { sessions: [] } });
    await expect(pending).resolves.toEqual({ sessions: [] });
  });

  it("ignores a frame answering a different request", async () => {
    const transport = transportWith(ControllableSocket);
    const pending = transport.loadSessions();
    await tick();
    const socket = ControllableSocket.latest!;
    const mine = socket.request.requestId;
    // A frame for someone else must not settle this promise — and it arrives
    // first, so a filter that dropped only later frames would be caught here.
    socket.deliver({ kind: "response", requestId: "another-request", body: { poison: true } });
    socket.deliver({ kind: "response", requestId: mine, body: { sessions: [] } });
    await expect(pending).resolves.toEqual({ sessions: [] });
  });

  it("rejects the request when the socket answers with something unparseable", async () => {
    const transport = transportWith(ControllableSocket);
    const pending = transport.loadSessions();
    await tick();
    ControllableSocket.latest!.deliverRaw("{not json");
    await expect(pending).rejects.toThrow("WebUI returned invalid JSON");
  });
});

describe("the terminal watch", () => {
  it("forwards event frames and stops on request", async () => {
    const transport = transportWith(ControllableSocket);
    const frames: unknown[] = [];
    const stop = transport.watchTerminal({ terminalId: "t1" }, (frame) => frames.push(frame));
    await tick();
    const socket = ControllableSocket.latest!;
    expect(socket.request).toMatchObject({
      kind: "request",
      operation: "watchTerminal",
      body: { terminalId: "t1" },
    });
    const id = socket.request.requestId;
    socket.deliver({ kind: "event", requestId: id, body: { chunk: "one" } });
    // Neither a response frame nor an event frame without an object body is a
    // terminal frame; a watch that forwarded them would hand the caller
    // something the type says cannot arrive.
    socket.deliver({ kind: "response", requestId: id, body: { chunk: "ignored" } });
    socket.deliver({ kind: "event", requestId: id, body: "raw" });
    socket.deliver({ kind: "event", requestId: id, body: { chunk: "two" } });
    expect(frames).toEqual([{ chunk: "one" }, { chunk: "two" }]);
    stop();
    socket.deliver({ kind: "event", requestId: id, body: { chunk: "after-stop" } });
    expect(frames).toEqual([{ chunk: "one" }, { chunk: "two" }]);
  });
});

// The delivery handle (`stream`'s third argument; T04's
// `delivery-disposer-registry`). A streaming operation used to return a promise
// and nothing else, so the client held no disposer at all: the only ways a stream
// could end were `[DONE]`, an error, or the socket dropping. These cases pin the
// handle the application can now keep, and that detaching is about THIS client's
// observation only — the request was already accepted by the host.
describe("the delivery handle a streaming operation hands out", () => {
  it("stops delivering frames and closes the socket when it is closed", async () => {
    const transport = transportWith(ControllableSocket);
    const frames: unknown[] = [];
    let delivery: { close: () => void } | undefined;
    const settled = transport.sendMessage(
      { id: "s1", content: "hello" },
      (frame) => frames.push(frame),
      (handle) => {
        delivery = handle;
      },
    );
    await tick();
    const socket = ControllableSocket.latest!;
    const id = socket.request.requestId;
    socket.deliver({ kind: "event", requestId: id, body: { dataJson: "{\"chunk\":1}" } });
    expect(frames).toHaveLength(1);

    expect(delivery).toBeDefined();
    delivery!.close();
    // A detach settles the operation: there is no error to report, because the
    // host accepted this request long ago. Failing here would make a deliberate
    // detach look like a dropped connection.
    await expect(settled).resolves.toBeUndefined();

    // And it only stops the client watching.
    socket.deliver({ kind: "event", requestId: id, body: { dataJson: "{\"chunk\":2}" } });
    expect(frames).toHaveLength(1);
  });

  it("hands out one for an attachment too", async () => {
    const transport = transportWith(ControllableSocket);
    let delivery: { close: () => void } | undefined;
    void transport.resumeSession({ id: "s1" }, () => undefined, (handle) => {
      delivery = handle;
    });
    await tick();
    expect(delivery).toBeDefined();
    // Closing twice is harmless: a detach and a terminal exit can both race here.
    delivery!.close();
    delivery!.close();
  });

  it("still settles on [DONE] when nobody detaches", async () => {
    const transport = transportWith(ControllableSocket);
    const frames: unknown[] = [];
    const settled = transport.sendMessage(
      { id: "s1", content: "hello" },
      (frame) => frames.push(frame),
      () => undefined,
    );
    await tick();
    const socket = ControllableSocket.latest!;
    const id = socket.request.requestId;
    socket.deliver({ kind: "event", requestId: id, body: { dataJson: "[DONE]" } });
    await expect(settled).resolves.toBeUndefined();
    expect(frames).toHaveLength(1);
  });
});
