// The application composer store (plan §7.1 `application/composer-store.ts`;
// §7.6 "Draft"; ticket #49 criterion 5).
//
// The composer's per-session drafts and input history used to live in the
// shell's own `useState`, with a hand-written updater that read the current
// key off a ref, persisted and pruned. That is one owner too many: the draft is
// application state — it survives a session switch and a silent home→session
// creation — so it belongs beside the session store, not inside the React tree.
//
// This store is that owner. It holds the one `WebuiComposerPersisted` value,
// persists it through the existing `composer-history` rules (same key, same
// prune, same byte caps) and notifies subscribers. The shell subscribes and
// submits named changes; it holds no `setState` and no updater for it.
//
// `adoptHome` is the composer half of home→session adoption. The session half
// lives on the session store (`migrateSession`); the composition root runs both
// in one committed transition (`create-application.ts`).

import {
  migrateWebuiHomeComposerState,
  parseWebuiComposerPersisted,
  recordWebuiInputHistory,
  serializeWebuiComposerPersisted,
  type WebuiComposerPersisted,
} from "../projection/composer-history.js";

import type { WebuiQueueItem } from "../../shared/contracts/queue.js";
import type {
  WebuiComposerAttachment,
  WebuiComposerUrlReference,
} from "../projection/composer-interactions.js";
import type { WebuiRecordedTurn } from "../projection/composer-state.js";

export interface WebuiComposerPersistence {
  readonly loadComposer: <T>(parse: (raw: string | null | undefined) => T) => T;
  readonly saveComposer: <T>(state: T, serialize: (state: T, keepKeys?: readonly string[]) => string, keepKeys?: readonly string[]) => void;
}

/**
 * The live queue mirror (§4.2 field 1: "the queue's state (`queueItems`,
 * `queuePaused` — component-local today)"). It is the composer's state, but it is
 * **not** persisted and **not** per-slot: unlike the draft it does not survive a
 * session switch, and the composer that renders it is a single instance. Keying it
 * by session would make switching back resurrect a stale list, which is a behaviour
 * change, not a reorganisation.
 */
export interface WebuiComposerQueueState {
  readonly items: readonly WebuiQueueItem[];
  readonly paused: boolean;
}

export const WEBUI_COMPOSER_EMPTY_QUEUE: WebuiComposerQueueState = {
  items: [],
  paused: false,
};

/**
 * The staged attachments and URL references, with the upload's in-flight flag and
 * the seed guard that keeps one memory-handoff attachment from being staged twice
 * (§5.6 lists attachments and url references as the composer's own state).
 *
 * Live, like the queue, and for the same reason: one composer instance is mounted
 * at a time, so a single field reproduces exactly what the component's own state
 * did — including surviving a session switch, which today's component state also
 * does because nothing remounts it.
 */
export interface WebuiComposerStagingState {
  readonly attachments: readonly WebuiComposerAttachment[];
  readonly urlReferences: readonly WebuiComposerUrlReference[];
  readonly busy: boolean;
  readonly seedToken?: string;
}

/**
 * The composer's input modes (§4.2 field 1 lists them with the owned state; §5.6's
 * may-write cell calls the pair "toolbar state"). Live, like the queue and the
 * staging.
 */
export interface WebuiComposerModes {
  readonly goal: boolean;
  readonly plan: boolean;
}

export const WEBUI_COMPOSER_EMPTY_MODES: WebuiComposerModes = {
  goal: false,
  plan: false,
};

export const WEBUI_COMPOSER_EMPTY_STAGING: WebuiComposerStagingState = {
  attachments: [],
  urlReferences: [],
  busy: false,
};

/**
 * What a subscriber sees: the persisted slots plus the live queue. One store, one
 * subscription — the queue rides the snapshot rather than getting a second channel,
 * because two subscriptions to one owner is the arrangement this programme forbids.
 */
