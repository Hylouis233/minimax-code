// The real-host loopback path: the production WebUI chain, end to end, in one
// process and against a real runtime host in an isolated data directory.
//
// `loopback-harness-path.test.ts` proves the network entrance, the registry, the
// dispatcher, the envelope and shutdown — but with a scripted stand-in behind the
// port, so it cannot say whether the real host answers. This file closes that
// half for everything that does not need a model: it boots the production
// assembly (`createWebuiRuntimeHost`, whose default factory is the real
// `createLocalRuntimeHostV2`), derives the port with the real
// `createHarnessPortFromHost`, registers the real operation registry, starts a
// real `WebuiService` on a real loopback socket, and drives it with a real `ws`
// client. No service, adapter, host or result in this path is replaced.
//
// What this file does NOT establish, and must not be read as establishing: a
// model turn. A fresh data directory carries no provider credential, and driving
// a turn to a repeatable model response needs a controlled model transport,
// which is the next slice. The boundary is stated here rather than implied by a
// green run.
//
// The data directory is a temporary one. The `version` assertion pins that the
// isolated path reached the host, so a run can never fall back to the operator's
// own `~/.minimax` without failing.
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RawData } from "ws";

import { createWebuiRuntimeHost } from "../../src/runtime/assembly.js";
import { createHarnessPortFromHost } from "../../src/runtime/harness/adapter.js";
import { WebuiTerminalManager } from "../../src/runtime/index.js";
import { WebuiService, createOperationRegistry } from "../../src/server/index.js";
import { WEBUI_PROTOCOL_VERSION } from "../../src/shared/envelope.js";

const CREDENTIAL_TOKEN = "real-host-loopback-token";

interface Booted {
  readonly service: WebuiService;
  readonly url: string;
  readonly tcpPort: number;
  readonly dataDir: string;
  readonly workspaceDir: string;
  close(): Promise<void>;
}

const booted: Booted[] = [];

afterEach(async () => {
  for (const entry of booted.splice(0)) await entry.close();
});

/**
 * The production wiring of `scripts/run-webui-server.mjs`, with two deliberate
 * differences: the data directory is temporary, and `mcodeTools.prepare` is
 * stubbed — mcode-tools is a side capability the harness acquires alongside the
 * host, not part of the request path under test, and leaving it real would try
 * to install and launch a broker.
 */
async function bootRealHost(): Promise<Booted> {
  const dataDir = await mkdtemp(join(tmpdir(), "webui-real-host-"));
  const workspaceDir = join(dataDir, "workspace");
  await mkdir(workspaceDir, { recursive: true });

  const assembled = await createWebuiRuntimeHost({
    dataDir,
    appVersion: "real-host-loopback",
    mcodeTools: {
      prepare: async () => ({
        ready: false,
        dispose: async () => undefined,
        ensureCommandPath: () => undefined,
      }),
    },
  });
  const port = createHarnessPortFromHost(assembled.host);
  const terminal = new WebuiTerminalManager();
  const service = new WebuiService({
    port,
    operations: createOperationRegistry(port, terminal),
    terminal,
    tcpPort: 0,
    credential: { token: CREDENTIAL_TOKEN },
  });
  const info = await service.start();
  const entry: Booted = {
    service,
    url: `ws://127.0.0.1:${info.tcpPort}/?token=${info.credential.token}`,
    tcpPort: info.tcpPort,
    dataDir,
    workspaceDir,
    close: async () => {
      await service.close().catch(() => undefined);
      await assembled.host.apiHost.close().catch(() => undefined);
      await rm(dataDir, { recursive: true, force: true });
    },
  };
  booted.push(entry);
  return entry;
}

interface Client {
  readonly ws: WebSocket;
  readonly closed: Promise<{ code: number }>;
  call(operation: string, body?: unknown): Promise<Record<string, unknown>>;
  close(): void;
}

function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  ws.on("error", () => undefined);
  const closed = new Promise<{ code: number }>((resolve) => {
    ws.once("close", (code) => resolve({ code }));
  });
  let counter = 0;
  const call = (operation: string, body?: unknown) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const requestId = `r${(counter += 1)}`;
      const onMessage = (raw: RawData) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
        } catch (error) {
          reject(error);
          return;
        }
        if (frame.requestId !== requestId) return;
        ws.off("message", onMessage);
        resolve(frame);
      };
      ws.on("message", onMessage);
      const frame: Record<string, unknown> = {
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId,
        operation,
      };
      if (body !== undefined) frame.body = body;
      ws.send(JSON.stringify(frame));
    });
  return once(ws, "open").then(() => ({ ws, closed, call, close: () => ws.close() }));
}

describe("real host over the loopback service", () => {
  it(
    "answers a session round trip from the real host in an isolated data directory",
    async () => {
      const host = await bootRealHost();
      const client = await connect(host.url);

      // The isolated data directory reached the real host: a run that fell back
      // to the operator's own `~/.minimax` fails right here.
      const version = await client.call("version");
      expect(version.kind).toBe("response");
      expect(version.body).toMatchObject({
        version: "real-host-loopback",
        dataDir: host.dataDir,
      });

      const created = await client.call("createSession", {
        name: "main",
        workspaceDir: host.workspaceDir,
      });
      expect(created.kind).toBe("response");
      const session = (created.body as { session?: { sessionId?: string; workspaceDir?: string } })
        .session;
      expect(typeof session?.sessionId).toBe("string");
      expect(session?.workspaceDir).toBe(host.workspaceDir);

      // Read back through a second operation: the session really landed in the
      // host's store, rather than being a value the first response carried.
      const listed = await client.call("listSessions", { name: "main" });
      const sessions = (listed.body as { sessions?: readonly { sessionId?: string }[] }).sessions;
      expect(sessions?.map((entry) => entry.sessionId)).toContain(session?.sessionId);

      const messages = await client.call("getMessages", { id: session?.sessionId });
      expect(messages.kind).toBe("response");
      expect((messages.body as { messages?: readonly unknown[] }).messages).toEqual([]);

      client.close();
      await client.closed;
    },
    120_000,
  );

  it(
    "answers with the registry's own error frame for a body the validator rejects",
    async () => {
      const host = await bootRealHost();
      const client = await connect(host.url);

      // `isGoalEnabled` takes no body; a body is refused by its descriptor
      // before any host call. The frame the service writes is the registry's,
      // not a stub's.
      const refused = await client.call("isGoalEnabled", {});
      expect(refused.kind).toBe("error");
      expect(refused.code).toBe("invalid_body");
      expect(String(refused.message)).toContain("isGoalEnabled");

      client.close();
      await client.closed;
    },
    120_000,
  );

  it(
    "refuses a fresh connection once the service is closed",
    async () => {
      const host = await bootRealHost();
      const client = await connect(host.url);
      await client.call("version");
      client.close();
      await client.closed;

      await host.service.close();

      // `events.once` rejects when the socket errors while waiting for `open`,
      // which is the refusal ECONNREFUSED this asserts — same idiom as
      // `loopback-harness-path.test.ts`.
      const refused = new WebSocket(host.url);
      refused.on("error", () => undefined);
      await expect(once(refused, "open")).rejects.toThrow();
    },
    120_000,
  );
});
