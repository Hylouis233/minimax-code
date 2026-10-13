// The four fences `turn`'s substrate rests on (ticket #57; plan §4.12 field 8,
// §8 Phase 1 step 1).
//
// These are behavioural assertions of the *mechanism*, not §5.1's four business
// boundary rules — a fence asserts that a mechanism holds; a boundary rule
// asserts that one business cannot write another's state. Carrying the fences
// here does not close the §5.1 coverage gap, which each business discharges in
// its own prohibition test.
//
// The four, each with the assertion that pins it:
//
//   1. **the stream lease** — the lease is claimed *before* the turn opens, on
//      both entry paths (attach claims as `recovered` with the turn it knows; a
//      local send claims as `local-send`), so the `session.start` the runtime
//      publishes for our own turn finds an owner instead of a second stream.
//   2. **the generation guard** — a superseded attempt's frames, phase writes
//      and refusal produce zero state writes, because the fence is bound to the
//      generation the sink claimed.
//   3. **the cursor `resume`/`resync` transition** — a mid-stream drop with an
//      observed cursor resumes with `afterCursor`; a `resume_overflow` frame
//      takes the other branch, reloading history and starting a fresh
//      subscription with no cursor.
//   4. **`finalizeOnExit`** — an early return on the absent-capability path
//      releases the lease through the *raw* sink exactly once and commits a
//      refusal carrying the reason, instead of leaving a "思考中" spinner behind.
//
// Every case drives `runWebuiStreamLoop` against the real store and the real
// sink (`buildWebuiStreamLoopSink`), so the lease's visible effect — the
// `subscription` field other bindings read — is what the assertions observe.

import { describe, expect, it, vi } from "vitest";

import {
  buildWebuiStreamLoopSink,
  runWebuiStreamLoop,
  type WebuiStreamLoopSink,
} from "../../src/client/mechanisms/stream-loop.js";
import { streamStateBundle } from "../../src/client/application/stream-state-bundle.js";
import { streamRecoveryProjection } from "../../src/client/projection/stream-recovery.js";
import {
  createWebuiSessionStore,
  type WebuiSessionStore,
} from "../../src/client/application/session-store.js";
import type { WebuiClientMessageSender } from "../../src/client/contracts/execution-port.js";
import type { WebuiClientSessionResumer } from "../../src/client/contracts/execution-port.js";
import type { WebuiClientMessageLoader } from "../../src/client/contracts/transcript/message-view.js";
import type { WebuiStreamFrame } from "../../src/shared/contracts/stream.js";

const SESSION_ID = "session-fences";

/** The store, the sink built from its writer, and a reader for the live slice. */
function harness(sessionId = SESSION_ID) {
  const store: WebuiSessionStore = createWebuiSessionStore();
  const writer = store.createSessionWriter({ kind: "session", sessionId });
  return {
    store,
    writer,
    newSink: (): WebuiStreamLoopSink =>
      buildWebuiStreamLoopSink(writer.setStream, streamStateBundle),
    stream: () => store.readSession(sessionId).stream,
  };
}

/** The two pure bundles the loop must be handed; nothing else is needed. */
const loopDeps = (extra: {
  sendMessage?: WebuiClientMessageSender;
  resumeSession?: WebuiClientSessionResumer;
  loadMessages?: WebuiClientMessageLoader;
}) => ({
  ...extra,
  projection: streamRecoveryProjection,
  streamState: streamStateBundle,
});

/** A send that never settles: the loop stays inside the open subscription. */
const pendingSend = (): WebuiClientMessageSender =>
  vi.fn(() => new Promise<void>(() => {}));

describe("fence 1 — the stream lease is claimed before the turn opens", () => {
  it("claims as `recovered` with the attached turn, visible on the slice at once", async () => {
    const shell = harness();
    const resumeSession: WebuiClientSessionResumer = vi.fn(
      () => new Promise<void>(() => {}),
    );
    void runWebuiStreamLoop(
      loopDeps({ resumeSession }),
      { sessionId: SESSION_ID, attachTurnId: "turn-9" },
      shell.newSink(),
    );
    // Claimed synchronously, before the first await: a `session.start` for this
    // turn arriving now finds an owner rather than starting a second stream.
    expect(shell.stream().subscription).toMatchObject({
      owner: "recovered",
      turnId: "turn-9",
    });
    expect(shell.stream().phase).toBe("streaming");
  });

  it("claims as `local-send` with no turn id, because the runtime names the turn later", async () => {
    const shell = harness();
    void runWebuiStreamLoop(
      loopDeps({ sendMessage: pendingSend() }),
      { sessionId: SESSION_ID, message: "hello" },
      shell.newSink(),
    );
    expect(shell.stream().subscription).toMatchObject({ owner: "local-send" });
    expect(shell.stream().subscription?.turnId).toBeUndefined();
  });
});

