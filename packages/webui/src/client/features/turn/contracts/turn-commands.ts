import type { WebuiAttachmentInput } from "../../../../shared/contracts/messages.js";
import type { WebuiSubmissionOperation } from "./submission.js";

export interface WebuiComposerTurnCallbacks {
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onSessionCreated?: (sessionId: string) => void;
  readonly onQueued?: () => void;
}

export interface WebuiTurnSendIntent {
  readonly message: string;
  readonly clientIntent?: string;
  readonly planMode?: boolean;
  readonly attachments?: readonly WebuiAttachmentInput[];
  readonly onAttachmentsSubmitted?: () => void;
  readonly sending: boolean;
  readonly callbacks: WebuiComposerTurnCallbacks;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
}

/** Commands exposed to a conversation surface by application composition. */
export interface WebuiConversationTurnCommands {
  /**
   * The submission's semantic transition, or `undefined` when the intent carried nothing to submit.
   * A refusal is a value rather than a rejection (plan §5.5 P02 step 4), so the caller can report it
   * and keep going.
   */
  readonly send: (intent: WebuiTurnSendIntent) => Promise<WebuiSubmissionOperation | undefined>;
  readonly attach: (turnId: string | undefined) => void;
  readonly recheck: (turnId: string | undefined) => void;
  readonly recover: () => void;
  readonly stop: () => Promise<void>;
}
