import type { WebuiAttachmentInput } from "../../../../shared/contracts/messages.js";
import type { WebuiClientSessionCreator } from "../../sessions/contracts/session-port.js";
import type {
  WebuiStreamLoopSink,
  WebuiStreamLoopTransports,
} from "../../turn/contracts/stream-loop.js";
import type { WebuiStreamState } from "../../turn/contracts/stream-state.js";
import type { WebuiClientMessageEnqueuer } from "./command-port.js";

export interface WebuiRecordedTurn {
  readonly session: string | undefined;
  readonly message: string;
}

export interface WebuiComposerSubmitArgs {
  readonly sessionId?: string;
  readonly draft: string;
  readonly message?: string;
  readonly clientIntent?: string;
  readonly attachments?: readonly WebuiAttachmentInput[];
  readonly onAttachmentsSubmitted?: () => void;
  readonly sending: boolean;
  /**
   * The transports the turn's loop drives. It is the loop's transport half, not
   * its whole dependency object: the two injected transforms are the caller's to
   * supply, and this workflow supplies them itself.
   */
  readonly deps: WebuiStreamLoopTransports;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
}

export interface WebuiComposerSubmitHandlers {
  /**
   * A fresh, generation-fenced sink for this turn's stream loop. The caller
   * never receives the stream writer itself, so no caller can write a slice
   * field directly or skip the fence.
   */
  readonly createSink: () => WebuiStreamLoopSink;
  /** Reset the stream slice for a turn that is about to open. */
  readonly resetStreamForTurn: () => void;
  /** Record (or clear) the refusal the transcript banner renders. */
  readonly setRefusal: (refusal: string | undefined) => void;
  readonly readStream?: () => WebuiStreamState;
  readonly setSending: (sending: boolean) => void;
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onSessionCreated?: (sessionId: string) => void;
  readonly onQueued?: () => void;
}