export interface WebuiComposerSnapshot extends WebuiComposerPersisted {
  readonly queue: WebuiComposerQueueState;
  readonly staging: WebuiComposerStagingState;
  readonly modes: WebuiComposerModes;
  /**
   * The last submitted turn, so the retry affordance can re-send it without
   * asking the server what was asked (§4.2 field 1: the retry record).
   */
  readonly retry: WebuiRecordedTurn | undefined;
}

export interface WebuiComposerStore {
  /**
   * The current state; stable until something changes, so it is safe as a
   * `useSyncExternalStore` snapshot.
   */
  readonly getSnapshot: () => WebuiComposerSnapshot;
  /** Subscribe to changes. Returns a detach. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The draft text for one slot, or the empty string. */
  readonly readDraft: (key: string) => string;
  /** The input history for one slot, newest last. */
  readonly readHistory: (key: string) => readonly string[];
  /**
   * Set or clear one slot's draft, persisting and keeping the slot alive
   * through the prune.
   */
  readonly setDraft: (key: string, draft: string) => void;
  /** Record one committed submission into a slot's history. */
  readonly recordInput: (key: string, text: string) => void;
  /**
   * Move the home slot's draft and history onto a freshly created session key.
   * The composer half of home→session adoption.
   */
  readonly adoptHome: (targetKey: string) => void;
  /**
   * Drop both the draft and the input history for one slot. Called by the
   * session workflow after a successful delete, so a removed session does not
   * re-emerge with a stale draft or replay history.
   */
  readonly purgeSlot: (key: string) => void;
  /** The live queue mirror. */
  readonly readQueue: () => WebuiComposerQueueState;
  /** The staged attachments and url references. */
  readonly readStaging: () => WebuiComposerStagingState;
  /** The input modes. */
  readonly readModes: () => WebuiComposerModes;
  readonly setModes: (
    next:
      | Partial<WebuiComposerModes>
      | ((current: WebuiComposerModes) => Partial<WebuiComposerModes>),
  ) => void;
  /**
   * The retry record. Read it from here rather than from a second holder: the
   * retry handler needs the value that is current *now*, not the one the last
   * render saw, and this returns it synchronously.
   */
  readonly readRetry: () => WebuiRecordedTurn | undefined;
  readonly setRetry: (next: WebuiRecordedTurn | undefined) => void;
  /**
   * Replace part of the staging. A function receives the current state, so a
   * caller that removes one attachment hands back the array it received.
   */
  readonly setStaging: (
    next:
      | Partial<WebuiComposerStagingState>
      | ((current: WebuiComposerStagingState) => Partial<WebuiComposerStagingState>),
  ) => void;
  /**
   * Replace the live queue mirror. A partial update keeps the other half; a
   * function receives the current state, so a caller that removes one item does
   * not have to read the snapshot first.
   */
  readonly setQueue: (
    next:
      | Partial<WebuiComposerQueueState>
      | ((current: WebuiComposerQueueState) => Partial<WebuiComposerQueueState>),
  ) => void;
}

