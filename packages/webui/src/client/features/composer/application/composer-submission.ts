import type { WebuiSubmissionIntent } from "../projection/composer-state.js";
import type { WebuiConversationTurnCommands } from "../../turn/contracts/turn-commands.js";

/** Translate a controller command to the existing turn command contract. */
export function submitWebuiComposerTurnCommand(
  deps: Pick<WebuiComposerTurnSubmissionDeps, "turnCommandsFor">,
  sessionId: string | undefined,
  request: Parameters<WebuiConversationTurnCommands["send"]>[0],
): Promise<void> {
  return deps.turnCommandsFor(sessionId).send(request);
}

interface WebuiComposerTurnSubmissionDeps {
  readonly turnCommandsFor: (sessionId: string | undefined) => WebuiConversationTurnCommands;
}

/** Whether intent resolution records this input before its command settles. */
export function shouldRecordWebuiComposerSubmission(intent: WebuiSubmissionIntent | undefined): boolean {
  return intent?.kind === "submit-turn" || intent?.kind === "submit-goal" || intent?.kind === "run-command";
}
