// The composer's submission, executed.
//
// It lives here because execution does: the substrate that dispatches a turn is Turn's, and it may not
// reach back into Composer's application modules to do it. Composer keeps what is Composer's — slash,
// goal and plan intent, the draft and history, attachment staging, the queue presentation, resend
// eligibility — and the intent it hands over arrives as `WebuiComposerSubmitArgs`.
//
// The submission now *reports* what it decided. Every callback it already called fires exactly as
// before, so this is additive to the callers that still read them; the returned operation is what the
// Composer will consume instead, and it is the honest classification of what happened rather
// than a prediction: the branch produces the completion and the decision is derived from it.

import type {
  WebuiComposerSubmitArgs,
  WebuiComposerSubmitHandlers,
} from "../../composer/contracts/composer-turn.js";
import {
  createdWebuiSessionId,
} from "../../sessions/contracts/session-port.js";
import { formatWebuiError } from "../../../contracts/value-readers.js";
import { readWorkspaceDirField } from "../../../projection/common/paths.js";
import type {
  WebuiSubmissionCompletion,
  WebuiSubmissionDecision,
  WebuiSubmissionOperation,
} from "../contracts/submission.js";
import { queueWebuiTurn } from "./queue-command.js";
import { ownsWebuiStreamGeneration } from "../projection/stream-state.js";
import { runWebuiStreamLoop } from "../../../conversation/stream-loop.js";
import { classifyStreamFrame } from "./stream-frame-classify.js";
import { streamRecoveryProjection } from "../projection/stream-recovery.js";
import { streamStateBundle } from "./stream-state-bundle.js";

export function buildWebuiComposerHandlers(
  args: WebuiComposerSubmitHandlers,
): WebuiComposerSubmitHandlers {
  return {
    createSink: args.createSink,
    resetStreamForTurn: args.resetStreamForTurn,
    setRefusal: args.setRefusal,
    ...(args.readStream ? { readStream: args.readStream } : {}),
    setSending: args.setSending,
    onDraftChange: args.onDraftChange,
    onNeedsSession: args.onNeedsSession,
    onSessionCreated: args.onSessionCreated,
    onQueued: args.onQueued,
  };
}

/** Operation ids are process-local and monotonic: they correlate a submission with its transition. */
let nextSubmissionId = 0;

/**
 * The decision a completion *is*, so the two can never disagree. `dispatching` and `queued` describe an
 * operation on its way; the rest describe one that did not happen, and the completion carries why.
 *
 * A completion that is not listed here cannot be produced by this module, and the case is exhaustive on
 * purpose: adding a completion kind without classifying it stops compiling.
 */
function decideFor(completion: WebuiSubmissionCompletion): WebuiSubmissionDecision {
  switch (completion.kind) {
    case "dispatched":
      return "dispatching";
    case "queued":
      return "queued";
    case "needs-session":
      return "needs-session";
    case "creation-failed":
      return "creation-failed";
    case "failed":
      return "failed";
    case "busy":
      return "busy";
    case "unsupported":
      return "unsupported";
  }
}