describe("fence 2 — the generation guard drops a superseded attempt's writes", () => {
  it("lets only the newest claimer write frames, phases and refusal", () => {
    const shell = harness();
    const stale = shell.newSink();
    const live = shell.newSink();
    stale.claimSubscription?.("local-send");
    live.claimSubscription?.("local-send");

    stale.applyFrame({ dataJson: '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":"stale"}}' });
    expect(shell.stream().messages).toHaveLength(0);

    live.applyFrame({ dataJson: '{"type":6,"agent_message_chunk":{"msg_id":"m2","msg_content":"live"}}' });
    expect(shell.stream().messages).toHaveLength(1);

    // Every write the superseded sink still attempts is dropped: a late frame,
    // a wholesale message replacement, a phase move and a refusal. The live
    // turn's transcript and phase are untouched.
    const liveBefore = shell.stream();
    stale.applyFrame({ dataJson: '{"type":6,"agent_message_chunk":{"msg_id":"m3","msg_content":"late"}}' });
    stale.setMessages([]);
    expect(shell.stream().messages).toHaveLength(1);
    expect(shell.stream().messages).toEqual(liveBefore.messages);

    // A late refusal from the superseded attempt must not stamp itself over the
    // turn that replaced it.
    stale.setPhase("refused");
    stale.refuse("late failure");
    expect(shell.stream().phase).not.toBe("refused");
    expect(shell.stream().refusal).toBeUndefined();
  });

  it("is bound to the lease mechanism's single generation counter", () => {
    const shell = harness();
    const first = shell.newSink();
    const second = shell.newSink();
    const a = first.claimSubscription?.("local-send");
    const b = second.claimSubscription?.("local-send");
    expect(a).toBeTypeOf("number");
    expect(b).toBeTypeOf("number");
    expect(b).toBeGreaterThan(a as number);
    // Re-claiming on the same sink hands back the generation it already owns
    // rather than minting a new one and re-stamping the fence.
    expect(first.claimSubscription?.("local-send")).toBe(a);
    expect(shell.stream().lastClaimedGeneration).toBe(b);
  });
});

describe("fence 3 — the cursor resume/resync transition", () => {
  it("resumes with the cursor it observed when the socket drops mid-stream", async () => {
    const shell = harness();
    const resumeCalls: { afterCursor?: string }[] = [];
    const sendMessage: WebuiClientMessageSender = vi.fn(async (_req, onFrame) => {
      onFrame({ dataJson: "{}", cursor: "c1" });
      throw new Error("connection closed before [DONE]");
    });
    const resumeSession: WebuiClientSessionResumer = vi.fn(async (req, onFrame) => {
      resumeCalls.push({ afterCursor: req.afterCursor });
      onFrame({ dataJson: "[DONE]" });
    });

    await runWebuiStreamLoop(
      loopDeps({ sendMessage, resumeSession }),
      { sessionId: SESSION_ID, message: "hello" },
      shell.newSink(),
    );

    expect(resumeCalls).toEqual([{ afterCursor: "c1" }]);
    expect(shell.stream().phase).toBe("done");
  });

  it("takes the resync branch on a resume_overflow frame: reload, then subscribe with no cursor", async () => {
    const shell = harness();
    const resumeCalls: { afterCursor?: string }[] = [];
    let loads = 0;
    const sendMessage: WebuiClientMessageSender = vi.fn(async (_req, onFrame) => {
      onFrame({ dataJson: "{}", cursor: "c-stale" });
      onFrame({ dataJson: '{"type":"resume_overflow"}' });
      onFrame({ dataJson: "[DONE]" });
    });
    const resumeSession: WebuiClientSessionResumer = vi.fn(async (req, onFrame) => {
      resumeCalls.push({ afterCursor: req.afterCursor });
      onFrame({ dataJson: "[DONE]" });
    });
    const loadMessages: WebuiClientMessageLoader = vi.fn(async () => {
      loads += 1;
      return { messages: [], hasMore: false };
    });

    await runWebuiStreamLoop(
      loopDeps({ sendMessage, resumeSession, loadMessages }),
      { sessionId: SESSION_ID, message: "hello" },
      shell.newSink(),
    );

    expect(loads).toBe(1);
    expect(resumeCalls).toEqual([{ afterCursor: undefined }]);
    expect(shell.stream().phase).toBe("done");
  });
});

describe("fence 4 — finalizeOnExit releases the lease once and states the reason", () => {
  it("releases through the raw sink exactly once on the absent-capability exit", async () => {
    const shell = harness();
    let releases = 0;
    const refusals: string[] = [];
    const inner = shell.newSink();
    const sink: WebuiStreamLoopSink = {
      ...inner,
      releaseSubscription: () => {
        releases += 1;
        inner.releaseSubscription?.();
      },
      refuse: (reason, options) => {
        refusals.push(reason);
        inner.refuse(reason, options);
      },
    };

    // The attach path with no `resumeSession`: `finalizeOnExit` is the only
    // thing standing between the user and a spinner that never stops.
    await runWebuiStreamLoop(
      loopDeps({}),
      { sessionId: SESSION_ID, attachTurnId: "turn-1" },
      sink,
    );

    expect(releases).toBe(1);
    expect(refusals).toEqual(["resumeSession transport is unavailable"]);
    expect(shell.stream().phase).toBe("refused");
    expect(shell.stream().refusal).toBe("resumeSession transport is unavailable");
    // The lease is gone, so the next `session.start` attaches instead of
    // colliding with a dead owner. The generation stamp stays, so the released
    // attempt still cannot write.
    expect(shell.stream().subscription).toBeUndefined();
  });

  it("releases through the raw sink even when a wrapped callback already threw", async () => {
    const shell = harness();
    let releases = 0;
    const inner = shell.newSink();
    const sink: WebuiStreamLoopSink = {
      ...inner,
      applyFrame: () => {
        throw new Error("sink write failed");
      },
      releaseSubscription: () => {
        releases += 1;
        inner.releaseSubscription?.();
      },
    };
    const resumeSession: WebuiClientSessionResumer = vi.fn(async (_req, onFrame) => {
      onFrame({ dataJson: '{"type":10}' });
    });

    await runWebuiStreamLoop(
      loopDeps({ resumeSession }),
      { sessionId: SESSION_ID, attachTurnId: "turn-2" },
      sink,
    );

    // Cleanup is not a render path: it must survive the failure-containment
    // rule that makes every other callback inert after the first throw.
    expect(releases).toBe(1);
    expect(shell.stream().phase).toBe("refused");
    expect(shell.stream().subscription).toBeUndefined();
  });
});
