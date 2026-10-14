// The WebSocket wire mechanics every operation shares (T18; plan §6, W7).
//
// One socket carries one request: this module opens it, writes the same
// envelope once the socket opens, tells the caller's own answer apart from
// whatever else arrives on that socket, and settles. What a frame *means* is
// not shared — a unary response resolves, an `event` frame is forwarded until
// `[DONE]`, a terminal frame is forwarded until the caller stops — so each
// caller supplies its own handlers.
//
// This module names no operation of its own: `operation` arrives as a
// parameter. The domain method table that supplies it — through the canonical
// identifiers in `shared/operation-names.ts` — is
// `client/infrastructure/transport.ts`. Wire lifecycle mechanics here, domain
// method tables there is the whole split.

import type { WebuiDeliveryHandle } from "../contracts/turn/execution-port.js";
import type { WebuiStreamFrame } from "../../shared/contracts/stream.js";
import type { WebuiTerminalFrame } from "../../shared/contracts/terminal.js";
import {
  createWebuiEventChannel,
  type WebuiClientEventWatcher,
  type WebuiSocket,
  type WireFrame,
} from "./event-channel.js";

export type { WebuiSocket };

export interface WebuiWireOptions {
  readonly websocketUrl: string;
  readonly token: string;
  readonly webSocket?: new (url: string) => WebuiSocket;
  /** Deadline for unary operations that otherwise could remain pending on a half-open socket. */
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** A socket carrying one request, and the only way to settle it. */
export interface WebuiWireSession {
  readonly close: () => void;
}

/**
 * What a caller does with the frames of its own request. Everything but
 * `frame` is optional, because the three call shapes below disagree about what a
 * parse failure, a close or a socket error means — `watchTerminal` ignores all
 * three, a unary request rejects on all three.
 */
interface WebuiWireHandlers {
  readonly frame: (session: WebuiWireSession, frame: WireFrame) => void;
  readonly invalidFrame?: (session: WebuiWireSession) => void;
  readonly closed?: (session: WebuiWireSession) => void;
  readonly failed?: (session: WebuiWireSession) => void;
}

function defaultWebSocket(): new (url: string) => WebuiSocket {
  return WebSocket as unknown as new (url: string) => WebuiSocket;
}

/** The three request shapes the domain method table drives. */
export interface WebuiWire {
  request<T>(operation: string, body: unknown): Promise<T>;
  stream(
    operation: string,
    body: unknown,
    onFrame: (frame: WebuiStreamFrame) => void,
    onDelivery?: (handle: WebuiDeliveryHandle) => void,
  ): Promise<void>;
  watchTerminal(
    operation: string,
    requestBody: { readonly terminalId: string },
    onFrame: (frame: WebuiTerminalFrame) => void,
  ): () => void;
  /** The one HTTP route, built from the same base and token as the socket. */
  workspaceFileUrl(input: { readonly workspaceDir: string; readonly path: string }): string;
  /**
   * The process-event socket. It belongs to the wire rather than to the table
   * because it is a long-lived socket with its own reconnect policy, not a
   * named request: the table joins it to the `watchEvents` capability and names
   * no operation for it.
   */
  readonly watchEvents: WebuiClientEventWatcher;
}

export function createWebuiWire({
  websocketUrl: baseWebsocketUrl,
  token,
  webSocket = defaultWebSocket(),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: WebuiWireOptions): WebuiWire {
  const websocketUrl = () =>
    `${baseWebsocketUrl.replace(/\/$/u, "")}/?token=${encodeURIComponent(token)}`;

  /**
   * One socket, one request frame, one requestId.
   *
   * Every operation opens a socket, writes the same envelope once the socket
   * opens, and then has to tell its own answer apart from whatever else arrives
   * on that socket. That part is shared. What a frame *means* is not, so the
   * handler decides. The session is passed back to each handler because settling
   * means closing this socket, and a handler that reached for it by closure would
   * be reading a `const` that does not exist yet when the socket opens
   * synchronously.
   */
  function openWireSession(
    operation: string,
    body: unknown,
    handlers: WebuiWireHandlers,
  ): WebuiWireSession {
    const ws = new webSocket(websocketUrl());
    const requestId = crypto.randomUUID();
    const session: WebuiWireSession = { close: () => ws.close() };
    ws.addEventListener("open", () =>
      ws.send(
        JSON.stringify({
          protocolVersion: 1,
          kind: "request",
          requestId,
          operation,
          body,
        }),
      ),
    );
    ws.addEventListener("message", (event) => {
      let frame: WireFrame;
      try {
        frame = JSON.parse(String(event.data)) as WireFrame;
      } catch {
        handlers.invalidFrame?.(session);
        return;
      }
      if (frame.requestId !== requestId) return;
      handlers.frame(session, frame);
    });
    ws.addEventListener("close", () => handlers.closed?.(session));
    ws.addEventListener("error", () => handlers.failed?.(session));
    return session;
  }

  function request<T>(operation: string, body: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const fail = (session: WebuiWireSession, error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.close();
        reject(error);
      };
      const session = openWireSession(operation, body, {
        frame: (session, frame) => {
          if (frame.kind === "error") {
            fail(session, new Error(frame.message ?? "WebUI request refused"));
            return;
          }
          if (frame.kind !== "response") return;
          settled = true;
          clearTimeout(timeout);
          session.close();
          resolve(frame.body as T);
        },
        invalidFrame: (session) => fail(session, new Error("WebUI returned invalid JSON")),
        closed: (session) =>
          fail(session, new Error("WebUI connection closed before the response")),
        failed: (session) => fail(session, new Error("WebUI connection failed")),
      });
      timeout = setTimeout(
        () =>
          fail(
            session,
            new Error(`WebUI request timed out after ${requestTimeoutMs}ms (${operation})`),
          ),
        requestTimeoutMs,
      );
    });
  }

