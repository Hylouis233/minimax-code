import type { WebuiAttachmentInput } from "../../../../shared/contracts/messages.js";
import type { WebuiSubmissionTicket } from "./submission.js";
import type {
  WebuiStreamPhaseCommands,
  WebuiTurnLifecycleCommands,
} from "./turn-command-views.js";

export interface WebuiComposerTurnCallbacks {
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  /**
   * The session a first message created, with the use case's selection decision: the transfer and the
   * composer's slot move have already happened, and `selected` says whether the navigation claim that
   * started the creation is still current.
   */
  readonly onSessionCreated?: (sessionId: string, selected: boolean) => void;
  readonly onQueued?: () => void;
}

export interface WebuiTurnSendIntent {
  readonly message: string;
  readonly clientIntent?: string;
  readonly planMode?: boolean;
  readonly attachments?: readonly WebuiAttachmentInput[];
  readonly onAttachmentsSubmitted?: () => void;
  readonly callbacks: WebuiComposerTurnCallbacks;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
}

/** Commands exposed to a conversation surface by application composition. */
export interface WebuiConversationTurnCommands {
  /**
   * Submit a turn and get its ticket, or `undefined` when the intent carried
   * nothing to submit.
   *
   * The ticket is returned synchronously: its `admission` is already decided, and
   * its `completion` settles later and never rejects. A caller reads the decision
   * now and the outcome later, instead of awaiting a promise that carried both.
   */
  readonly send: (intent: WebuiTurnSendIntent) => WebuiSubmissionTicket | undefined;
  readonly attach: (turnId: string | undefined) => void;
  readonly recheck: (turnId: string | undefined) => void;
  readonly recover: () => void;
  readonly stop: () => Promise<void>;
  /**
   * The stream-phase and turn-lifecycle views for this target, built from the
   * owner's own record writer. A consumer handed one of them cannot reach the
   * other's writes, and neither can reach the store directly — and because the
   * owner builds them, a surface hands out no writer of its own and assembles no
   * second command context.
   */
  readonly phase: WebuiStreamPhaseCommands;
  readonly lifecycle: WebuiTurnLifecycleCommands;
}
