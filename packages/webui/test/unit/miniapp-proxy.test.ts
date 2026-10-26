import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deriveMiniAppProxyPort,
  startMiniAppProxy,
  type MiniAppProxy,
} from '../../src/server/miniapp/proxy.js';

const CREDENTIAL = 'upstream-credential-0123456789';
const CREDENTIAL_HEADER = 'x-mavis-miniapp-token';

interface Seen {
  readonly method?: string;
  readonly url?: string;
  readonly headers: http.IncomingHttpHeaders;
}

const seen: Seen[] = [];
const upgraded = new Set<Duplex>();
let upstream: http.Server;
let upstreamPort = 0;
let proxy: MiniAppProxy;

beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: { ...request.headers } });
    if (request.url === '/echo') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('from-upstream');
      return;
    }
    response.writeHead(404).end();
  });
  upstream.on('upgrade', (request, socket) => {
    upgraded.add(socket);
    socket.once('close', () => upgraded.delete(socket));
    seen.push({ method: request.method, url: request.url, headers: { ...request.headers } });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  upstreamPort = typeof address === 'object' && address ? address.port : 0;

  proxy = await startMiniAppProxy({
    target: {
      pluginId: 'fixture.miniapp',
      upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
      credential: CREDENTIAL,
      credentialHeader: CREDENTIAL_HEADER,
    },
    port: 0,
  });
});

afterAll(async () => {
  await proxy?.close();
  // An upgraded socket leaves the server's own tracking, so the fixture ends it explicitly.
  for (const socket of upgraded) socket.destroy();
  upgraded.clear();
  upstream?.closeAllConnections();
  await new Promise<void>((resolve) => upstream?.close(() => resolve()));
});

interface Result {
  readonly status: number;
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
}

function get(port: number, path: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method: 'GET', path, agent: false },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body, headers: response.headers }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

describe('Mini App proxy', () => {
  it('forwards the path unchanged and returns the upstream response', async () => {
    const result = await get(proxy.port, '/echo');

    expect(result.status).toBe(200);
    expect(result.body).toBe('from-upstream');
    expect(seen.at(-1)?.url).toBe('/echo');
    expect(seen.at(-1)?.method).toBe('GET');
  });

  it('injects the credential outbound and never returns it to the caller', async () => {
    const result = await get(proxy.port, '/echo');

    expect(seen.at(-1)?.headers[CREDENTIAL_HEADER]).toBe(CREDENTIAL);
    expect(result.headers).not.toHaveProperty(CREDENTIAL_HEADER);
  });

  it('forwards an upgrade with the credential', async () => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: proxy.port });
      let received = '';
      socket.once('connect', () => {
        socket.write(
          `GET /socket HTTP/1.1\r\nHost: 127.0.0.1:${proxy.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        );
      });
      socket.on('data', (chunk) => {
        received += chunk.toString('utf8');
        socket.destroy();
        resolve(received);
      });
      socket.once('error', reject);
      socket.setTimeout(2_000, () => {
        socket.destroy();
        reject(new Error('upgrade timed out'));
      });
    });

    expect(response).toContain('101');
    expect(seen.at(-1)?.url).toBe('/socket');
    expect(seen.at(-1)?.headers[CREDENTIAL_HEADER]).toBe(CREDENTIAL);
  });

  it('derives a stable loopback port per plugin', () => {
    const first = deriveMiniAppProxyPort('fixture.miniapp');

    expect(first).toBe(deriveMiniAppProxyPort('fixture.miniapp'));
    expect(first).toBeGreaterThanOrEqual(49_152);
    expect(first).toBeLessThanOrEqual(65_535);
    expect(deriveMiniAppProxyPort('another.miniapp')).not.toBe(first);
  });
});
