import type {WebuiClientMessageEnqueuer} from "../contracts/command-port.js";
import type {
  WebuiComposerSubmitArgs,
  WebuiComposerSubmitHandlers,
} from "../contracts/composer-turn.js";
import {
  createdWebuiSessionId,
  type WebuiClientSessionCreator,
} from "../../sessions/contracts/session-port.js";
import type { WebuiGoal, WebuiGoalCreateRequest, WebuiGoalPatchRequest } from "../../../../shared/contracts/goal.js";
import type { WebuiAttachmentInput } from "../../../../shared/contracts/messages.js";
import { formatWebuiError } from "../../../contracts/value-readers.js";
import { looksLikeAbsoluteWorkspacePath } from "../../../projection/common/paths.js";
import { queueWebuiTurn } from "../../turn/application/queue-command.js";
import { ownsWebuiStreamGeneration, type WebuiStreamState } from "../../turn/projection/stream-state.js";
import { runWebuiStreamLoop, type WebuiStreamLoopDeps } from "../../../conversation/stream-loop.js";
import type { WebuiStreamLoopSink } from "../../turn/contracts/stream-loop.js";
import { streamRecoveryProjection } from "../../turn/projection/stream-recovery.js";
import { streamStateBundle } from "../../turn/application/stream-state-bundle.js";

export function buildWebuiComposerHandlers(args: WebuiComposerSubmitHandlers): WebuiComposerSubmitHandlers {
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

export interface WebuiGoalSubmitArgs {
  readonly sessionId?: string;
  readonly objective: string;
  readonly currentGoal?: WebuiGoal;
  readonly createGoal: (request: WebuiGoalCreateRequest) => Promise<WebuiGoal>;
  readonly patchGoal?: (request: WebuiGoalPatchRequest) => Promise<WebuiGoal>;
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
  /** Resolve the target session owner after a home submission creates it. */
  readonly resolveGoal?: (sessionId: string) => Pick<WebuiGoalSubmitArgs, "currentGoal" | "createGoal" | "patchGoal">;
}

function createSessionWorkspaceField(workspaceDir?: string): { readonly workspaceDir?: string } {
  if (workspaceDir === undefined) return {};
  const value = workspaceDir.trim();
  if (!value) throw new Error("项目目录不能为空，请重新选择项目目录");
  if (!looksLikeAbsoluteWorkspacePath(value))
    throw new Error(`项目目录需要绝对路径，收到的是「${value}」。请重新选择项目目录`);
  return { workspaceDir: value };
}

export async function submitWebuiGoal(
  args: WebuiGoalSubmitArgs,
  onSessionCreated?: (sessionId: string) => void,
): Promise<WebuiGoal> {
  const objective = args.objective.trim();
  if (!objective) throw new Error("目标内容不能为空");
  let sessionId = args.sessionId;
  if (!sessionId) {
    if (!args.createSession) throw new Error("无法创建目标会话");
    const result = await args.createSession({
      name: "main",
      ...createSessionWorkspaceField(args.createSessionWorkspaceDir),
      teamModeOff: args.teamModeOff,
    });
    sessionId = createdWebuiSessionId(result);
    if (!sessionId) throw new Error("创建目标会话未返回会话 ID");
    onSessionCreated?.(sessionId);
  }
  const resolved = args.resolveGoal?.(sessionId) ?? args;
  if (resolved.currentGoal && resolved.patchGoal) return resolved.patchGoal({ sessionId, objective });
  return resolved.createGoal({ sessionId, objective });
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
