// The bridge server.
//
// The bridge is a WebSocket server of its own. It does not reuse the WebUI's
// `WebSocketServer` and it never goes through `admitWebSocketUpgrade`: the
// generic path admits a loopback browser page with a per-start bearer token,
// and this socket connects to something that is not a browser page at all. It
// has its own path, its own credentials and its own origin rule, and mixing any
// of the three with the generic path would either widen the page path or
// weaken the bridge.
//
// The layer matrix in `scripts/lib/webui-dependency-rules.mjs` classifies this
// directory as `server`, which may reach `shared` and the runtime port but not
// the runtime implementation. That is why the provider surface below is
// declared here rather than imported from the runtime: the two sides meet
// structurally, through the composition root, without a forbidden edge in
// either direction.
//
// What this object owns:
//   * one `BrowserBridgePairing` per external surface, each with its own
//     credential store entry and its own high-entropy credential — Edge and
//     Chrome never share one, so compromising one browser's pairing does not
//     hand over the other;
//   * one `BrowserBridgeRegistry`, which owns the per-target routing and the
//     per-tab serialization;
//   * one `BrowserBridgeSession` per admitted extension.

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

import {
  WEBUI_BRIDGE_BROWSER_SURFACES,
  type WebuiBrowserErrorCode,
  type WebuiBrowserImageFrame,
  type WebuiBrowserInputCommand,
  type WebuiBrowserTargetState,
  type WebuiBridgeBrowserSurface,
} from "../../shared/contracts/browser.js";
import type {
  WebuiBrowserBridgeImageFrame,
  WebuiBrowserBridgeTarget,
} from "../../shared/contracts/browser-bridge.js";
import {
  createPlatformSecureCredentialStore,
  type SecureCredentialStore,
} from "./credential-store.js";
import { admitBrowserBridgeUpgrade, parseExtensionOrigin } from "./admission.js";
import { BrowserBridgePairing } from "./pairing.js";
import { BrowserBridgeRegistry } from "./registry.js";
import { BrowserBridgeSession } from "./session.js";

/**
 * The frame budget the bridge listens with.
 *
 * Larger than the WebUI's own message budget on purpose: the heaviest frame
 * the bridge carries is a base64 image of a live page, and a screencast frame
 * of a 1280x800 window does not fit in 256 KiB. A frame refused for size would
 * be refused silently — it is an image, not a command the caller can see the
 * rejection of — so the budget is set where an ordinary frame fits easily.
 */
const DEFAULT_BRIDGE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/**
 * The environment variable that lists the extension ids each surface admits.
 *
 * Read as a comma-separated list. An absent, empty or whitespace-only value
 * yields an EMPTY allowlist, and an empty allowlist admits nobody.
 */
const EXTENSION_ID_ENV_BY_SURFACE = {
  edge: "MAVIS_BROWSER_EDGE_EXTENSION_IDS",
  chrome: "MAVIS_BROWSER_CHROME_EXTENSION_IDS",
} as const;

