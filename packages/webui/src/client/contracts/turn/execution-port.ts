// Turn execution capability port (plan §9; ticket #59).
//
// The substrate's four execution members. §9 splits the former monolithic
// `client/contracts/execution-port.ts` three ways: these four stay with `turn`,
// `runCommand` and the queue members go to `composer/` (`ComposerPort`), and the
// process-event watcher goes to `shell/` (`ShellEventPort`).
//
// `sendMessage` and `resumeSession` are the two members §9 names for the
// substrate. `abortSession` and `getActiveTurn` are assigned here too, because
// §4.12 gives `turn` "the in-flight read (`readStream`, the active-turn probe)"
// and "the turn commands (attach/send/stop/retry)" — the stop command's
// capability is `abortSession`.
//
// Every method stays optional — `undefined` means "the operation is not wired".

import type { WebuiAttachmentInput } from "../../../shared/contracts/messages.js";
import type {
  WebuiActiveTurnRequest,
  WebuiActiveTurnResult,
} from "../../../shared/contracts/session.js";
import type { WebuiStreamFrame } from "../../../shared/contracts/stream.js";

export type WebuiClientMessageSender = (
  request: {
    readonly id: string;
    readonly content: string;
    readonly clientIntent?: string;
    readonly attachments?: readonly WebuiAttachmentInput[];
  },
  onFrame: (frame: WebuiStreamFrame) => void,
) => Promise<void>;

export type WebuiClientSessionResumer = (
  request: {
    readonly id: string;
    readonly afterCursor?: string;
    readonly afterMsgId?: string;
    readonly drainQueued?: boolean;
  },
  onFrame: (frame: WebuiStreamFrame) => void,
) => Promise<void>;

export interface TurnExecutionPort {
  readonly sendMessage?: WebuiClientMessageSender;
  readonly resumeSession?: WebuiClientSessionResumer;
  /**
   * Authoritative active-turn read. Answers "is a turn running, and which
   * one" when the `session.start` event was missed or arrived before the
   * client finished subscribing.
   */
  readonly getActiveTurn?: (
    request: WebuiActiveTurnRequest,
  ) => Promise<WebuiActiveTurnResult>;
  readonly abortSession?: (request: {
    readonly id: string;
  }) => Promise<{ readonly success?: boolean }>;
}
