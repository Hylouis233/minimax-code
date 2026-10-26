import http from 'node:http';
import { createServer as createNetServer, connect as connectNet } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MINIAPP_LOOPBACK_HEALTH_PATH,
  MINIAPP_LOOPBACK_TOKEN_HEADER,
} from '../../../src/service/miniapp/contracts.js';
import {
  isMiniAppRunnerInitMessage,
  startMiniAppModule,
  type MiniAppRunnerInitMessage,
  type RunningMiniAppModule,
} from '../../../src/service/miniapp/process/node-runtime/host-runner.js';

/**
 * The guard patches `http.Server.prototype.emit` process-wide and has no uninstall, which is
 * exactly how it behaves inside a Mini App process: one credential, one port, every server in
 * that process. So this file installs one guarded plugin server and interrogates it, rather than
 * starting a fresh one per case.
 */
const TOKEN = 'test-loopback-credential-0123456789';

interface ObservedRequest {
  readonly headers: http.IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly url: string;
}

const observed: ObservedRequest[] = [];
let server: RunningMiniAppModule | undefined;
let port = 0;
let packageRoot = '';

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const allocated = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return allocated;
}

function initMessage(): MiniAppRunnerInitMessage {
  return {
    type: 'miniapp:init',
    protocolVersion: 1,
    pluginId: 'fixture.miniapp',
    processGeneration: 'generation-1',
    packageRoot,
    nodeEntry: 'miniapp/node/server.js',
    dataDir: packageRoot,
    listen: { host: '127.0.0.1', port },
    readiness: { startupToken: 'startup-token', nodeDigest: 'node-digest' },
    loopbackToken: TOKEN,
    hostConnectorPolicy: { kind: 'deny-all' },
  };
}

beforeAll(async () => {
  packageRoot = await mkdtemp(join(tmpdir(), 'miniapp guard '));
  // The runner resolves the declared entry for real before the injected loader runs.
  const entry = join(packageRoot, 'miniapp', 'node', 'server.js');
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, 'export const start = async () => undefined;\n');
  port = await freePort();
  server = await startMiniAppModule(initMessage(), {
    loadModule: async () => ({
      start: async (context: { readonly listen: { host: string; port: number } }) => {
        const pluginServer = http.createServer((request, response) => {
          observed.push({
            headers: { ...request.headers },
            rawHeaders: [...request.rawHeaders],
            url: request.url ?? '',
          });
          response.writeHead(200, { 'content-type': 'text/plain' }).end('plugin');
        });
        const upgraded = new Set<import('node:net').Socket>();
        pluginServer.on('upgrade', (request, socket) => {
          upgraded.add(socket);
          socket.once('close', () => upgraded.delete(socket));
          observed.push({
            headers: { ...request.headers },
            rawHeaders: [...request.rawHeaders],
            url: request.url ?? '',
          });
          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
          );
        });
        await new Promise<void>((resolve, reject) => {
          pluginServer.once('error', reject);
          pluginServer.listen(context.listen.port, context.listen.host, resolve);
        });
        return {
          async dispose() {
            // An upgraded socket leaves the server's own tracking; the fixture ends it here.
            for (const socket of upgraded) socket.destroy();
            pluginServer.closeAllConnections();
            await new Promise<void>((resolve) => pluginServer.close(() => resolve()));
          },
        };
      },
    }),
  });
});

afterAll(async () => {
  await server?.stop();
  await rm(packageRoot, { recursive: true, force: true });
});

interface Response {
  readonly status: number;
  readonly body: string;
}

function request(input: {
  readonly path: string;
  readonly token?: string;
  readonly host?: string;
}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: input.path,
        // A kept-alive socket would hold the fixture server open past the last assertion.
        agent: false,
        headers: {
          ...(input.token === undefined ? {} : { [MINIAPP_LOOPBACK_TOKEN_HEADER]: input.token }),
          ...(input.host === undefined ? {} : { host: input.host }),
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** Resolves with the first bytes the server sends, or 'closed' when the socket is destroyed. */
function upgradeOutcome(token?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectNet({ host: '127.0.0.1', port });
    let received = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(received === '' ? 'closed' : received);
    };
    socket.once('connect', () => {
      const extra = token === undefined ? '' : `${MINIAPP_LOOPBACK_TOKEN_HEADER}: ${token}\r\n`;
      socket.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${extra}\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      finish();
    });
    socket.once('error', finish);
    socket.once('end', finish);
    socket.once('close', finish);
    socket.setTimeout(2_000, () => {
      socket.destroy();
      reject(new Error('upgrade outcome timed out'));
    });
  });
}

describe('Mini App loopback guard', () => {
  it('answers an unauthenticated request with 401 and no body', async () => {
    const response = await request({ path: '/' });

    expect(response.status).toBe(401);
    expect(response.body).toBe('');
  });

  it('answers a request carrying the wrong credential with 401', async () => {
    const response = await request({ path: '/', token: 'not-the-credential' });

    expect(response.status).toBe(401);
    expect(response.body).toBe('');
  });

  it('rejects the right credential on the wrong host', async () => {
    const response = await request({ path: '/', token: TOKEN, host: `localhost:${port}` });

    expect(response.status).toBe(401);
  });

  it('reaches the plugin handler with the right credential and hides the header from it', async () => {
    observed.length = 0;
    const response = await request({ path: '/dashboard', token: TOKEN });

    expect(response.status).toBe(200);
    expect(response.body).toBe('plugin');
    expect(observed).toHaveLength(1);
    expect(observed[0]?.url).toBe('/dashboard');
    expect(observed[0]?.headers).not.toHaveProperty(MINIAPP_LOOPBACK_TOKEN_HEADER);
    expect(
      observed[0]?.rawHeaders.some(
        (value) => value.toLowerCase() === MINIAPP_LOOPBACK_TOKEN_HEADER,
      ),
    ).toBe(false);
  });

  it('answers the reserved health path itself, before the plugin handler', async () => {
    observed.length = 0;
    const authenticated = await request({ path: MINIAPP_LOOPBACK_HEALTH_PATH, token: TOKEN });

    expect(authenticated.status).toBe(204);
    expect(observed).toHaveLength(0);

    const anonymous = await request({ path: MINIAPP_LOOPBACK_HEALTH_PATH });
    expect(anonymous.status).toBe(401);
    expect(observed).toHaveLength(0);
  });

  it('destroys an upgrade without the credential and forwards one that carries it', async () => {
    observed.length = 0;
    expect(await upgradeOutcome()).toBe('closed');
    expect(observed).toHaveLength(0);

    const forwarded = await upgradeOutcome(TOKEN);
    expect(forwarded).toContain('101');
    expect(observed).toHaveLength(1);
    expect(observed[0]?.headers).not.toHaveProperty(MINIAPP_LOOPBACK_TOKEN_HEADER);
  });
});

describe('runner init message', () => {
  it('requires a non-empty loopback credential', () => {
    expect(isMiniAppRunnerInitMessage(initMessage())).toBe(true);

    const withoutToken: Record<string, unknown> = { ...initMessage() };
    delete withoutToken.loopbackToken;
    expect(isMiniAppRunnerInitMessage(withoutToken)).toBe(false);
    expect(isMiniAppRunnerInitMessage({ ...initMessage(), loopbackToken: '' })).toBe(false);
    expect(isMiniAppRunnerInitMessage({ ...initMessage(), loopbackToken: 42 })).toBe(false);
    expect(isMiniAppRunnerInitMessage({ ...initMessage(), loopbackToken: ['token'] })).toBe(false);
  });
});
