// The single long-lived `watchEvents` channel, split from `transport.ts`.
//
// One channel per application instance, with its reconnection policy: the socket
// reconnects after a close, and immediately when the document becomes visible or
// the browser reports it is online. It owns no business state — it reports
// connection facts through `connection-health` and hands every event body to the
// caller.
//
// A close is not one fact, so it is not treated as one. A dropped socket is
// transient: try again, backing off so a service that is down is not hammered. A
// protocol or configuration rejection is fatal: the same request would be refused
// forever, so retrying it automatically turns one clear failure into a loop that
// also hides the cause. The two are typed apart and treated apart — fatal stops
// automatic retry until an explicit reconnect or a new subscription, transient
// backs off with capped exponential delay plus jitter, so a fleet of clients that
// dropped together does not return in lockstep.
//
// Split out of `transport.ts` so the channel's lifecycle is one module: the
// transport keeps request/response IO and the independent streams (session and
// terminal), and this file owns the one channel that outlives them.

import {
  markWebuiEventWatcherDown,
  markWebuiEventWatcherHealthy,
  registerWebuiEventWatcher,
  unregisterWebuiEventWatcher,
} from "./connection-health.js";
import type { WebuiRuntimeEvent } from "../../shared/contracts/stream.js";
import {
  decodeWebuiServerFrame,
  WebuiErrorCode,
  type WebuiWireErrorCode,
} from "../../shared/envelope.js";
import type {WebuiClientEventWatcher} from "../features/shell/contracts/watch-port.js";

export type { WebuiClientEventWatcher };

declare const document: {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};
declare const window: {
  addEventListener(type: "online", listener: () => void): void;
  removeEventListener(type: "online", listener: () => void): void;
};

/**
 * One frame off the socket that has already been judged by the shared decoder:
 * its version, kind and identity are known good, and an `error` frame carries
 * the service's own code. `wire.ts` decodes the same frames for the
 * request/stream and terminal sockets and imports this shape rather than
 * restating it.
 */
export type WireFrame =
  | {
      readonly kind: "response" | "event";
      readonly requestId: string;
      readonly body?: unknown;
    }
  | {
      readonly kind: "error";
      readonly requestId: string;
      readonly code: WebuiWireErrorCode;
      readonly message: string;
    };

export interface WebuiSocket {
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void;
  send(data: string): void;
  close(): void;
}

export type WebuiClientRuntimeEvent = WebuiRuntimeEvent;

/**
 * The channel's health, as a closed set.
 *
 * `fatal` is the state that does not retry by itself, and it carries the code and
 * message the service gave, so a reader can explain the failure rather than
 * showing a spinner that will never resolve.
 */
export type WebuiChannelState =
  | { readonly kind: "connecting" }
  | { readonly kind: "open" }
  | {
      readonly kind: "transient";
      /** Consecutive failures so far; the delay is derived from it. */
      readonly attempt: number;
      /** The delay before the next attempt, in milliseconds. */
      readonly retryInMs: number;
    }
  | {
      readonly kind: "fatal";
      readonly code: WebuiWireErrorCode;
      readonly message: string;
    };

export interface WebuiEventChannelHealth {
  readonly state: () => WebuiChannelState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Try again now, clearing a fatal state.
   *
   * The one thing that ends a fatal condition is a deliberate act — a
   * configuration change, or a user asking again — so it is a call rather than a
   * timer. A fatal failure is never reconnected automatically.
   */
  readonly reconnect: () => void;
}

/** The channel plus the health it reports. */
export interface WebuiClientEventChannel extends WebuiClientEventWatcher {
  readonly health: WebuiEventChannelHealth;
}

/** Everything the channel needs from the transport that owns the socket factory. */
export interface WebuiEventChannelOptions {
  readonly websocketUrl: () => string;
  readonly webSocket: new (url: string) => WebuiSocket;
  /** The first retry delay; doubled per consecutive failure up to `maxRetryMs`. */
  readonly baseRetryMs?: number;
  /** The interval ceiling. A dropped connection retries at most this slowly. */
  readonly maxRetryMs?: number;
  /**
   * Jitter for one retry, in `[0, 1)`. Injected so a test can pin the delay it
   * asserts; the default is the real randomness a fleet of clients needs so they
   * do not all return at the same instant.
   */
  readonly jitter?: () => number;
  /** Where a fatal transition is reported. Kept injectable for tests. */
  readonly report?: (message: string, detail: unknown) => void;
}