/** The provider shape the runtime's browser service consumes. */
export interface WebuiBridgeSurfaceProvider {
  readonly surface: WebuiBridgeBrowserSurface;
  readonly browserId: string;
  listTargets(): Promise<readonly WebuiBrowserTargetState[]>;
  onTargetChanged?(
    listener: (change: { readonly targetId: string; readonly generation: number }) => void,
  ): () => void;
  startImageStream(
    targetId: string,
    onFrame: (frame: WebuiBrowserImageFrame) => void,
  ): Promise<void>;
  stopImageStream(targetId: string): Promise<void>;
  sendInput(command: WebuiBrowserInputCommand): Promise<void>;
  sendCommand(command: string, params: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

/** The options the bridge server is constructed with. */
export interface BrowserBridgeServerOptions {
  /** The TCP host the HTTP server is bound to. */
  readonly host: string;
  /**
   * Whether the WebUI runs in dev mode. Carried through to
   * `admitBrowserBridgeUpgrade`, which ignores it: both composition roots run
   * with `dev: true`, and a flag that loosened extension admission would hand
   * every Browser Use call to any unpacked extension during a mis-served dev
   * cycle.
   */
  readonly dev: boolean;
  /** The OS secure credential store. Tests inject an in-memory one. */
  readonly credentialStore?: SecureCredentialStore;
  /** Maximum inbound frame size in bytes. */
  readonly maxMessageBytes?: number;
  /** The environment the extension allowlists are read from. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * A browser failure that carries the shared error code.
 *
 * `operation-dispatch.ts` reads `error.code` structurally, so this reaches the
 * wire envelope with its code intact. It is deliberately a separate class from
 * the runtime's `WebuiBrowserOperationError`: the layer matrix forbids a
 * `server/` import of the runtime implementation, and claiming to be that type
 * would be a lie about which class this is.
 */
export class WebuiBridgeOperationError extends Error {
  readonly code: WebuiBrowserErrorCode;
  readonly retryable: boolean;

  constructor(code: WebuiBrowserErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "WebuiBridgeOperationError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** What one surface's live session currently looks like. */
interface BridgeSurfaceState {
  readonly surface: WebuiBridgeBrowserSurface;
  readonly session: BrowserBridgeSession;
  /** The instance identity, from the extension's `hello` frame. */
  browserId: string;
  /** Whether the challenge/proof handshake has completed. */
  live: boolean;
  /** The most recent announcement, keyed by tab. */
  readonly targets: Map<string, WebuiBrowserBridgeTarget>;
  /** One listener set per tab being streamed. */
  readonly frameListeners: Map<string, Set<(frame: WebuiBrowserImageFrame) => void>>;
  readonly targetChangeListeners: Set<
    (change: { readonly targetId: string; readonly generation: number }) => void
  >;
}

/** The non-secret per-surface state `snapshot()` reports. */
export interface BrowserBridgeServerSurfaceStatus {
  /** Whether any extension id is configured for this surface. */
  readonly configured: boolean;
  /** Whether the pairing holds a usable credential. */
  readonly enabled: boolean;
  /** Whether an extension of this kind is connected and admitted right now. */
  readonly connected: boolean;
  /** The active credential's key id. Not a secret; safe to surface. */
  readonly keyId?: string;
  /** Why the surface could not be switched on, when it could not be. */
  readonly credentialFailure?: string;
}

/**
 * Reads one surface's extension-id allowlist out of the environment.
 *
 * A missing variable, an empty string and a list of nothing but separators all
 * produce an empty set. That is the difference between "nobody may pair" and
 * "anybody may pair", so the empty case fails closed: an operator who has not
 * configured the allowlist yet gets no browser bridge at all, which is
 * recoverable, rather than an open door onto their own browsing session, which
 * is not.
 */
export function readAllowedExtensionIds(
  surface: WebuiBridgeBrowserSurface,
  env: Readonly<Record<string, string | undefined>>,
): ReadonlySet<string> {
  const raw = env[EXTENSION_ID_ENV_BY_SURFACE[surface]];
  if (!raw) return new Set<string>();
  const ids = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set(ids);
}

export class BrowserBridgeServer {
  /** The bridge's own WebSocket server. Never the WebUI's. */
  readonly server: WebSocketServer;
  readonly pairings: ReadonlyMap<WebuiBridgeBrowserSurface, BrowserBridgePairing>;
  readonly registry: BrowserBridgeRegistry;

  readonly #host: string;
  readonly #dev: boolean;
  readonly #allowedIds = new Map<WebuiBridgeBrowserSurface, ReadonlySet<string>>();
  /** Per-surface live session state, absent when nothing is connected. */
  readonly #surfaces = new Map<WebuiBridgeBrowserSurface, BridgeSurfaceState>();
  /** Why a surface could not be switched on, when it could not be. */
  readonly #credentialFailures = new Map<WebuiBridgeBrowserSurface, string>();
  #closed = false;

  constructor(options: BrowserBridgeServerOptions) {
    this.#host = options.host;
    this.#dev = options.dev;
    const credentialStore =
      options.credentialStore ??
      createPlatformSecureCredentialStore({ serviceName: "mavis-webui-browser-bridge" });
    const env = options.env ?? process.env;
    const pairings = new Map<WebuiBridgeBrowserSurface, BrowserBridgePairing>();
    for (const surface of WEBUI_BRIDGE_BROWSER_SURFACES) {
      const allowedExtensionIds = readAllowedExtensionIds(surface, env);
      this.#allowedIds.set(surface, allowedExtensionIds);
      pairings.set(
        surface,
        new BrowserBridgePairing({
          surface,
          credentialStore,
          allowedExtensionIds,
        }),
      );
    }
    this.pairings = pairings;
    this.registry = new BrowserBridgeRegistry({ pairings });
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxMessageBytes ?? DEFAULT_BRIDGE_MAX_MESSAGE_BYTES,
    });
  }

  /**
   * Switch every surface on, minting one credential per browser.
   *
   * A surface whose credential store cannot be reached is left OFF rather than
   * failing the host's boot: the service must still serve the page and report
   * "this browser cannot pair yet" through `snapshot()`, which is recoverable.
   * Off is the fail-closed branch — an off pairing refuses to issue a
   * challenge, so no extension can prove anything it was not issued.
   */
  async start(): Promise<void> {
    for (const surface of WEBUI_BRIDGE_BROWSER_SURFACES) {
      try {
        await this.registry.enableSurface(surface);
        this.#credentialFailures.delete(surface);
      } catch (error) {
        this.#credentialFailures.set(surface, describe(error));
      }
    }
  }

  /** Per-surface state for diagnostics. Carries no credential material. */
  snapshot(): {
    readonly surfaces: Readonly<
    Record<WebuiBridgeBrowserSurface, BrowserBridgeServerSurfaceStatus>
  >;
  } {
    const surfaces = {} as Record<WebuiBridgeBrowserSurface, BrowserBridgeServerSurfaceStatus>;
    for (const surface of WEBUI_BRIDGE_BROWSER_SURFACES) {
      const pairing = this.pairings.get(surface);
      const failure = this.#credentialFailures.get(surface);
      surfaces[surface] = {
        configured: (this.#allowedIds.get(surface)?.size ?? 0) > 0,
        enabled: pairing?.enabled ?? false,
        connected: this.#surfaces.get(surface)?.live === true,
        ...(pairing?.enabled && pairing.keyId ? { keyId: pairing.keyId } : {}),
        ...(failure ? { credentialFailure: failure } : {}),
      };
    }
    return { surfaces };
  }

  /**
   * Admit and upgrade one bridge connection.
   *
   * The admission decides; this method does not second-guess it. On a refusal
   * the socket has already been written and destroyed, so the only correct
   * action is to return. On success the bridge's own `handleUpgrade` runs —
   * the WebUI's `WebSocketServer` is never handed this socket.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const rejection = admitBrowserBridgeUpgrade(request, request.url, socket, {
      pairings: this.pairings,
      host: this.#host,
      dev: this.#dev,
    });
    if (rejection) return;
    this.server.handleUpgrade(request, socket, head, (ws) => {
      this.#onConnection(ws, request);
    });
  }

  /**
   * The provider for a surface's live extension session.
   *
   * `undefined` means "no extension of that kind is connected right now". That
   * is a different fact from "that surface is not authorized" and from "that
   * extension was refused", and the two must not be conflated: the caller has
   * to be able to tell "nothing is paired" from "you may not use this surface",
   * because the two need opposite responses — one is a prompt to pair, the
   * other a refusal.
   */
  createProvider(surface: WebuiBridgeBrowserSurface): WebuiBridgeSurfaceProvider | undefined {
    const state = this.#surfaces.get(surface);
    if (!state || !state.live) return undefined;
    return new BridgeProvider(state, this.registry);
  }

  /** Release the sessions and shut the bridge's WebSocket server down. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#surfaces.clear();
    await this.registry.shutdown();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Connection lifecycle                                                    */
  /* ---------------------------------------------------------------------- */

  #onConnection(ws: WebSocket, request: IncomingMessage): void {
    const pairing = this.#pairingFor(request);
    if (!pairing) {
      // Unreachable while admission and this lookup agree; refusing beats
      // constructing a session with no pairing to authenticate against.
      ws.close(1008, "Forbidden");
      return;
    }
    const session = new BrowserBridgeSession({
      pairing,
      socket: ws,
      sessionId: `bridge-${randomUUID()}`,
    });
    const state: BridgeSurfaceState = {
      surface: pairing.surface,
      session,
      browserId: "",
      live: false,
      targets: new Map(),
      frameListeners: new Map(),
      targetChangeListeners: new Set(),
    };
    this.#surfaces.set(pairing.surface, state);
    this.#observeHello(ws, state);
    session.on("targets", (announcedBrowserId: string, targets) => {
      this.#onTargets(state, announcedBrowserId, targets);
    });
    session.on("frame", (image) => {
      this.#onFrame(state, image);
    });
    // Registration happens on `ready`, NOT on socket open. `ready` is the
    // session's signal that the challenge/proof handshake completed, so a
    // socket that never proves possession never becomes a live session and is
    // never reachable through `createProvider`.
    session.once("ready", () => {
      state.live = true;
      void this.registry.registerSession(pairing.surface, state.browserId, session).catch(() => {
        state.live = false;
      });
    });
    session.once("closed", () => {
      if (this.#surfaces.get(pairing.surface) === state) this.#surfaces.delete(pairing.surface);
    });
  }

  /**
   * The pairing an upgrade claimed.
   *
   * Mirrors the loop in `admitBrowserBridgeUpgrade`, which has already run by
   * the time this is called and does not report which pairing matched. The walk
   * is deterministic over the same allowlists, so the two agree.
   */
  #pairingFor(request: IncomingMessage): BrowserBridgePairing | undefined {
    const extensionId = parseExtensionOrigin((request.headers.origin ?? "").toLowerCase());
    if (!extensionId) return undefined;
    for (const pairing of this.pairings.values()) {
      if (pairing.admitsExtensionId(extensionId)) return pairing;
    }
    return undefined;
  }

  /**
   * Capture the instance identity from the extension's `hello` frame.
   *
   * `BrowserBridgeSession` treats `hello` as informational and does not
   * re-emit it, so the wiring code is the only place that can read the browser
   * instance identity off the wire. The listener removes itself as soon as the
   * identity is known, so it does not stay attached for the session's life.
   */
  #observeHello(ws: WebSocket, state: BridgeSurfaceState): void {
    const onMessage = (data: unknown): void => {
      let parsed: { readonly kind?: unknown; readonly browserId?: unknown };
      try {
        parsed = JSON.parse(toText(data)) as typeof parsed;
      } catch {
        // A frame that is not JSON is the session's problem to report, not this
        // observer's; it stays attached until a readable frame arrives.
        return;
      }
      if (parsed.kind !== "hello") return;
      if (typeof parsed.browserId === "string" && parsed.browserId.length > 0) {
        state.browserId = parsed.browserId;
      }
      ws.off("message", onMessage);
    };
    ws.on("message", onMessage);
  }

  #onTargets(
    state: BridgeSurfaceState,
    announcedBrowserId: string,
    targets: readonly WebuiBrowserBridgeTarget[],
  ): void {
    if (state.browserId.length === 0 && announcedBrowserId.length > 0) {
      state.browserId = announcedBrowserId;
    }
    for (const target of targets) {
      const previous = state.targets.get(target.targetId);
      // A lower generation is a late duplicate of an announcement the extension
      // has already moved past; letting it through would roll the target back
      // to a page that no longer exists.
      if (previous && previous.generation > target.generation) continue;
      state.targets.set(target.targetId, target);
      if (previous && previous.generation < target.generation) {
        for (const listener of [...state.targetChangeListeners]) {
          listener({ targetId: target.targetId, generation: target.generation });
        }
      }
    }
  }

  #onFrame(state: BridgeSurfaceState, image: WebuiBrowserBridgeImageFrame): void {
    const listeners = state.frameListeners.get(image.targetId);
    if (!listeners || listeners.size === 0) return;
    const frame: WebuiBrowserImageFrame = {
      target: {
        surface: state.surface,
        browserId: state.browserId || image.browserId,
        targetId: image.targetId,
        // The announcement is the host's own record of which page this tab is
        // on, so it wins over the generation the frame carries. A frame for a
        // tab that has not been announced yet falls back to the frame's own
        // generation, which is still better than reporting the unset value.
        generation: state.targets.get(image.targetId)?.generation ?? image.generation,
      },
      data: image.data,
      format: image.format,
      sequence: image.sequence,
    };
    for (const listener of [...listeners]) listener(frame);
  }
}