  // `sendMessage` and `resumeSession` share the same wire shape: the
  // operation returns an `event`-framed iterable that ends with a
  // `[DONE]` payload (see `session-stream-delivery.ts` and the brief's
  // "two facts that make this ticket small"). One helper keeps the
  // close/error race in lockstep across both operations.
  function stream(
    operation: string,
    body: unknown,
    onFrame: (frame: WebuiStreamFrame) => void,
    onDelivery?: (handle: WebuiDeliveryHandle) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      // A detached delivery must not deliver, and `close()` is not a promise that
      // the socket stops emitting — the same rule `watchTerminal` follows.
      let detached = false;
      const fail = (session: WebuiWireSession, error: Error) => {
        if (settled) return;
        settled = true;
        session.close();
        reject(error);
      };
      const session = openWireSession(operation, body, {
        frame: (session, frame) => {
          if (detached) return;
          if (frame.kind === "error") {
            fail(session, new Error(frame.message ?? `${operation} refused`));
            return;
          }
          if (frame.kind !== "event") return;
          const streamFrame = frame.body as WebuiStreamFrame;
          onFrame(streamFrame);
          if (streamFrame.dataJson === "[DONE]") {
            settled = true;
            session.close();
            resolve();
          }
        },
        invalidFrame: (session) => fail(session, new Error("WebUI returned invalid JSON")),
        closed: (session) => fail(session, new Error("WebUI connection closed before [DONE]")),
        failed: (session) => fail(session, new Error("WebUI connection failed")),
      });
      onDelivery?.({
        close: () => {
          if (settled) return;
          // Detaching SETTLES the operation rather than failing it: the host
          // accepted this request long ago, so there is no error to report and no
          // recovery to attempt — the client simply stops watching. Failing here
          // would hand the loop a transport error and make a deliberate detach
          // look like a dropped connection.
          detached = true;
          settled = true;
          session.close();
          resolve();
        },
      });
    });
  }

  function watchTerminal(
    operation: string,
    requestBody: { readonly terminalId: string },
    onFrame: (frame: WebuiTerminalFrame) => void,
  ): () => void {
    let stopped = false;
    const session = openWireSession(operation, requestBody, {
      frame: (_session, frame) => {
        // A stopped watch must not deliver, and `close()` is not a promise that
        // the socket stops emitting: the caller's flag is what guarantees it.
        if (stopped) return;
        if (frame.kind !== "event" || !frame.body || typeof frame.body !== "object") return;
        onFrame(frame.body as WebuiTerminalFrame);
      },
    });
    return () => {
      stopped = true;
      session.close();
    };
  }

  function workspaceFileUrl({
    workspaceDir,
    path: filePath,
  }: {
    readonly workspaceDir: string;
    readonly path: string;
  }): string {
    // `ws:`/`wss:` share the `ws` prefix, so one substitution lands on
    // `http:`/`https:` respectively, and it must happen before the token is
    // appended — the server checks the token on this route like any other.
    const base = baseWebsocketUrl.replace(/\/$/u, "").replace(/^ws/iu, "http");
    const query = new URLSearchParams({ dir: workspaceDir, path: filePath, token });
    return `${base}/workspace-file?${query.toString()}`;
  }

  return {
    request,
    stream,
    watchTerminal,
    workspaceFileUrl,
    watchEvents: createWebuiEventChannel({ websocketUrl, webSocket }),
  };
}