/** The default ceiling: the longest a client will wait before trying again. */
export const WEBUI_CHANNEL_MAX_RETRY_MS = 30_000;
const DEFAULT_BASE_RETRY_MS = 250;

/**
 * Whether a service refusal means "this will keep failing".
 *
 * Protocol and envelope rejections are this client and that service disagreeing
 * about the protocol, so retrying sends the same frame again. The capability
 * codes are configuration/readiness facts about the deployment.
 *
 * An **unknown** code is deliberately not fatal: codes are an open string for
 * forward compatibility, so a newer server raising a code this build has never
 * heard of is a transient failure rather than a malformed frame. Guessing
 * "fatal" from an unfamiliar code would strand a client against a server it could
 * have reconnected to.
 */
export function isFatalWebuiChannelCode(code: WebuiWireErrorCode): boolean {
  return (
    code === WebuiErrorCode.protocolMismatch ||
    code === WebuiErrorCode.invalidEnvelope ||
    code === WebuiErrorCode.capabilityUnavailable ||
    code === WebuiErrorCode.capabilityNotReady
  );
}

/**
 * The delay before retry `attempt` (1-based): exponential, capped, jittered.
 *
 * The cap is the 30 s interval ceiling; the jitter is a fraction of the capped
 * base, so a fleet that lost its connections together spreads out instead of
 * returning together, and the ceiling stays meaningful.
 */
export function webuiChannelRetryDelayMs(
  attempt: number,
  options: {
    readonly baseMs?: number;
    readonly maxMs?: number;
    readonly jitter?: () => number;
  } = {},
): number {
  const baseMs = options.baseMs ?? DEFAULT_BASE_RETRY_MS;
  const maxMs = options.maxMs ?? WEBUI_CHANNEL_MAX_RETRY_MS;
  const jitter = options.jitter ?? Math.random;
  const capped = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(capped * (0.5 + 0.5 * jitter()));
}

