// The admission rule for one submission.
//
// This is the decision half of the execution owner: a pure function over the intent's target state,
// so the same rule can be asserted without a wire, a socket or a React tree. The order below is the
// order the Composer's `submitWebuiComposerTurn` applied at `4fce25f2`, with the creation reservation
// added as the first thing a second submission meets; each branch names the baseline it preserves.

import type {
  WebuiSubmissionAdmissionState,
  WebuiSubmissionDecision,
} from "../contracts/submission.js";

/**
 * Classify one submission.
 *
 * Order matters, and it is the baseline's:
 *
 * 1. **No transport** — a client that can neither dispatch nor queue reports `unsupported` *before*
 *    anything else, including before it would create a session. The baseline's guard was
 *    `!deps.sendMessage && !args.enqueueMessage` at the top of the function, so a creator alone did
 *    not rescue a submission that had no way to deliver it.
 * 2. **A creation already in flight** — `busy`. The second submission creates nothing and
 *    leaves the input alone. The reservation itself is not here: this reads the state the single-flight
 *    check maintains, and the check runs where the create is issued.
 * 3. **No session and no creator** — `needs-session`, the baseline's `onNeedsSession`.
 * 4. **No session with a creator** — `dispatching`: creation then send, one operation. A creation that
 *    returns an error closes it as `creation-failed`, which is an attempt outcome rather than a
 *    decision, so it is not in this function.
 * 5. **A live turn** — `queued` when the client can queue (without waiting for the turn to
 *    finish) and `busy` when it cannot. The baseline dropped the second case silently; the
 *    classification names it, and the presentation stays the caller's.
 * 6. **Otherwise** — `dispatching` when the client can dispatch, `unsupported` when it can only queue.
 *    The baseline returned silently for that last shape (`!args.deps.sendMessage` after the queue
 *    branch), and a queue capability is not a dispatch capability.
 */
export function decideWebuiSubmissionAdmission(
  state: WebuiSubmissionAdmissionState,
): WebuiSubmissionDecision {
  if (!state.canSend && !state.canEnqueue) return "unsupported";
  if (state.creating) return "busy";
  if (!state.hasSession) return state.canCreateSession ? "dispatching" : "needs-session";
  if (state.turnLive) return state.canEnqueue ? "queued" : "busy";
  return state.canSend ? "dispatching" : "unsupported";
}

/**
 * The refusal a decision implies, for the decisions that refuse. `undefined` for `dispatching` and
 * `queued`: those have not refused anything, and their completion comes from the attempt.
 */
export function webuiSubmissionRefusalFor(
  decision: WebuiSubmissionDecision,
): "busy" | "unsupported" | "needs-session" | undefined {
  if (decision === "busy" || decision === "unsupported" || decision === "needs-session")
    return decision;
  return undefined;
}
