// The composer's submission, executed (plan §5.5 P02 step 3: "`submitWebuiComposerTurn`,
// `buildWebuiComposerHandlers` leave" Composer).
//
// It lives here because execution does: the substrate that dispatches a turn is Turn's, and it may not
// reach back into Composer's application modules to do it. Composer keeps what is Composer's — slash,
// goal and plan intent, the draft and history, attachment staging, the queue presentation, resend
// eligibility — and the intent it hands over arrives as `WebuiComposerSubmitArgs`.
//
// The admission rule this path applies is `submission-admission.ts`, and what it reads is
// `execution-target.ts`. Until the owner integrates them, the order below is the order this function
// had while it was Composer's, so the move changes no behaviour.

import type {
  WebuiComposerSubmitArgs,
  WebuiComposerSubmitHandlers,
} from "../../composer/contracts/composer-turn.js";
import {
  createdWebuiSessionId,
} from "../../sessions/contracts/session-port.js";
import { formatWebuiError } from "../../../contracts/value-readers.js";
import { looksLikeAbsoluteWorkspacePath } from "../../../projection/common/paths.js";
import { queueWebuiTurn } from "./queue-command.js";
import { ownsWebuiStreamGeneration } from "../projection/stream-state.js";
import { runWebuiStreamLoop } from "../../../conversation/stream-loop.js";
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

/**
 * The `workspaceDir` a creation carries, validated. It lives with the submission rather than with the
 * Composer because Turn may not depend on Composer's application modules, and the goal path that also
 * needs it (until P01 step 4 moves that path to Goal) imports it from here.
 */
export function createSessionWorkspaceField(workspaceDir?: string): { readonly workspaceDir?: string } {
  if (workspaceDir === undefined) return {};
  const value = workspaceDir.trim();
  if (!value) throw new Error("项目目录不能为空，请重新选择项目目录");
  if (!looksLikeAbsoluteWorkspacePath(value))
    throw new Error(`项目目录需要绝对路径，收到的是「${value}」。请重新选择项目目录`);
  return { workspaceDir: value };
}

export async function submitWebuiComposerTurn(
  args: WebuiComposerSubmitArgs,
  handlers: WebuiComposerSubmitHandlers,
): Promise<void> {
  const message = (args.message ?? args.draft).trim();
  const attachments = args.attachments ?? [];
  if ((!message && attachments.length === 0) || (!args.deps.sendMessage && !args.enqueueMessage)) return;
  let sessionId = args.sessionId;
  if (!sessionId) {
    if (!args.createSession) {
      handlers.onNeedsSession?.(args.draft);
      return;
    }
    try {
      const result = await args.createSession({
        name: "main",
        ...createSessionWorkspaceField(args.createSessionWorkspaceDir),
        teamModeOff: args.teamModeOff,
      });
      sessionId = createdWebuiSessionId(result);
      if (!sessionId) throw new Error("createSession response did not include a session id");
      handlers.resetStreamForTurn();
      handlers.onSessionCreated?.(sessionId);
    } catch (error) {
      handlers.setRefusal(formatWebuiError(error));
      return;
    }
  }
  if (args.sending) {
    if (!args.enqueueMessage) return;
    await queueWebuiTurn({
      sessionId,
      message,
      ...(args.clientIntent ? { clientIntent: args.clientIntent } : {}),
      ...(attachments.length ? { attachments } : {}),
      enqueueMessage: args.enqueueMessage,
      onDraftChange: handlers.onDraftChange,
      onAttachmentsSubmitted: args.onAttachmentsSubmitted,
      onQueued: handlers.onQueued,
      setRefusal: (refusal) => handlers.setRefusal(refusal),
    });
    return;
  }
  if (!args.deps.sendMessage) return;
  handlers.setSending(true);
  handlers.onDraftChange("");
  args.onAttachmentsSubmitted?.();
  handlers.resetStreamForTurn();
  let claimed: number | undefined;
  try {
    claimed = await runWebuiStreamLoop(
      { ...args.deps, projection: streamRecoveryProjection, streamState: streamStateBundle },
      { sessionId, message, ...(args.clientIntent ? { clientIntent: args.clientIntent } : {}), ...(attachments.length ? { attachments } : {}) },
      handlers.createSink(),
    );
  } finally {
    const current = handlers.readStream?.();
    if (current === undefined || ownsWebuiStreamGeneration(current, claimed)) handlers.setSending(false);
  }
}
