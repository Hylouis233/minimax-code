import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

/**
 * The Mini App's real origin and the credential its own guard demands.
 *
 * Server-only by construction: it arrives from the runtime port capability and never travels further
 * than this module. The client is given `viewUrl`, which points at this proxy instead.
 */
export interface MiniAppProxyTarget {
  readonly pluginId: string;
  readonly upstreamOrigin: string;
  readonly credential: string;
  /** Request header the upstream guard reads the credential from. */
  readonly credentialHeader: string;
}

export interface MiniAppProxy {
  /** What the client frames. Never the Mini App's own origin. */
  readonly viewUrl: string;
  readonly port: number;
  close(): Promise<void>;
}

const PROXY_PORT_MIN = 49_152;
const PROXY_PORT_MAX = 65_535;
const PROXY_PORT_RANGE = PROXY_PORT_MAX - PROXY_PORT_MIN + 1;

/**
 * A Mini App's proxy port is stable per plugin, for the same reason the runtime's own is: the page's
 * `localStorage` and `IndexedDB` are keyed by its origin, so a port that moved between runs would
 * silently discard the page's own state.
 */
export function deriveMiniAppProxyPort(pluginId: string): number {
  const digest = createHash('sha256').update(`miniapp-proxy:${pluginId}`).digest();
  return PROXY_PORT_MIN + (digest.readUInt32BE(0) % PROXY_PORT_RANGE);
}

export interface StartMiniAppProxyInput {
  readonly target: MiniAppProxyTarget;
  /** Defaults to the derived port; a test or a retry may pass the next candidate. */
  readonly port?: number;
}

/**
 * One loopback listener per running Mini App.
 *
 * A page refers to its own origin by absolute path (`/dashboard`, `/api/...`, its assets), so the proxy
 * forwards paths unchanged rather than rewriting them behind a prefix: patching them back would mean
 * intercepting every `fetch`, `XMLHttpRequest` and absolute URL in the document. The credential is
 * injected on the way out and never reaches a response, and WebSocket upgrades are forwarded under the
 * same rules.
 */
export async function startMiniAppProxy(input: StartMiniAppProxyInput): Promise<MiniAppProxy> {
  const upstream = new URL(input.target.upstreamOrigin);
  if (upstream.protocol !== 'http:') {
    throw new TypeError('A Mini App proxy forwards to an http origin on loopback');
  }
  const port = input.port ?? deriveMiniAppProxyPort(input.target.pluginId);
  // Anything this listener owns that can be torn down: inbound sockets, forwarded requests, upgrade pairs.
  const sockets = new Set<{ destroy(): void }>();

  const server = http.createServer((request, response) => {
    const forwarded = http.request(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          [input.target.credentialHeader]: input.target.credential,
        },
        agent: false,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    forwarded.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain' });
      }
      response.end();
    });
    request.pipe(forwarded);
    sockets.add(forwarded);
    forwarded.once('close', () => sockets.delete(forwarded));
  });

  // Every socket this listener owns, so closing it cannot wait on a client that never said goodbye.
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('upgrade', (request, clientSocket, head) => {
    const upstreamSocket = net.connect(
      { host: upstream.hostname, port: Number(upstream.port || 80) },
      () => {
        const headers = Object.entries(request.headers)
          .filter(([name, value]) => value !== undefined)
          .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
        headers.push(`${input.target.credentialHeader}: ${input.target.credential}`);
        upstreamSocket.write(
          `${request.method} ${request.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`,
        );
        if (head.length > 0) upstreamSocket.write(head);
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      },
    );
    sockets.add(clientSocket);
    sockets.add(upstreamSocket);
    // A half-closed pair would leak the other end and keep the upstream server open forever.
    const teardown = () => {
      clientSocket.destroy();
      upstreamSocket.destroy();
      sockets.delete(clientSocket);
      sockets.delete(upstreamSocket);
    };
    clientSocket.once('close', teardown);
    upstreamSocket.once('close', teardown);
    upstreamSocket.once('error', teardown);
    clientSocket.once('error', teardown);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: boundPort,
    viewUrl: `http://127.0.0.1:${boundPort}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
