import type { WebuiQueueItem } from "../../../../shared/contracts/queue.js";
import type { WebuiComposerAttachment, WebuiComposerUrlReference, WebuiMentionRange } from "./composer-interactions.js";
import type { WebuiRecordedTurn } from "./composer-turn.js";

export interface WebuiComposerPersisted {
  readonly drafts: Readonly<Record<string, string>>;
  readonly history: Readonly<Record<string, readonly string[]>>;
}

export interface WebuiComposerQueueState {
  readonly items: readonly WebuiQueueItem[];
  readonly paused: boolean;
}

export interface WebuiComposerStagingState {
  readonly attachments: readonly WebuiComposerAttachment[];
  readonly urlReferences: readonly WebuiComposerUrlReference[];
  readonly busy: boolean;
  readonly seedToken?: string;
}

export interface WebuiComposerModes {
  readonly goal: boolean;
  readonly plan: boolean;
}

export interface WebuiComposerSnapshot extends WebuiComposerPersisted {
  readonly queue: WebuiComposerQueueState;
  readonly staging: WebuiComposerStagingState;
  readonly modes: WebuiComposerModes;
  readonly retry: WebuiRecordedTurn | undefined;
  readonly mentionRange: WebuiMentionRange | undefined;
}
