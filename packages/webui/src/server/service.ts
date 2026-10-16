// WebUI service: owns a runtime host, binds loopback, runs the wire
// envelope with access control, and shuts down in order.
//
// This is the server seam. It composes:
//   * a harness port (real: script of the host's `CliService` facade;
//     test: scripted stand-in),
//   * a per-start credential,
//   * the operation registry the host assembled from that port,
//   * the access control rules described in ADR 0004.
//
// The network lifecycle now lives in dedicated modules:
// `http-server.ts` (listener lifecycle), `websocket-server.ts` (upgrade, socket
// set, heartbeat, connection close), `frame-handler.ts` (inbound frame parsing
// and dispatch), `access-policy.ts` (host/origin/upgrade admission) and the
// `http/` route modules. This file keeps the HTTP/WS assembly plus start/close;
// it holds no OAuth, broker or browser provider.
//
// Shutdown order is the close order `../docs/runtime/boot.md` states: stop accepting
// new operations, then close every connection, then close the harness.

import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type { WebuiOperationRegistryEntry } from "./operation/operations.js";
import {
  createWebuiCredential,
  type WebuiCredential,
} from "./credentials.js";
import { WEBUI_PROTOCOL_VERSION } from "../shared/envelope.js";
import type { WebuiHarnessPort } from "../runtime/port.js";
import type { WebuiTerminalProcessPort } from "../runtime/port.js";
import { isLoopbackBindAddress } from "./access-policy.js";
import {
  createHttpListener,
  listenHttpServer,
  closeHttpListener,
} from "./http-server.js";
import { WebuiWebSocketServer } from "./websocket-server.js";
import { serveHttpRequest, type WebuiHttpRouterContext } from "./http/router.js";

export const WEBUI_MAX_MESSAGE_BYTES = 256 * 1024;
export const WEBUI_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Truthy env-var spellings that turn the development mode on. Anything that
 * is not on this list is ignored, so `WEBUI_DEV=0` / `WEBUI_DEV=false` /
 * unset all leave production semantics intact.
 */
function readEnvFlag(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const trimmed = raw.trim().toLowerCase();
  return (
    trimmed === "1" ||
    trimmed === "true" ||
    trimmed === "yes" ||
    trimmed === "on"
  );
}

export interface WebuiServiceOptions {
  readonly port: WebuiHarnessPort;
  /**
   * The complete, preassembled operation registry. The host builds it from its
   * own port (`createOperationRegistry(port, terminalPort)`), so the network
   * service binds what it was handed instead of projecting the harness port
   * member by member. The registry is exhaustive by construction: an operation
   * missing from it fails the inbound lookup, which is the same error a
   * cold-started runtime produces.
   */
  readonly operations: ReadonlyMap<string, WebuiOperationRegistryEntry>;
  /**
   * The terminal-process port the registry's terminal operations were built
   * with. The service owns its lifecycle and disposes it on close.
   */
  readonly terminal?: WebuiTerminalProcessPort;
  /**
   * Loopback host the service binds to. The service refuses to start
   * when this is anything other than `127.0.0.1`, `localhost`, `::1` or
   * `[::1]`; remote or LAN access requires a separate decision (ADR
   * 0004), not a different bind address. Defaults to `127.0.0.1`.
   */
  readonly host?: string;
  /** TCP port; `0` asks the OS for a free port. Defaults to `0`. */
  readonly tcpPort?: number;
  /** Maximum WebSocket message size in bytes. */
  readonly maxMessageBytes?: number;
  /** Override the liveness sweep interval; tests use a short interval. */
  readonly webSocketHeartbeatIntervalMs?: number;
  /** Optional credential override; tests supply one to assert its shape. */
  readonly credential?: WebuiCredential;
  /** Optional server factory; tests inject an HTTP server without listening. */
  readonly httpServerFactory?: () => Server;
  /**
   * Development mode: when `true`, the HTTP and WebSocket paths do not
   * require a credential so a developer can open the served page in a
   * plain browser without scraping a per-start token out of the log.
   * Host and Origin discipline stay intact (ADR 0004). Default mode keeps
   * today's per-start credential requirement.
   *
   * The env var `WEBUI_DEV=1` (also accepts `true`/`yes`/`on`) turns it
   * on for the lifecycle of the process — there is no path that flips
   * it back to off without restarting the service, so a misconfigured
   * environment cannot be widened by accident. The option wins over the
   * env var so tests can pin the boot mode without touching the
   * environment.
   */
  readonly dev?: boolean;
  /**
   * Override the directory the service reads `index.html`, `client.js`
   * and `styles.css` from. Tests inject the built-artifact path
   * (`dist-webui/client`) so they can assert the assets the served page
   * references load without inventing tokens; the dev preview launcher
   * uses it to point at the same path. When unset the service picks the
   * first existing candidate under `findClientDirectory()`.
   */
  readonly clientDir?: string;
}

