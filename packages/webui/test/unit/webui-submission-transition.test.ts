// The submission's semantic transition.
//
// The rule and the target read are pinned in their own suites; what this one pins is that the real
// submission *reports* what it decided, and that reporting changed no behaviour: every callback the
// baseline called still fires, and the store is untouched wherever the baseline left it untouched.
//
// Two cases are new facts rather than preserved ones, and both are refusals the baseline produced in
// silence: a live turn with nowhere to queue, and an enqueue the transport refused.

import { describe, expect, it, vi } from "vitest";

import {
  buildWebuiComposerHandlers,
  submitWebuiComposerTurn,
} from "../../src/client/features/turn/application/composer-submission.js";
import type { WebuiDeliverySink } from "../../src/shared/contracts/delivery.js";

/** The sink the loop would write through; these sends never open one, so every member is a spy. */
const sink: WebuiDeliverySink = {
  claim: vi.fn(() => undefined),
  accept: vi.fn(),
  begin: vi.fn(),
  recovering: vi.fn(),
  anchor: vi.fn(),
  replace: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  release: vi.fn(),
};

/** The handlers a caller supplies; every one is a spy so the preserved calls are observable. */
function handlers() {
  return buildWebuiComposerHandlers({
    createSink: () => sink,
    resetStreamForTurn: vi.fn(),
    setRefusal: vi.fn(),
    setSending: vi.fn(),
    onDraftChange: vi.fn(),
    onNeedsSession: vi.fn(),
    onSessionCreated: vi.fn(),
    onQueued: vi.fn(),
  });
}

const sendMessage = vi.fn(async () => undefined);

describe("the transition a submission reports", () => {
  it("reports nothing when the intent carried nothing to submit", async () => {
    // Not a refusal: the vocabulary covers what a submission decided, and an empty draft never
    // reached a decision. The baseline's guard produced the same no-op.
    const result = await submitWebuiComposerTurn(
      { draft: "   ", sessionId: "s1", sending: false, deps: { sendMessage } },
      handlers(),
    );
    expect(result).toBeUndefined();
  });

  it("names the missing transport and creates nothing", async () => {
    // A creator alone is not a way to deliver a message, so the use case must not be reached.
    const submit = vi.fn(async () => ({ kind: "created" as const, sessionId: "created", selected: true }));
    const result = await submitWebuiComposerTurn(
      { draft: "hello", sending: false, deps: {}, submitTask: { submit } },
      handlers(),
    );
    expect(result).toMatchObject({
      decision: "unsupported",
      completion: { kind: "unsupported", missing: "transport" },
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports D01's reservation: one creation per home incarnation, input untouched", async () => {
    // The use case refuses the second submission before any wire IO; the transition names it, and the
    // refusals the first one would produce (a creation failure, a dispatch) never happen.
    const submit = vi.fn(async () => ({ kind: "busy" as const }));
    const h = handlers();
    const result = await submitWebuiComposerTurn(
      { draft: "hello", sending: false, deps: { sendMessage }, submitTask: { submit } },
      h,
    );
    expect(result).toMatchObject({ decision: "busy", completion: { kind: "busy", reason: "creating" } });
    expect(h.setSending).not.toHaveBeenCalled();
    expect(h.onDraftChange).not.toHaveBeenCalled();
  });

  it("asks for a session through the handler it always called", async () => {
    const h = handlers();
    const result = await submitWebuiComposerTurn(
      { draft: "hello", sending: false, deps: { sendMessage } },
      h,
    );
    expect(result).toMatchObject({ decision: "needs-session", completion: { kind: "needs-session" } });
    expect(h.onNeedsSession).toHaveBeenCalledWith("hello");
  });

  it("reports a creation failure with the message the banner got", async () => {
    const h = handlers();
    const result = await submitWebuiComposerTurn(
      {
        draft: "hello",
        sending: false,
        deps: { sendMessage },
        submitTask: {
          submit: async () => ({ kind: "creation-failed", error: "synthetic creation failure" }),
        },
      },
      h,
    );
    expect(result).toMatchObject({ decision: "creation-failed" });
    expect(result?.completion).toMatchObject({ kind: "creation-failed" });
    expect(h.setRefusal).toHaveBeenCalledWith("synthetic creation failure");
  });

  it("refuses a live turn it cannot queue onto, instead of dropping the input", async () => {
    const h = handlers();
    const result = await submitWebuiComposerTurn(
      { draft: "hello", sessionId: "s1", sending: true, deps: { sendMessage } },
      h,
    );
    expect(result).toMatchObject({ decision: "busy", completion: { kind: "busy", reason: "turn-live" } });
    expect(h.setSending).not.toHaveBeenCalled();
  });

  it("reports a queue that landed", async () => {
    const enqueueMessage = vi.fn(async () => ({}));
    const h = handlers();
    const result = await submitWebuiComposerTurn(
      {
        draft: "hello",
        sessionId: "s1",
        sending: true,
        deps: { sendMessage },
        enqueueMessage,
      },
      h,
    );
    expect(result).toMatchObject({ decision: "queued", completion: { kind: "queued", sessionId: "s1" } });
    expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", content: "hello" }));
    expect(h.onQueued).toHaveBeenCalled();
  });

  it("reports a refused queue as failed, which the baseline swallowed", async () => {
    const enqueueMessage = vi.fn(async () => {
      throw new Error("synthetic queue refusal");
    });
    const h = handlers();
    const result = await submitWebuiComposerTurn(
      {
        draft: "hello",
        sessionId: "s1",
        sending: true,
        deps: { sendMessage },
        enqueueMessage,
      },
      h,
    );
    expect(result).toMatchObject({
      decision: "failed",
      completion: { kind: "failed", error: "synthetic queue refusal" },
    });
    expect(h.setRefusal).toHaveBeenCalledWith("synthetic queue refusal");
    // The enqueue never landed, so nothing may claim it was queued.
    expect(h.onQueued).not.toHaveBeenCalled();
  });

  it("numbers its operations, so a transition can be correlated", async () => {
    const first = await submitWebuiComposerTurn(
      { draft: "hello", sending: false, deps: {} },
      handlers(),
    );
    const second = await submitWebuiComposerTurn(
      { draft: "hello", sending: false, deps: {} },
      handlers(),
    );
    expect(first?.id).toBeGreaterThan(0);
    expect(second?.id).toBeGreaterThan(first?.id ?? 0);
  });
});
