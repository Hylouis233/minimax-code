/**
 * `testUserModelCandidate` ingress validation (plan §5.4 / D05).
 *
 * This file used to compare the old record-forwarding validator with the new
 * registry byte for byte and assert that each malformed body reached the runtime
 * anyway. That expectation is the behaviour D05 removes: the same bodies are now
 * refused at ingress with `invalidBody` and the runtime is never invoked. The old
 * byte-equivalence assertion is replaced in full rather than kept beside the new
 * one — keeping it would require weakening the validator back to a
 * record-forwarder.
 *
 * The positive case at the end is new: this file never had one, and without it
 * nothing here would notice a validator that rejects everything.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { WebSocket } from "ws";

import { createHarnessPortFromHost } from "../../src/runtime/harness/adapter.js";
import type { WebuiHarnessPort } from "../../src/runtime/port.js";
import { createOperationRegistry } from "../../src/server/index.js";
import { dispatchWebuiFrame } from "../../src/server/operation/operation-dispatch.js";
import { WebuiErrorCode, WEBUI_PROTOCOL_VERSION } from "../../src/shared/envelope.js";

interface Socket {
  readonly readyState: number;
  readonly OPEN: number;
  readonly sent: string[];
  send(payload: string): void;
}

function socket(): Socket {
  const value: Socket = {
    readyState: 1,
    OPEN: 1,
    sent: [],
    send(payload) {
      value.sent.push(payload);
    },
  };
  return value;
}

function request(body: unknown): unknown {
  return JSON.parse(
    JSON.stringify({
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "candidate-1",
      operation: "testUserModelCandidate",
      body,
    }),
  );
}

/** A runtime target that records what reached it and answers with a marker. */
function recordingTarget() {
  const calls: Array<{ candidate: unknown; modelId: unknown }> = [];
  const target = async (input: { candidate: unknown; modelId: unknown }) => {
    calls.push(input);
    return { ok: true };
  };
  const runtimePort: WebuiHarnessPort = createHarnessPortFromHost({
    cliService: { testUserModelCandidate: target },
  } as never);
  return { calls, registry: createOperationRegistry(runtimePort) };
}

async function dispatch(
  body: unknown,
  registry: ReturnType<typeof createOperationRegistry>,
): Promise<{ readonly kind?: string; readonly code?: string; readonly body?: unknown }> {
  const ws = socket();
  await dispatchWebuiFrame(
    ws as unknown as WebSocket,
    request(body),
    registry,
    true,
    () => undefined,
  );
  return JSON.parse(ws.sent[0] ?? "{}") as {
    readonly kind?: string;
    readonly code?: string;
    readonly body?: unknown;
  };
}

describe("testUserModelCandidate refuses malformed bodies at ingress", () => {
  // The first five reached the runtime before D05, where the missing fields
  // became a TypeError inside the adapter. All of them are ingress failures now.
  const malformed: ReadonlyArray<{ readonly name: string; readonly body: unknown }> = [
    { name: "a candidate with no modelId", body: { candidate: { providerId: "p1" } } },
    { name: "a modelId with no candidate", body: { modelId: "m1" } },
    { name: "a null candidate", body: { candidate: null, modelId: "m1" } },
    { name: "a null body", body: null },
    { name: "an undefined body", body: undefined },
    {
      name: "a candidate without a base URL",
      body: { candidate: { name: "p", apiKey: "k", apiFormat: "openai" }, modelId: "m1" },
    },
    {
      name: "a candidate whose base URL is not a string",
      body: { candidate: { baseUrl: 7 }, modelId: "m1" },
    },
    {
      name: "an empty modelId",
      body: { candidate: { baseUrl: "https://example.test" }, modelId: "  " },
    },
    {
      name: "a candidate whose models entry has no id",
      body: {
        candidate: { baseUrl: "https://example.test", models: [{ displayName: "x" }] },
        modelId: "m1",
      },
    },
    {
      name: "a candidate whose header value is not a string",
      body: {
        candidate: { baseUrl: "https://example.test", headers: { "X-A": 1 } },
        modelId: "m1",
      },
    },
  ];

  for (const { name, body } of malformed) {
    it(`refuses ${name} without invoking the runtime`, async () => {
      const { calls, registry } = recordingTarget();
      const frame = await dispatch(body, registry);
      assert.equal(
        frame.kind,
        "error",
        `expected an error frame, got ${JSON.stringify(frame)}`,
      );
      assert.equal(frame.code, WebuiErrorCode.invalidBody);
      assert.deepEqual(calls, [], "the runtime must not be invoked for a malformed body");
    });
  }
});

describe("testUserModelCandidate forwards a valid body unchanged", () => {
  it("passes the candidate, its extensions and the model id through", async () => {
    const { calls, registry } = recordingTarget();
    const candidate = {
      providerId: "p1",
      expectedRevision: "rev-9",
      name: "mine",
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test",
      apiFormat: "openai",
      headers: { "X-A": "1" },
      removeHeaders: ["X-Old"],
      models: [{ modelId: "m1", enabled: true }],
      // An extension the client sends and the runtime forwards: it must survive
      // the validator rather than be dropped by a rebuilt whitelist.
      futureField: { nested: [1, 2] },
    };
    const frame = await dispatch({ candidate, modelId: "m1" }, registry);

    assert.equal(frame.kind, "response");
    assert.deepEqual(frame.body, { ok: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.candidate, candidate);
    assert.equal(calls[0]?.modelId, "m1");
  });
});
