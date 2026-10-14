// Goal capability port (plan §9; ticket #59).
//
// The goal entity: its enablement probe, its read, and create / patch / clear. §5.6
// gives `goal` the entity projection, the status and version, and the version fence —
// so the operations that move it are this business's, not the interaction
// coordinator's, whose third duty it used to be.
//
// Every method stays optional — `undefined` means "the operation is not wired".

import type { WebuiGoal, WebuiGoalCreateRequest, WebuiGoalEnabledResult, WebuiGoalPatchRequest, WebuiGoalSessionRequest } from "../../../../shared/contracts/goal.js";

export interface GoalPort {
  readonly isGoalEnabled?: () => Promise<WebuiGoalEnabledResult>;
  readonly getGoal?: (
    request: WebuiGoalSessionRequest,
  ) => Promise<WebuiGoal | undefined>;
  readonly createGoal?: (request: WebuiGoalCreateRequest) => Promise<WebuiGoal>;
  readonly patchGoal?: (request: WebuiGoalPatchRequest) => Promise<WebuiGoal>;
  readonly clearGoal?: (
    request: WebuiGoalSessionRequest,
  ) => Promise<{ readonly success: boolean }>;
}