/**
 * The provider handed to the runtime's browser service.
 *
 * One thin object per surface, bound to the session that was live when it was
 * borrowed. The browser service deliberately does not cache the provider for a
 * bridged surface — the extension's worker can be terminated and restarted —
 * so a provider always describes the session that was live at the moment it
 * was asked for.
 */
class BridgeProvider implements WebuiBridgeSurfaceProvider {
  readonly surface: WebuiBridgeBrowserSurface;

  readonly #state: BridgeSurfaceState;
  readonly #registry: BrowserBridgeRegistry;
  /** The callback this provider installed per streamed target. */
  readonly #streamed = new Map<string, (frame: WebuiBrowserImageFrame) => void>();

  constructor(state: BridgeSurfaceState, registry: BrowserBridgeRegistry) {
    this.#state = state;
    this.#registry = registry;
    this.surface = state.surface;
  }

  /**
   * A getter, not a field: the instance identity only becomes known when the
   * extension's `hello` frame arrives, which can be after the provider was
   * borrowed.
   */
  get browserId(): string {
    return this.#state.browserId;
  }

  async listTargets(): Promise<readonly WebuiBrowserTargetState[]> {
    const states: WebuiBrowserTargetState[] = [];
    for (const target of this.#state.targets.values()) {
      states.push({
        id: {
          surface: this.surface,
          browserId: target.browserId || this.#state.browserId,
          targetId: target.targetId,
          generation: target.generation,
        },
        title: target.title,
        url: target.url,
        status: "open",
        // Selection is the browser service's state, not the bridge's: the panel
        // decides which tab it is showing and overwrites this.
        selected: false,
      });
    }
    return states;
  }

