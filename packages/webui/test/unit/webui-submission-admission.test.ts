// The submission admission rule.
//
// Every case here is a fact the Composer's `submitWebuiComposerTurn` already decided at `4fce25f2`,
// plus the reservation, which is the one rule that is new. Pinning them is what makes the later switch
// checkable: if the baseline's ordering is wrong here, the cutover would change behaviour while looking
// like a move.

import { describe, expect, it } from "vitest";

import {
  decideWebuiSubmissionAdmission,
  webuiSubmissionRefusalFor,
} from "../../src/client/features/turn/application/submission-admission.js";
import type {
  WebuiSubmissionAdmissionState,
  WebuiSubmissionDecision,
} from "../../src/client/features/turn/contracts/submission.js";

/** The shape every case varies from: an idle, fully capable client with a target session. */
const IDLE: WebuiSubmissionAdmissionState = {
  hasSession: true,
  canCreateSession: true,
  canSend: true,
  canEnqueue: true,
  turnLive: false,
  creating: false,
};

const decide = (overrides: Partial<WebuiSubmissionAdmissionState>): WebuiSubmissionDecision =>
  decideWebuiSubmissionAdmission({ ...IDLE, ...overrides });

describe("the admission rule preserves the baseline's order", () => {
  it("refuses an incapable client before it would create anything", () => {
    // `!args.deps.sendMessage && !args.enqueueMessage` was the function's first guard, so a creator
    // alone never rescued a submission that had no way to deliver its message.
    expect(decide({ canSend: false, canEnqueue: false, hasSession: false })).toBe("unsupported");
    expect(decide({ canSend: false, canEnqueue: false, hasSession: false, creating: true })).toBe(
      "unsupported",
    );
  });

  it("asks for a session when the home has no creator", () => {
    // The baseline called `onNeedsSession(args.draft)`.
    expect(decide({ hasSession: false, canCreateSession: false })).toBe("needs-session");
  });

  it("dispatches a home submission that can create its session", () => {
    expect(decide({ hasSession: false })).toBe("dispatching");
  });

  it("queues onto a live turn without waiting for it to finish", () => {
    expect(decide({ turnLive: true })).toBe("queued");
  });

  it("is busy on a live turn it cannot queue onto", () => {
    // The baseline dropped this submission silently, after the `sending` branch's early return.
    expect(decide({ turnLive: true, canEnqueue: false })).toBe("busy");
  });

  it("does not treat a queue capability as a dispatch capability", () => {
    // The baseline reached `if (!args.deps.sendMessage) return;` and stopped there silently.
    expect(decide({ canSend: false })).toBe("unsupported");
  });
});

describe("D01: single-flight home creation", () => {
  it("classifies the second submission while a creation is in flight as busy", () => {
    // Decided before any wire IO, and the input is untouched: the caller may keep it.
    expect(decide({ hasSession: false, creating: true })).toBe("busy");
  });

  it("lets the reservation win over the turn's own state", () => {
    // A creation in flight is not a live turn: nothing has been dispatched yet, so queueing would
    // queue onto a turn that does not exist.
    expect(decide({ turnLive: true, creating: true })).toBe("busy");
    expect(decide({ turnLive: false, creating: true })).toBe("busy");
  });

  it("returns to dispatching once the creation has settled", () => {
    // The reservation is per attempt, not sticky: the *next* submission may create again.
    expect(decide({ hasSession: false, creating: false })).toBe("dispatching");
  });
});

describe("the decision vocabulary", () => {
  it("is reachable in exactly the states the contract names", () => {
    const reachable = new Map<WebuiSubmissionDecision, Partial<WebuiSubmissionAdmissionState>>([
      ["dispatching", {}],
      ["queued", { turnLive: true }],
      ["needs-session", { hasSession: false, canCreateSession: false }],
      ["busy", { creating: true }],
      ["unsupported", { canSend: false, canEnqueue: false }],
    ]);
    for (const [decision, state] of reachable) expect(decide(state)).toBe(decision);
    // The two that are attempt outcomes, not admissions, cannot come out of this function.
    const outcomes: readonly WebuiSubmissionDecision[] = ["creation-failed", "failed"];
    for (const outcome of outcomes) {
      const produced: WebuiSubmissionDecision[] = [
        decide({}),
        decide({ turnLive: true }),
        decide({ hasSession: false, canCreateSession: false }),
        decide({ creating: true }),
        decide({ canSend: false, canEnqueue: false }),
      ];
      expect(produced).not.toContain(outcome);
    }
  });

  it("names a refusal only for the decisions that refuse", () => {
    expect(webuiSubmissionRefusalFor("busy")).toBe("busy");
    expect(webuiSubmissionRefusalFor("unsupported")).toBe("unsupported");
    expect(webuiSubmissionRefusalFor("needs-session")).toBe("needs-session");
    expect(webuiSubmissionRefusalFor("dispatching")).toBeUndefined();
    expect(webuiSubmissionRefusalFor("queued")).toBeUndefined();
    // A failed attempt is reported by the attempt, which has the error; the decision has none.
    expect(webuiSubmissionRefusalFor("failed")).toBeUndefined();
    expect(webuiSubmissionRefusalFor("creation-failed")).toBeUndefined();
  });
});