export async function submitWebuiComposerTurn(
  args: WebuiComposerSubmitArgs,
  handlers: WebuiComposerSubmitHandlers,
): Promise<WebuiSubmissionOperation | undefined> {
  const message = (args.message ?? args.draft).trim();
  const attachments = args.attachments ?? [];
  // Nothing to submit is not a refusal, so it is not an operation: the vocabulary in
  // `contracts/submission.ts` covers what a submission *decided*, and an empty intent never reached a
  // decision. The caller's guard produced exactly this no-op before.
  if (!message && attachments.length === 0) return undefined;
  const record = (completion: WebuiSubmissionCompletion): WebuiSubmissionOperation => ({
    id: ++nextSubmissionId,
    decision: decideFor(completion),
    completion,
  });
  if (!args.deps.sendMessage && !args.enqueueMessage) {
    // The baseline returned silently here, before it would have created anything: a creator alone is
    // not a way to deliver a message.
    return record({ kind: "unsupported", missing: "transport" });
  }

  let sessionId = args.sessionId;
  let created = false;
  if (!sessionId) {
    const submitTask = args.submitTask;
    if (!submitTask) {
      handlers.onNeedsSession?.(args.draft);
      return record({ kind: "needs-session" });
    }
    let workspaceDir: string | undefined;
    try {
      workspaceDir = readWorkspaceDirField(args.createSessionWorkspaceDir);
    } catch (error) {
      const message = formatWebuiError(error);
      handlers.setRefusal(message);
      return record({ kind: "creation-failed", error: message });
    }
    // The creation is the task use case's: it is single-flight per home incarnation, it
    // transfers the home record onto the created session under the destination-wins and purge guards,
    // it moves the composer's home slot and it refreshes the catalogue. Nothing here resets the
    // stream after a create — that reset is what made an adopted destination unsafe, and the
    // transferred record is the destination's now.
    const outcome = await submitTask.submit({
      name: "main",
      ...(workspaceDir === undefined ? {} : { workspaceDir }),
      ...(args.teamModeOff === undefined ? {} : { teamModeOff: args.teamModeOff }),
    });
    if (outcome.kind === "unsupported") {
      // The host cannot create at all, which is the baseline's `onNeedsSession`: the user is asked for
      // a session rather than told a capability is missing. (A missing *transport* is the other
      // refusal, and it is checked before this branch.)
      handlers.onNeedsSession?.(args.draft);
      return record({ kind: "needs-session" });
    }
    if (outcome.kind === "busy") return record({ kind: "busy", reason: "creating" });
    if (outcome.kind === "creation-failed") {
      handlers.setRefusal(outcome.error);
      return record({ kind: "creation-failed", error: outcome.error });
    }
    sessionId = outcome.sessionId;
    created = true;
    handlers.onSessionCreated?.(sessionId, outcome.selected);
  }
  if (args.sending) {
    if (!args.enqueueMessage) {
      // A live turn with nowhere to queue: the submission is refused, and the caller may keep the
      // input. The baseline dropped it in silence.
      return record({ kind: "busy", reason: "turn-live" });
    }
    // The enqueue reports its own failure through a refusal; capturing it is what lets the operation
    // say `failed` instead of `queued` for a write that never landed.
    let refusal: string | undefined;
    await queueWebuiTurn({
      sessionId,
      message,
      ...(args.clientIntent ? { clientIntent: args.clientIntent } : {}),
      ...(attachments.length ? { attachments } : {}),
      enqueueMessage: args.enqueueMessage,
      onDraftChange: handlers.onDraftChange,
      onAttachmentsSubmitted: args.onAttachmentsSubmitted,
      onQueued: handlers.onQueued,
      setRefusal: (next) => {
        refusal = next;
        handlers.setRefusal(next);
      },
    });
    return refusal === undefined
      ? record({ kind: "queued", sessionId })
      : record({ kind: "failed", error: refusal });
  }
  if (!args.deps.sendMessage) return record({ kind: "unsupported", missing: "transport" });
  handlers.setSending(true);
  handlers.onDraftChange("");
  args.onAttachmentsSubmitted?.();
  handlers.resetStreamForTurn();
  let claimed: number | undefined;
  try {
    claimed = await runWebuiStreamLoop(
      { ...args.deps, classify: classifyStreamFrame },
      { sessionId, message, ...(args.clientIntent ? { clientIntent: args.clientIntent } : {}), ...(attachments.length ? { attachments } : {}) },
      handlers.createSink(),
    );
  } finally {
    const current = handlers.readStream?.();
    if (current === undefined || ownsWebuiStreamGeneration(current, claimed)) handlers.setSending(false);
  }
  // A dispatch that rejects still rejects: the loop's own error path is the caller's today, and the
  // owner makes it a `failed` completion when it takes the callbacks over.
  return record({ kind: "dispatched", sessionId, created });
}
