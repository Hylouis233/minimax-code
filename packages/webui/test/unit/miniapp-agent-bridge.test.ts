// The Mini App page bridge, driven end to end without a browser.
//
// The page half is the script the proxy actually injects
// (`server/miniapp/bridge.ts`), executed in a `vm` context whose `window` is a
// two-window pair: the page's own, and the client's as its `parent`. The client
// half is the real host (`application/miniapp-agent-bridge.ts`). Frames travel the
// way they do in a browser — the page posts to its parent, the host posts back to
// the frame — so these cases exercise source and origin checks, request-id
// correlation, event delivery, cancellation and teardown rather than a stub of
// them.
//
// On the other side of the host the commands are scripted, and the operations are
// driven through their real handlers against a scripted port, so what a case
// asserts is what reached the runtime: which caller, which generation, and whether
// a listener was attached (`observe`).
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { miniAppPageBridge } from "../../src/server/miniapp/bridge.js";
import { createWebuiMiniAppAgentBridge } from "../../src/client/features/miniapp/application/miniapp-agent-bridge.js";
import { createMiniAppAgentConnections } from "../../src/server/miniapp/agent-connections.js";
import { createMiniAppAgentRuns } from "../../src/server/miniapp/agent-runs.js";
import { createMiniAppAgentHandlerEntries } from "../../src/server/operation/handlers/miniapp-agent.js";
import { createWebuiMiniAppWorkflows } from "../../src/client/features/miniapp/application/miniapp-workflows.js";
import type {
  WebuiMiniAppAgentCallRequest,
  WebuiMiniAppAgentTurnFrame,
  WebuiMiniAppAgentTurnRequest,
} from "../../src/shared/contracts/miniapp-agent.js";
import type { WebuiMiniAppPortSlice } from "../../src/client/features/miniapp/application/miniapp-workflows.js";
import type { WebuiHarnessPort } from "../../src/runtime/port.js";
import type {
  MiniAppAgentModelSelection,
  MiniAppAgentRunEvent,
  MiniAppAgentRunResult,
} from "@mavis/shared/miniapp-surface";

const VIEW_URL = "http://127.0.0.1:49152/";
const ORIGIN = "http://127.0.0.1:49152";
const PLUGIN = "demo.miniapp";
const HOST_SESSION = "session-host";

interface PageHarness {
  readonly agent: Record<string, (...args: unknown[]) => Promise<unknown>>;
  /** Every frame the page posted to its parent. */
  readonly sentToParent: readonly Record<string, unknown>[];
  /** Delivers a frame from the client into the page. */
  readonly deliver: (data: unknown) => void;
  /** The page's own window, which is also its parent's child. */
  readonly window: Record<string, unknown>;
}

/**
 * The proxy's real script, in a page-shaped context.
 *
 * Only what the script reads is provided: `window` with a `parent` it can post to,
 * the event listeners it registers, and the language built-ins it uses. Nothing
 * here stands in for the bridge's own logic.
 */
function openPage(): PageHarness {
  const listeners: ((event: { source: unknown; data: unknown }) => void)[] = [];
  const sentToParent: Record<string, unknown>[] = [];
  const pageWindow: Record<string, unknown> = {
    parent: {
      postMessage: (message: unknown) => {
        sentToParent.push(message as Record<string, unknown>);
      },
    },
    addEventListener: (type: string, listener: (event: never) => void) => {
      if (type === "message") listeners.push(listener as never);
    },
  };
  const context = vm.createContext({
    window: pageWindow,
    Map,
    Math,
    JSON,
    Error,
    Object,
    Date,
    Promise,
    console,
  });
  vm.runInContext(miniAppPageBridge().script, context);
  const mcode = pageWindow.mcode as { miniapp: { agent: Record<string, (...a: unknown[]) => Promise<unknown>> } };
  return {
    agent: mcode.miniapp.agent,
    sentToParent,
    window: pageWindow,
    deliver: (data) => {
      for (const listener of listeners) listener({ source: pageWindow.parent, data });
    },
  };
}