export function createWebuiEventChannel(
  options: WebuiEventChannelOptions,
): WebuiClientEventChannel {
  const { websocketUrl, webSocket } = options;
  // One channel per application instance owns one subscription, so the health
  // belongs to the channel rather than to each subscription: a second subscriber
  // attaches to the same socket and the same state.
  const healthListeners = new Set<() => void>();
  let state: WebuiChannelState = { kind: "connecting" };
  let explicitReconnect: () => void = () => undefined;
  const setState = (next: WebuiChannelState): void => {
    state = next;
    for (const listener of [...healthListeners]) listener();
  };
  const health: WebuiEventChannelHealth = {
    state: () => state,
    subscribe: (listener) => {
      healthListeners.add(listener);
      return () => healthListeners.delete(listener);
    },
    reconnect: () => {
      explicitReconnect();
    },
  };

  const subscribe = (
    onEvent: (event: WebuiClientRuntimeEvent) => void,
    onReconnect?: () => void,
  ): (() => void) => {
    // This socket is the page's only long-lived link while no turn runs, so
    // its health is the user's "am I still connected" signal between turns.
    // Reported from inside the transport so the watcher counts every
    // subscription without each call site wiring callbacks; the store's
    // ever-healthy rule keeps boot quiet. There is exactly one subscription
    // per application instance: the event coordinator owns the process-event
    // ingress, and no panel subscribes to process events directly any more.
    const watcherToken = registerWebuiEventWatcher();
    const report =
      options.report ??
      ((message: string, detail: unknown) => console.error(message, detail));
    let stopped = false;
    let socket: WebuiSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    /** Consecutive transient failures; a healthy acknowledgement resets it. */
    let attempt = 0;
    let fatal = false;
    const clearTimer = (): void => {
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };
    const connect = () => {
      if (stopped) return;
      clearTimer();
      setState({ kind: "connecting" });
      const ws = new webSocket(websocketUrl());
      socket = ws;
      const requestId = crypto.randomUUID();
      // Fires when the server *accepts* the `watchEvents` request, not when
      // the socket is created and not when the request is written. It is an
      // acceptance signal, **not** proof that the runtime's event bus has
      // subscribed: `watchProcessEvents` is an async generator whose body —
      // where `subscribe()` lives — does not run until the first `next()`,
      // and the server pumps the iterator after answering. Do not read this
      // as "no event can slip past from here".
      let acknowledged = false;
      ws.addEventListener("open", () => {
        if (stopped) return;
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            kind: "request",
            requestId,
            operation: "watchEvents",
            body: {},
          }),
        );
      });
      ws.addEventListener("message", (event) => {
        if (stopped) return;
        // Judged by the same decoder the request sockets use. The event channel
        // used to parse and trust whatever arrived, so a frame from a different
        // protocol version counted as a live event and marked the connection
        // healthy.
        const decoded = decodeWebuiServerFrame(String(event.data));
        if (!decoded.ok) {
          // A frame this client cannot read at all is the same class of failure
          // as a version mismatch: this socket is not going to start making
          // sense, so it is reported rather than retried in a loop.
          if (decoded.reason !== "invalid_json") {
            enterFatal(WebuiErrorCode.invalidEnvelope, decoded.message);
          }
          return;
        }
        const frame = decoded.frame;
        if (frame.requestId !== requestId) return;
        if (frame.kind === "error") {
          if (isFatalWebuiChannelCode(frame.code)) {
            enterFatal(frame.code, frame.message);
          }
          return;
        }
        if (frame.kind === "response") {
          // A healthy acknowledgement is also the end of a transient episode.
          attempt = 0;
          markWebuiEventWatcherHealthy(watcherToken);
          setState({ kind: "open" });
          if (acknowledged) return;
          acknowledged = true;
          // Fires once per connection: the first ack is the initial
          // watcher-ready signal, every later one follows a reconnect.
          onReconnect?.();
          return;
        }
        if (frame.kind !== "event") return;
        const body = frame.body;
        if (body && typeof body === "object" && !Array.isArray(body))
          onEvent(body as WebuiClientRuntimeEvent);
      });
      ws.addEventListener("close", () => {
        if (stopped || socket !== ws) return;
        socket = undefined;
        markWebuiEventWatcherDown(watcherToken);
        if (fatal) {
          // The fatal verdict already decided not to come back; the socket
          // closing behind it is that verdict taking effect.
          return;
        }
        attempt += 1;
        const retryInMs = webuiChannelRetryDelayMs(attempt, {
          ...(options.baseRetryMs === undefined ? {} : { baseMs: options.baseRetryMs }),
          ...(options.maxRetryMs === undefined ? {} : { maxMs: options.maxRetryMs }),
          ...(options.jitter === undefined ? {} : { jitter: options.jitter }),
        });
        setState({ kind: "transient", attempt, retryInMs });
        reconnectTimer = setTimeout(connect, retryInMs);
      });
      ws.addEventListener("error", () => undefined);
    };
    const enterFatal = (code: WebuiWireErrorCode, message: string): void => {
      fatal = true;
      clearTimer();
      markWebuiEventWatcherDown(watcherToken);
      setState({ kind: "fatal", code, message });
      report(
        "[webui] event channel stopped: the service rejected the connection in a way that will not change by retrying",
        { code, message },
      );
      const previous = socket;
      socket = undefined;
      previous?.close();
    };
    const reconnectNow = (): void => {
      if (stopped) return;
      fatal = false;
      attempt = 0;
      const previous = socket;
      socket = undefined;
      previous?.close();
      connect();
    };
    explicitReconnect = reconnectNow;
    const reconnectWhenAvailable = () => {
      if (stopped) return;
      // A fatal condition is not cleared by the browser becoming visible or
      // online: it is a verdict about the protocol or the configuration, and
      // only an explicit reconnect or a new subscription revisits it.
      if (fatal) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      attempt = 0;
      reconnectNow();
    };
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", reconnectWhenAvailable);
    if (typeof window !== "undefined")
      window.addEventListener("online", reconnectWhenAvailable);
    connect();
    return () => {
      stopped = true;
      clearTimer();
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", reconnectWhenAvailable);
      if (typeof window !== "undefined")
        window.removeEventListener("online", reconnectWhenAvailable);
      socket?.close();
      unregisterWebuiEventWatcher(watcherToken);
    };
  };

  return Object.assign(subscribe, { health });
}