export interface WebuiServiceInfo {
  readonly host: string;
  readonly tcpPort: number;
  readonly protocolVersion: typeof WEBUI_PROTOCOL_VERSION;
  readonly credential: WebuiCredential;
  readonly boundUrl: string;
}

export class WebuiService {
  private readonly port: WebuiHarnessPort;
  private readonly host: string;
  private readonly tcpPort: number;
  private readonly maxMessageBytes: number;
  private readonly webSocketHeartbeatIntervalMs: number;
  private readonly credential: WebuiCredential;
  private readonly dev: boolean;
  private readonly clientDirOverride: string | undefined;
  private readonly operations: ReadonlyMap<string, WebuiOperationRegistryEntry>;
  private readonly httpServer: Server;
  private readonly wsServer: WebuiWebSocketServer;
  private readonly terminal: WebuiTerminalProcessPort | undefined;
  private readonly httpContext: WebuiHttpRouterContext;
  private accepting = true;
  private startedPromise: Promise<WebuiServiceInfo> | undefined;
  private bound: { info: WebuiServiceInfo } | undefined;

  constructor(options: WebuiServiceOptions) {
    this.port = options.port;
    this.host = options.host ?? "127.0.0.1";
    if (!isLoopbackBindAddress(this.host))
      throw new Error(
        `WebUI service may only bind to a loopback address; received ${JSON.stringify(this.host)}`,
      );
    this.tcpPort = options.tcpPort ?? 0;
    this.maxMessageBytes = options.maxMessageBytes ?? WEBUI_MAX_MESSAGE_BYTES;
    this.webSocketHeartbeatIntervalMs =
      options.webSocketHeartbeatIntervalMs ?? WEBUI_WEBSOCKET_HEARTBEAT_INTERVAL_MS;
    this.credential = options.credential ?? createWebuiCredential();
    // The option is the source of truth for tests; the env var is the
    // convenience for the dev preview launcher. The option must win
    // when both are set so a test that pins `dev: false` cannot be
    // widened by a stray `WEBUI_DEV=1` in the environment.
    this.dev = options.dev ?? readEnvFlag("WEBUI_DEV");
    this.clientDirOverride = options.clientDir;
    this.operations = options.operations;
    this.terminal = options.terminal;
    this.httpServer = createHttpListener(options.httpServerFactory);
    this.wsServer = new WebuiWebSocketServer({
      maxMessageBytes: this.maxMessageBytes,
      heartbeatIntervalMs: this.webSocketHeartbeatIntervalMs,
      host: this.host,
      boundTcpPort: () => this.bound?.info.tcpPort,
      credential: this.credential,
      dev: this.dev,
      operations: this.operations,
      isAccepting: () => this.accepting,
    });
    this.httpContext = {
      host: this.host,
      boundTcpPort: () => this.bound?.info.tcpPort,
      configuredTcpPort: this.tcpPort,
      credential: this.credential,
      dev: this.dev,
      clientDir: this.clientDirOverride,
      port: this.port,
    };
    this.httpServer.on("upgrade", this.wsServer.handleUpgrade);
    this.httpServer.on("request", this.#onRequest);
  }

  #onRequest = (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    void serveHttpRequest(request, response, this.httpContext);
  };

  /**
   * Bind the server and resolve once it is listening. Resolves with the
   * address the kernel actually allocated so tests can reach it.
   */
  start(): Promise<WebuiServiceInfo> {
    if (this.startedPromise) return this.startedPromise;
    this.startedPromise = new Promise<WebuiServiceInfo>((resolve, reject) => {
      listenHttpServer(this.httpServer, this.tcpPort, this.host).then(
        (tcpPort) => {
          const info: WebuiServiceInfo = {
            host: this.host,
            tcpPort,
            protocolVersion: WEBUI_PROTOCOL_VERSION,
            credential: this.credential,
            boundUrl: `ws://${this.host}:${tcpPort}`,
          };
          this.bound = { info };
          resolve(info);
        },
        reject,
      );
    });
    return this.startedPromise;
  }

  info(): WebuiServiceInfo {
    if (!this.bound) throw new Error("WebUI service is not started");
    return this.bound.info;
  }

  /**
   * Stop accepting new operations, drain every connection, then close
   * the harness port. The order matters: refuse new work first, then
   * release resources, then tear down the host.
   */
  async close(): Promise<void> {
    this.terminal?.disposeBySession();
    if (!this.accepting && !this.bound) return;
    this.accepting = false;
    // Force-terminate every connection before the server closes; otherwise
    // `wsServer.close()` waits for the client to ack the close handshake
    // and can hang for the duration of the platform TCP timeout.
    this.wsServer.closeConnections();
    await this.wsServer.close();
    await closeHttpListener(this.httpServer);
    await this.port.close();
  }
}