  onTargetChanged(
    listener: (change: { readonly targetId: string; readonly generation: number }) => void,
  ): () => void {
    this.#state.targetChangeListeners.add(listener);
    return () => {
      this.#state.targetChangeListeners.delete(listener);
    };
  }

  async startImageStream(
    targetId: string,
    onFrame: (frame: WebuiBrowserImageFrame) => void,
  ): Promise<void> {
    if (!this.#state.targets.has(targetId)) {
      throw new WebuiBridgeOperationError(
        "browser_target_unknown",
        `The ${this.surface} extension announced no such target.`,
      );
    }
    const listeners = this.#state.frameListeners.get(targetId) ?? new Set();
    listeners.add(onFrame);
    this.#state.frameListeners.set(targetId, listeners);
    this.#streamed.set(targetId, onFrame);
  }

  async stopImageStream(targetId: string): Promise<void> {
    const onFrame = this.#streamed.get(targetId);
    if (onFrame) {
      this.#state.frameListeners.get(targetId)?.delete(onFrame);
      this.#streamed.delete(targetId);
    }
    if (this.#state.frameListeners.get(targetId)?.size === 0) {
      this.#state.frameListeners.delete(targetId);
    }
  }

  /**
   * Deliver one validated input command.
   *
   * The routing is NOT re-implemented here: the registry owns which session
   * owns which tab and serializes commands per tab, and it refuses an unknown
   * or stale target rather than guessing. So the dispatch runs FIRST and the
   * registry's own refusal wording is what the caller reads.
   *
   * What this adds is the translation into the shared error code. The code is
   * chosen from facts this provider can already read — the announcement it
   * holds, the generation in it, and the surface the command names — rather
   * than by pattern-matching the registry's messages, which would make this
   * provider break the day a refusal is reworded.
   */
  async sendInput(command: WebuiBrowserInputCommand): Promise<void> {
    const outcome = await this.#registry.dispatch(command);
    if (outcome.kind === "accepted") return;
    if (outcome.kind === "timeout") {
      throw new WebuiBridgeOperationError("browser_operation_timeout", outcome.reason, true);
    }
    throw new WebuiBridgeOperationError(this.#codeForRefused(command), outcome.reason);
  }

  /**
   * The code that matches a registry refusal, read off the facts rather than
   * off the registry's wording.
   */
  #codeForRefused(command: WebuiBrowserInputCommand): WebuiBrowserErrorCode {
    if (command.target.surface !== this.surface) {
      return "browser_command_invalid";
    }
    const announced = this.#state.targets.get(command.target.targetId);
    if (!announced || announced.browserId !== command.target.browserId) {
      return "browser_target_unknown";
    }
    if (announced.generation !== command.target.generation) {
      return "browser_target_stale";
    }
    // The command matches what this surface announced, so the only remaining
    // explanation is that the session which owned the tab is no longer the one
    // registered for it.
    return "browser_target_stale";
  }

