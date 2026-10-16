// Purpose-named domain commands for the migrated execution state.
//
// The session store owns the session record — the live stream, the `sending`
// flag, the pending permissions, the questionnaire and the goal — and every
// write to it is one of the named changes below, never a raw setter call from a
// component.
//
// What is left here is the slice Sessions actually owns: the **pending
// interactions**. Naming alone does not narrow authority, so the surface carries
// no reducer-taking writer: a command that accepted `(current) => next` would let
// a component rewrite any field of the slice and walk straight around the
// generation fence the owner applies. The stream-phase and turn-lifecycle views,
// and the writer a turn's sink is built from, are the execution substrate's and
// live in `features/turn/application/` — a component submits a command instead
// of holding and calling a store writer, whichever of those views it holds.

import type { WebuiGoal } from "../../../../shared/contracts/goal.js";
import type {
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
} from "../../../../shared/contracts/interactions.js";

/** The write targets the interaction commands are bound to. */
export interface WebuiInteractionCommandTargets {
  readonly setPermissions: (
    update: (
      current: readonly WebuiPendingPermission[],
    ) => readonly WebuiPendingPermission[],
  ) => void;
  readonly setQuestionnaire: (
    value:
      | WebuiQuestionnaireRequest
      | undefined
      | ((
          current: WebuiQuestionnaireRequest | undefined,
        ) => WebuiQuestionnaireRequest | undefined),
  ) => void;
  readonly setGoal: (goal: WebuiGoal | undefined) => void;
}

export interface WebuiInteractionCommands {
  /** A fresh read of the pending permissions replaces the current list. */
  readonly replacePendingPermissions: (
    permissions: readonly WebuiPendingPermission[],
  ) => void;
  /** Answering one permission drops exactly that request. */
  readonly removePendingPermission: (requestId: string) => void;
  /** Apply or clear the pending questionnaire. */
  readonly applyQuestionnaire: (
    request: WebuiQuestionnaireRequest | undefined,
  ) => void;
  /** Apply or clear the session goal. */
  readonly applyGoal: (goal: WebuiGoal | undefined) => void;
}

export function createWebuiInteractionCommands(
  targets: WebuiInteractionCommandTargets,
): WebuiInteractionCommands {
  const { setPermissions, setQuestionnaire, setGoal } = targets;
  return {
    replacePendingPermissions: (permissions) =>
      setPermissions(() => permissions),
    removePendingPermission: (requestId) =>
      setPermissions((current) =>
        current.filter((item) => item.requestId !== requestId),
      ),
    applyQuestionnaire: (request) => setQuestionnaire(request),
    applyGoal: (goal) => setGoal(goal),
  };
}
