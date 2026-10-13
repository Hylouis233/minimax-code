// Composer capability port (plan §9; ticket #59).
//
// The queue's four members and the command runner. §9 assigns `runCommand` to
// `composer`, and §5.6 gives `composer` "the queue commands" while §4.12 keeps
// only the queue's *command* with `turn` and its *state* with `composer` — so
// the queue's own request/result members live here, with the business that owns
// the state they write.
//
// Every method stays optional — `undefined` means "the operation is not wired".

import type {
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiQueueItem,
} from "../../../shared/contracts/queue.js";

export type WebuiClientMessageEnqueuer = (
  request: WebuiEnqueueMessageRequest,
) => Promise<WebuiEnqueueMessageResult>;

export interface ComposerPort {
  readonly runCommand?: (request: {
    readonly command: "help" | "new" | "compact" | "status" | "usage" | "model";
    readonly input?: string;
    readonly sessionId?: string;
    readonly agentName?: string;
    readonly workspaceDir?: string;
  }) => Promise<Record<string, unknown>>;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly listQueueMessages?: (request: {
    readonly id: string;
  }) => Promise<{
    readonly items?: readonly WebuiQueueItem[];
    readonly paused?: boolean;
    readonly pendingCount?: number;
  }>;
  readonly deleteQueueItem?: (request: {
    readonly id: string;
    readonly itemId: string;
  }) => Promise<{ readonly item?: WebuiQueueItem }>;
}