  /**
   * Refuse every command.
   *
   * The person's own browser is driven through `chrome.debugger`, which exposes
   * a documented subset of the DevTools domains — not the protocol itself. A
   * provider that forwarded an arbitrary method would either fail opaquely at
   * the extension or, worse, appear to succeed. Refusing explicitly is the
   * only honest answer: the raw DevTools capability belongs to the isolated
   * Chromium this process launches and owns.
   */
  async sendCommand(command: string, _params: Record<string, unknown>): Promise<void> {
    throw new WebuiBridgeOperationError(
      "browser_capability_denied",
      `The ${this.surface} surface does not accept raw DevTools commands ("${command}"); ` +
        "it is driven through the extension's restricted debugger subset.",
    );
  }

  /**
   * A no-op.
   *
   * The bridge owns the session's lifetime, not the provider's. A provider is
   * borrowed for one operation and handed back; tearing down the extension's
   * socket because a caller finished with it would drop a live browser session
   * the panel may still be watching.
   */
  async close(): Promise<void> {}
}

/**
 * Decode an inbound `ws` payload to text.
 *
 * The bridge's own observer needs only the frame's `kind` and `browserId`, and
 * never retains or logs the payload.
 */
function toText(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf8");
  return "";
}

/** Reduce a failure to one safe line. Never includes credential material. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? "unknown error" : String(error);
}