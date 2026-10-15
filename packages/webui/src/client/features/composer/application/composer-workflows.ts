// The goal submission (plan §5.5 P01 step 4 moves it into Goal's own application module; until then it
// is the one workflow Composer still owns here).
//
// The composer turn's submission, its handler bundle and the creation-field validation are Turn's now
// (P02 step 3): execution is the substrate's business, and it may not reach back into this one.

import {
  createdWebuiSessionId,
  type WebuiClientSessionCreator,
} from "../../sessions/contracts/session-port.js";
import type { WebuiGoal, WebuiGoalCreateRequest, WebuiGoalPatchRequest } from "../../../../shared/contracts/goal.js";
import { createSessionWorkspaceField } from "../../turn/application/composer-submission.js";

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