/** Runs the loop that carries the page's frames to the host until it settles. */
async function pump(
  page: PageHarness,
  host: ReturnType<typeof createWebuiMiniAppAgentBridge>,
  frame: unknown,
  until: () => boolean,
): Promise<void> {
  for (let tick = 0; tick < 50; tick += 1) {
    await Promise.resolve();
    const pending = page.sentToParent.length;
    for (const data of page.sentToParent) {
      host.handleMessage({ data, origin: ORIGIN, source: page.window }, frame);
    }
    // Frames are consumed once; draining keeps the loop from re-dispatching them.
    (page.sentToParent as Record<string, unknown>[]).length = 0;
    if (until()) return;
    if (pending === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * A port with all nine agent members, so a case can vary the one it cares about.
 *
 * The capability is all-or-nothing by design: the runtime composes the nine from
 * one application cell, so the handler refuses every one of them when a member is
 * missing rather than half-answering.
 */
function agentPort(overrides: Partial<Record<string, unknown>> = {}): WebuiHarnessPort {
  return {
    runMiniAppAgentTurn: async () => turnResult(),
    answerMiniAppAgentQuestion: async () => turnResult(),
    replyMiniAppAgentPermission: async () => undefined,
    openMiniAppAgentSession: async () => ({ sessionId: "session-mini", hostSessionId: HOST_SESSION }),
    panelOpenedMiniAppAgentSession: async () => undefined,
    panelClosedMiniAppAgentSession: async () => undefined,
    listMiniAppAgentModels: async () => ({
      models: [],
      default: { providerId: "p", modelId: "m" } satisfies MiniAppAgentModelSelection,
    }),
    listMiniAppAgentAgents: async () => ({ agents: [] }),
    createMiniAppAgentSession: async () => ({ sessionId: "session-mini" }),
    ...overrides,
  } as unknown as WebuiHarnessPort;
}

function turnResult(overrides: Partial<MiniAppAgentRunResult> = {}): MiniAppAgentRunResult {
  return { sessionId: "session-mini", turnId: "turn-1", status: "finished", text: "done", ...overrides };
}

describe("the page bridge's agent block", () => {
  it("carries a run's events and its settlement back to the page that asked", async () => {
    const page = openPage();
    const frames: WebuiMiniAppAgentTurnFrame[] = [
      { kind: "event", event: { type: "turn.started", sessionId: "session-mini", turnId: "turn-1", model: { providerId: "p", modelId: "m" } } },
      { kind: "event", event: { type: "text.delta", sessionId: "session-mini", turnId: "turn-1", text: "hel" } },
      { kind: "settled", result: turnResult() },
    ];
    let request: WebuiMiniAppAgentTurnRequest | undefined;
    const host = createWebuiMiniAppAgentBridge({
      pluginId: PLUGIN,
      hostSessionId: HOST_SESSION,
      connection: 3,
      viewUrl: VIEW_URL,
      post: (message) => page.deliver(message),
      commands: {
        call: async () => ({ ok: true, method: "cancel" }),
        watchTurn: (asked, onFrame) => {
          request = asked;
          for (const frame of frames) onFrame(frame);
          return () => undefined;
        },
      },
    });

    const seen: MiniAppAgentRunEvent[] = [];
    const settled = page.agent.run({ text: "hello" }, { onEvent: (event: MiniAppAgentRunEvent) => seen.push(event) });
    await pump(page, host, page.window, () => false);
    const result = await settled;

    expect(request?.text).toBe("hello");
    expect(request?.observe).toBe(true);
    // The identity the page never supplied, resolved by the view.
    expect(request?.pluginId).toBe(PLUGIN);
    expect(request?.hostSessionId).toBe(HOST_SESSION);
    expect(request?.connection).toBe(3);
    expect(seen.map((event) => event.type)).toEqual(["turn.started", "text.delta"]);
    expect(result).toMatchObject({ sessionId: "session-mini", status: "finished", text: "done" });
  });

  it("ignores a message that did not come from the frame this view framed", async () => {
    const page = openPage();
    const watchTurn = vi.fn(() => () => undefined);
    const host = createWebuiMiniAppAgentBridge({
      pluginId: PLUGIN,
      hostSessionId: HOST_SESSION,
      connection: 1,
      viewUrl: VIEW_URL,
      post: (message) => page.deliver(message),
      commands: { call: async () => ({ ok: true, method: "cancel" }), watchTurn },
    });

    const foreign = { type: "mcode:miniapp:agent-request", requestId: "r-1", method: "run", payload: { text: "hi" }, observe: true };
    // A second window on the same origin, and this page's own window under another origin.
    host.handleMessage({ data: foreign, origin: ORIGIN, source: { other: true } }, page.window);
    host.handleMessage({ data: foreign, origin: "http://evil.test", source: page.window }, page.window);
    expect(watchTurn).not.toHaveBeenCalled();
  });

  it("answers a second request that reuses a live id with busy", async () => {
    const page = openPage();
    let release: (() => void) | undefined;
    const host = createWebuiMiniAppAgentBridge({
      pluginId: PLUGIN,
      hostSessionId: HOST_SESSION,
      connection: 1,
      viewUrl: VIEW_URL,
      post: (message) => page.deliver(message),
      commands: {
        call: async () => ({ ok: true, method: "cancel" }),
        watchTurn: () => {
          release = () => undefined;
          return () => undefined;
        },
      },
    });

    const first = page.agent.run({ text: "one", requestId: "same" });
    await pump(page, host, page.window, () => false);
    const duplicate = { type: "mcode:miniapp:agent-request", requestId: "same", method: "run", payload: { text: "two" }, observe: true };
    host.handleMessage({ data: duplicate, origin: ORIGIN, source: page.window }, page.window);
    await expect(duplicate).toBeDefined();
    expect(host.inFlight()).toEqual(["same"]);
    release?.();
    void first.catch(() => undefined);
  });

  it("settles a cancelled turn as cancelled, never as a clean result", async () => {
    const page = openPage();
    const calls: WebuiMiniAppAgentCallRequest[] = [];
    let settleTurn: ((frame: WebuiMiniAppAgentTurnFrame) => void) | undefined;
    const host = createWebuiMiniAppAgentBridge({
      pluginId: PLUGIN,
      hostSessionId: HOST_SESSION,
      connection: 2,
      viewUrl: VIEW_URL,
      post: (message) => page.deliver(message),
      commands: {
        call: async (request) => {
          calls.push(request);
          return { ok: true, method: "cancel" };
        },
        watchTurn: (_request, onFrame) => {
          settleTurn = onFrame;
          return () => undefined;
        },
      },
    });

    const running = page.agent.run({ text: "long" }, { onEvent: () => undefined });
    await pump(page, host, page.window, () => false);
    page.agent.cancel(host.inFlight()[0] as string);
    await pump(page, host, page.window, () => false);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("cancel");
    // The service settles the abort; the page learns the code from that frame.
    settleTurn?.({ kind: "failure", code: "cancelled" });
    await expect(running).rejects.toThrow("cancelled");
  });

  it("carries a permission decision and a questionnaire answer with the page's ids", async () => {
    const page = openPage();
    const calls: WebuiMiniAppAgentCallRequest[] = [];
    const turns: WebuiMiniAppAgentTurnRequest[] = [];
    const host = createWebuiMiniAppAgentBridge({
      pluginId: PLUGIN,
      hostSessionId: HOST_SESSION,
      connection: 4,
      viewUrl: VIEW_URL,
      post: (message) => page.deliver(message),
      commands: {
        call: async (request) => {
          calls.push(request);
          return { ok: true, method: "reply" };
        },
        watchTurn: (request, onFrame) => {
          turns.push(request);
          onFrame({ kind: "settled", result: turnResult() });
          return () => undefined;
        },
      },
    });

    const replied = page.agent.reply({ sessionId: "session-mini", requestId: "perm-1", decision: "allowOnce" });
    await pump(page, host, page.window, () => false);
    await replied;

    const answered = page.agent.answer(
      {
        sessionId: "session-mini",
        questionId: "q-1",
        answers: [{ stepId: "s1", selectedOptionIds: ["yes"], selectedOther: false }],
      },
      { onEvent: () => undefined },
    );
    await pump(page, host, page.window, () => false);
    await answered;

    expect(calls[0]).toMatchObject({
      method: "reply",
      targetSessionId: "session-mini",
      questionRequestId: "perm-1",
      decision: "allowOnce",
    });
    expect(turns[0]).toMatchObject({
      method: "answer",
      targetSessionId: "session-mini",
      questionRequestId: "q-1",
      observe: true,
    });
  });
});

describe("the agent operations at the service boundary", () => {
  const body = {
    pluginId: PLUGIN,
    hostSessionId: HOST_SESSION,
    connection: 1,
    requestId: "req-1",
    method: "run" as const,
    observe: true,
    text: "hello",
  };

  it("reaches the runtime with the launch's process generation as the caller", async () => {
    const connections = createMiniAppAgentConnections();
    connections.register({ pluginId: PLUGIN, runId: "gen-7" });
    const runMiniAppAgentTurn = vi.fn(async () => turnResult());
    const entries = createMiniAppAgentHandlerEntries(agentPort({ runMiniAppAgentTurn }), {
      connections,
      runs: createMiniAppAgentRuns(),
    });
    const handle = entries.get("watchMiniAppAgentTurn")!;
    const outcome = (await handle.handle({ requestId: "wire-1" }, body)) as {
      stream: { source: AsyncIterable<WebuiMiniAppAgentTurnFrame> };
    };
    const frames: WebuiMiniAppAgentTurnFrame[] = [];
    for await (const frame of outcome.stream.source) frames.push(frame);

    expect(runMiniAppAgentTurn).toHaveBeenCalledTimes(1);
    expect(runMiniAppAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: { pluginId: PLUGIN, runId: "gen-7", hostSessionId: HOST_SESSION },
        text: "hello",
      }),
    );
    expect(frames).toEqual([{ kind: "settled", result: turnResult() }]);
  });

  it("attaches a listener only when the page asked to observe", async () => {
    const connections = createMiniAppAgentConnections();
    connections.register({ pluginId: PLUGIN, runId: "gen-1" });
    const calls: Record<string, unknown>[] = [];
    const entries = createMiniAppAgentHandlerEntries(
      agentPort({
        runMiniAppAgentTurn: async (input: Record<string, unknown>) => {
          calls.push(input);
          return turnResult();
        },
      }),
      { connections, runs: createMiniAppAgentRuns() },
    );
    const handle = entries.get("watchMiniAppAgentTurn")!;
    for (const observe of [true, false]) {
      const outcome = (await handle.handle(
        { requestId: `wire-${String(observe)}` },
        { ...body, observe, requestId: `req-${String(observe)}` },
      )) as { stream: { source: AsyncIterable<WebuiMiniAppAgentTurnFrame> } };
      for await (const frame of outcome.stream.source) void frame;
    }
    expect(calls[0]).toHaveProperty("onEvent");
    expect(calls[1]).not.toHaveProperty("onEvent");
  });

  it("refuses a stale presentation generation and never calls the runtime", async () => {
    const connections = createMiniAppAgentConnections();
    connections.register({ pluginId: PLUGIN, runId: "gen-1" });
    const runMiniAppAgentTurn = vi.fn();
    const entries = createMiniAppAgentHandlerEntries(
      { runMiniAppAgentTurn } as unknown as WebuiHarnessPort,
      { connections, runs: createMiniAppAgentRuns() },
    );
    const outcome = (await entries
      .get("watchMiniAppAgentTurn")!
      .handle({ requestId: "wire" }, { ...body, connection: 99 })) as {
      stream: { source: AsyncIterable<WebuiMiniAppAgentTurnFrame> };
    };
    const frames: WebuiMiniAppAgentTurnFrame[] = [];
    for await (const frame of outcome.stream.source) frames.push(frame);
    expect(frames).toEqual([{ kind: "failure", code: "runtime_unavailable" }]);
    expect(runMiniAppAgentTurn).not.toHaveBeenCalled();
  });

  it("answers a documented code when the host cannot serve the method", async () => {
    const connections = createMiniAppAgentConnections();
    connections.register({ pluginId: PLUGIN, runId: "gen-1" });
    const entries = createMiniAppAgentHandlerEntries({} as WebuiHarnessPort, {
      connections,
      runs: createMiniAppAgentRuns(),
    });
    const response = (await entries.get("miniAppAgentCall")!.handle(
      { requestId: "wire" },
      {
        pluginId: PLUGIN,
        hostSessionId: HOST_SESSION,
        connection: 1,
        requestId: "call-1",
        method: "models",
      },
    )) as { body: { ok: boolean; code?: string } };
    expect(response.body).toEqual({ ok: false, code: "runtime_unavailable" });
  });
});

describe("the shown presentation", () => {
  function portWith(calls: WebuiMiniAppAgentCallRequest[]): WebuiMiniAppPortSlice {
    return {
      listMiniApps: async () => ({ miniApps: [] }),
      openMiniApp: async ({ pluginId }) => ({
        pluginId,
        viewUrl: VIEW_URL,
        connection: 1,
      }),
      stopMiniApp: async () => ({ success: true as const }),
      miniAppAgentCall: async (request) => {
        calls.push(request);
        if (request.method === "open") {
          return { ok: true, method: "open", sessionId: request.targetSessionId ?? "", hostSessionId: HOST_SESSION };
        }
        return { ok: true, method: request.method as "panelOpened" };
      },
    } as WebuiMiniAppPortSlice;
  }

  it("reports shown only after the client selected it, and closed when the person leaves", async () => {
    const calls: WebuiMiniAppAgentCallRequest[] = [];
    const workflows = createWebuiMiniAppWorkflows({ port: portWith(calls) });

    await workflows.reportShown({
      pluginId: PLUGIN,
      sessionId: "session-mini",
      hostSessionId: HOST_SESSION,
      connection: 1,
    });
    expect(calls.map((call) => call.method)).toEqual(["panelOpened"]);
    expect(workflows.getSnapshot().agentShown?.sessionId).toBe("session-mini");

    // Re-announcing the same selection changes nothing.
    workflows.noteSelectedSession("session-mini");
    expect(calls).toHaveLength(1);

    // Leaving it is the close report, which is what stops its asks being answerable.
    workflows.noteSelectedSession("another-session");
    await Promise.resolve();
    expect(calls.map((call) => call.method)).toEqual(["panelOpened", "panelClosed"]);
    expect(workflows.getSnapshot().agentShown).toBeUndefined();
  });

  it("does not count a session the runtime refused as shown", async () => {
    const calls: WebuiMiniAppAgentCallRequest[] = [];
    const port = {
      ...portWith(calls),
      miniAppAgentCall: async (request: WebuiMiniAppAgentCallRequest) => {
        calls.push(request);
        return { ok: false as const, code: "not_permitted" as const };
      },
    } as WebuiMiniAppPortSlice;
    const workflows = createWebuiMiniAppWorkflows({ port });
    await workflows.reportShown({
      pluginId: PLUGIN,
      sessionId: "session-mini",
      hostSessionId: HOST_SESSION,
      connection: 1,
    });
    expect(workflows.getSnapshot().agentShown).toBeUndefined();
  });
});