export function createWebuiComposerStore(options?: {
  /** Seed for SSR / tests; never a second load of storage. */
  readonly initial?: WebuiComposerPersisted;
  /** Persistence is injected by the browser composition root. */
  readonly storage?: WebuiComposerPersistence;
}): WebuiComposerStore {
  let state = options?.initial ?? options?.storage?.loadComposer(parseWebuiComposerPersisted) ?? { drafts: {}, history: {} };
  let queue = WEBUI_COMPOSER_EMPTY_QUEUE;
  let staging = WEBUI_COMPOSER_EMPTY_STAGING;
  let modes = WEBUI_COMPOSER_EMPTY_MODES;
  let retry: WebuiRecordedTurn | undefined;
  // One stable object per change: a fresh snapshot on *every* `getSnapshot()` call
  // would make `useSyncExternalStore` re-render forever.
  let snapshot: WebuiComposerSnapshot = { ...state, queue, staging, modes, retry };
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        try {
          // eslint-disable-next-line no-console
          console.error("[webui] composer listener threw:", error);
        } catch {
          // console.error can throw in extreme environments; give up.
        }
      }
    }
  };

  const apply = (
    update: (current: WebuiComposerPersisted) => WebuiComposerPersisted,
    keepKeys?: readonly string[],
  ): void => {
    const next = update(state);
    if (next === state) return;
    state = next;
    snapshot = { ...state, queue, staging, modes, retry };
    options?.storage?.saveComposer(state, serializeWebuiComposerPersisted, keepKeys);
    notify();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readDraft: (key) => state.drafts[key] ?? "",
    readHistory: (key) => state.history[key] ?? [],
    setDraft: (key, draft) => {
      apply((current) => {
        const drafts = { ...current.drafts };
        if (draft) drafts[key] = draft;
        else delete drafts[key];
        return { ...current, drafts };
      }, [key]);
    },
    recordInput: (key, text) => {
      apply((current) => {
        const history = {
          ...current.history,
          [key]: recordWebuiInputHistory(current.history[key] ?? [], text),
        };
        return { ...current, history };
      }, [key]);
    },
    adoptHome: (targetKey) => {
      apply((current) => migrateWebuiHomeComposerState(current, targetKey), [targetKey]);
    },
    readQueue: () => snapshot.queue,
    setQueue: (next) => {
      const patch = typeof next === "function" ? next(queue) : next;
      const items = patch.items ?? queue.items;
      const paused = patch.paused ?? queue.paused;
      // Reference equality, not deep: the caller passes the array it received, so
      // an unchanged result must not notify.
      if (items === queue.items && paused === queue.paused) return;
      queue = { items, paused };
      snapshot = { ...state, queue, staging, modes, retry };
      notify();
    },
    readStaging: () => snapshot.staging,
    setStaging: (next) => {
      const patch = typeof next === "function" ? next(staging) : next;
      const attachments = patch.attachments ?? staging.attachments;
      const urlReferences = patch.urlReferences ?? staging.urlReferences;
      const busy = patch.busy ?? staging.busy;
      const seedToken = "seedToken" in patch ? patch.seedToken : staging.seedToken;
      if (
        attachments === staging.attachments &&
        urlReferences === staging.urlReferences &&
        busy === staging.busy &&
        seedToken === staging.seedToken
      )
        return;
      staging = { attachments, urlReferences, busy, ...(seedToken === undefined ? {} : { seedToken }) };
      snapshot = { ...state, queue, staging, modes, retry };
      notify();
    },
    readModes: () => snapshot.modes,
    setModes: (next) => {
      const patch = typeof next === "function" ? next(modes) : next;
      const goal = patch.goal ?? modes.goal;
      const plan = patch.plan ?? modes.plan;
      if (goal === modes.goal && plan === modes.plan) return;
      modes = { goal, plan };
      snapshot = { ...state, queue, staging, modes, retry };
      notify();
    },
    readRetry: () => snapshot.retry,
    setRetry: (next) => {
      if (next === retry) return;
      if (next && retry && next.session === retry.session && next.message === retry.message) return;
      retry = next;
      snapshot = { ...state, queue, staging, modes, retry };
      notify();
    },
    purgeSlot: (key) => {
      apply((current) => {
        // Read the slots *before* deleting: an absent slot must leave the
        // snapshot — and therefore every subscriber — untouched.
        const hasDraft = Object.prototype.hasOwnProperty.call(current.drafts, key);
        const hasHistory = Object.prototype.hasOwnProperty.call(current.history, key);
        if (!hasDraft && !hasHistory) return current;
        const drafts = { ...current.drafts };
        delete drafts[key];
        const history = { ...current.history };
        delete history[key];
        // No keep key: the slot is gone, so there is nothing to protect from
        // the prune.
        return { ...current, drafts, history };
      });
    },
  };
}
