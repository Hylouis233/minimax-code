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

/**
 * The page bridge the proxy injects into the Mini App's document.
 *
 * The proxy owns the seam — which document, where the tag goes, what headers survive — while the script
 * itself belongs to the bridge, which knows what `window.mcode.miniapp` exposes.
 */
export interface MiniAppPageBridge {
  /** Absolute path on the proxy origin that serves the script, e.g. `/__miniapp/bridge.js`. */
  readonly path: string;
  readonly script: string;
}

export interface StartMiniAppProxyInput {
  readonly target: MiniAppProxyTarget;
  /** Defaults to the derived port; a test or a retry may pass the next candidate. */
  readonly port?: number;
  readonly bridge?: MiniAppPageBridge;
}

const FRAME_BLOCKING_HEADERS = ['x-frame-options'] as const;
const CSP_HEADER = 'content-security-policy';

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
    if (input.bridge && request.url === input.bridge.path) {
      response
        .writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        .end(input.bridge.script);
      return;
    }
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
        const headers = frameableHeaders(upstreamResponse.headers);
        if (!isHtml(upstreamResponse.headers) || !input.bridge) {
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          upstreamResponse.pipe(response);
          return;
        }
        // The document is the one response this proxy rewrites: the page bridge has to be in it before
        // the page's own scripts run, and a page cannot be allowed to decide it will not be framed.
        const chunks: Buffer[] = [];
        upstreamResponse.on('data', (chunk: Buffer) => chunks.push(chunk));
        upstreamResponse.on('end', () => {
          const body = Buffer.from(
            injectBridge(Buffer.concat(chunks).toString('utf8'), input.bridge as MiniAppPageBridge),
            'utf8',
          );
          // The body length changed, so the upstream framing no longer applies.
          delete headers['transfer-encoding'];
          headers['content-length'] = String(body.byteLength);
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          response.end(body);
        });
        upstreamResponse.on('error', () => response.destroy());
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

function isHtml(headers: http.IncomingHttpHeaders): boolean {
  const contentType = headers['content-type'];
  return typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');
}

/**
 * The page is framed by the WebUI client, on a different origin, so a page that asks not to be framed
 * must not be able to refuse: `X-Frame-Options` is dropped and a `frame-ancestors` directive is removed
 * from the page's own CSP. Everything else the page declares is left alone — the Mini App's origin is a
 * separate origin from the client's, so its CSP governs a document that cannot reach the client anyway.
 */
function frameableHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (FRAME_BLOCKING_HEADERS.includes(name.toLowerCase() as 'x-frame-options')) continue;
    if (name.toLowerCase() === CSP_HEADER && typeof value === 'string') {
      const directives = value
        .split(';')
        .map((directive) => directive.trim())
        .filter((directive) => directive.length > 0 && !directive.toLowerCase().startsWith('frame-ancestors'));
      result[name] = directives.join('; ');
      continue;
    }
    result[name] = value;
  }
  return result;
}

function injectBridge(document: string, bridge: MiniAppPageBridge): string {
  const tag = `<script src="${bridge.path}"></script>`;
  const headEnd = document.search(/<\/head\s*>/iu);
  if (headEnd >= 0) return `${document.slice(0, headEnd)}${tag}${document.slice(headEnd)}`;
  const bodyStart = document.search(/<body[^>]*>/iu);
  if (bodyStart >= 0) {
    const insertAt = document.indexOf('>', bodyStart) + 1;
    return `${document.slice(0, insertAt)}${tag}${document.slice(insertAt)}`;
  }
  return `${tag}${document}`;
}
