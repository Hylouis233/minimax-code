// The turn-review owner.
//
// One owner for a turn's diff: the query, the revert/reapply mutations and the
// freshness of both. It used to be the diff card's own: the component held the
// state machine, issued `getTurnDiff` itself, and decided the mutation request —
// so a second surface wanting the same turn could only duplicate it, and the
// card's unmount took the answer with it.
//
// The identity is the turn-review key (session + turn/changeset), and the
// answer lives under it in a keyed resource: two readers of one turn share the
// read, a newer read for one key supersedes only that key's earlier answer, and a
// mutation that took effect is announced so the workspace review family can be
// invalidated as part of its settlement.

import {
  createWebuiKeyedResource,
  type WebuiCommitToken,
} from "../../../conversation/request-freshness.js";
import {
  buildWebuiDiffMutationRequest,
  initialWebuiDiffState,
  reduceWebuiDiffState,
  resolveWebuiDiffMutation,
} from "../projection/review-state.js";
import type { WebuiDiffState } from "../contracts/review-view.js";
import type {
  WebuiTurnReviewKey,
  WebuiTurnReviewMutation,
  WebuiTurnReviewOutcome,
  WebuiTurnReviewPort,
} from "../contracts/turn-review.js";

export interface WebuiTurnReviewOwner {
  /** The state for one key, or the initial state when nothing was read for it. */
  readonly read: (key: WebuiTurnReviewKey) => WebuiDiffState;
  /** Reads the turn's diff, joining a read already in flight for that key. */
  readonly load: (key: WebuiTurnReviewKey) => Promise<WebuiTurnReviewOutcome>;
  /** Reverts or reapplies, and reports what the runtime said. */
  readonly mutate: (
    key: WebuiTurnReviewKey,
    action: "revert" | "reapply",
  ) => Promise<WebuiTurnReviewOutcome>;
  readonly invalidate: (key: WebuiTurnReviewKey) => void;
  /** Clears the last refusal. The error is the mutation's, so it is cleared where
   *  it was recorded; the card's dismiss button calls this. */
  readonly dismissError: (key: WebuiTurnReviewKey) => void;
  /**
   * Whether the runtime offers turn diffs at all. The card learns this from an
   * `unsupported` outcome; a surface that must decide *before* reading (the
   * activity group, which otherwise infers success from edit-tool output) asks
   * here instead of holding a copy of the capability.
   */
  readonly supportsQueries: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Settled mutations, for the families they affect. The workspace review
   * family is the caller's — a mutation commits once, then invokes the affected
   * owners' explicit invalidation commands — so this owner announces rather
   * than reaches into it.
   */
  readonly subscribeMutations: (listener: (mutation: WebuiTurnReviewMutation) => void) => () => void;
}

/** The resource key: the query request's identity, serialized by the primitive. */
function resourceKey(key: WebuiTurnReviewKey) {
  return {
    sessionId: key.sessionId,
    turn: key.turnId ?? key.assistantMessageId ?? "",
    changeSetId: key.changeSetId ?? "",
  };
}

/** The query request the port takes, rebuilt from the key. */
function queryRequest(key: WebuiTurnReviewKey) {
  return {
    id: key.sessionId,
    ...(key.turnId ? { turnId: key.turnId } : {}),
    ...(key.assistantMessageId ? { assistantMessageId: key.assistantMessageId } : {}),
    ...(key.changeSetId ? { changeSetId: key.changeSetId } : {}),
  };
}

export function createWebuiTurnReviewOwner(deps: {
  readonly port: WebuiTurnReviewPort;
}): WebuiTurnReviewOwner {
  const pages = createWebuiKeyedResource<WebuiDiffState>();
  const listeners = new Set<() => void>();
  const mutationListeners = new Set<(mutation: WebuiTurnReviewMutation) => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const announce = (mutation: WebuiTurnReviewMutation): void => {
    for (const listener of [...mutationListeners]) listener(mutation);
  };
  const read = (key: WebuiTurnReviewKey): WebuiDiffState =>
    pages.read(resourceKey(key))?.value ?? initialWebuiDiffState;
  const write = (key: WebuiTurnReviewKey, token: WebuiCommitToken, state: WebuiDiffState): boolean => {
    const landed = pages.commit(token, { status: "ready", value: state });
    if (landed) notify();
    return landed;
  };

  const load = async (key: WebuiTurnReviewKey): Promise<WebuiTurnReviewOutcome> => {
    const resource = resourceKey(key);
    const getTurnDiff = deps.port.getTurnDiff;
    if (!getTurnDiff) {
      write(key, pages.capture(resource), reduceWebuiDiffState(read(key), { type: "unsupported" }));
      return { status: "unsupported" };
    }
    const token = pages.capture(resource);
    // Joining is the point: two surfaces opening the same turn share one request.
    await pages.load(resource, async () => {
      const view = await getTurnDiff(queryRequest(key));
      return reduceWebuiDiffState(initialWebuiDiffState, { type: "loaded", view });
    });
    const entry = pages.read(resource);
    if (entry?.status !== "ready" || !entry.value) return { status: "stale" };
    // A read the resource refused belongs to nobody: report it as stale rather
    // than claiming whatever answer is current.
    if (pages.capture(resource).revision !== token.revision) return { status: "stale" };
    notify();
    return { status: "applied" };
  };

  const mutate = async (
    key: WebuiTurnReviewKey,
    action: "revert" | "reapply",
  ): Promise<WebuiTurnReviewOutcome> => {
    const resource = resourceKey(key);
    const handler =
      action === "revert" ? deps.port.revertTurnDiff : deps.port.reapplyTurnDiff;
    const current = read(key);
    const request = buildWebuiDiffMutationRequest(current, queryRequest(key), action);
    if (!request || !handler) {
      write(key, pages.capture(resource), reduceWebuiDiffState(current, { type: "unsupported" }));
      return { status: "unsupported" };
    }
    const token = pages.capture(resource);
    write(key, token, reduceWebuiDiffState(current, { type: "begin-mutation" }));
    let next: WebuiDiffState;
    try {
      const result = await handler(request);
      next = reduceWebuiDiffState(read(key), resolveWebuiDiffMutation(action, result));
    } catch (thrown) {
      next = reduceWebuiDiffState(read(key), resolveWebuiDiffMutation(action, undefined, thrown));
    }
    if (!write(key, token, next)) return { status: "stale" };
    if (next.mutationError) return { status: "failed", reason: next.mutationError };
    // Settled: the workspace review family reads a working tree this mutation
    // just changed.
    announce({ sessionId: key.sessionId, action });
    return { status: "applied" };
  };

  return {
    read,
    load,
    mutate,
    dismissError: (key) => {
      write(
        key,
        pages.capture(resourceKey(key)),
        reduceWebuiDiffState(read(key), { type: "dismiss-mutation-error" }),
      );
    },
    invalidate: (key) => {
      pages.invalidate(resourceKey(key));
      notify();
    },
    supportsQueries: () => deps.port.getTurnDiff !== undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeMutations: (listener) => {
      mutationListeners.add(listener);
      return () => mutationListeners.delete(listener);
    },
  };
}
