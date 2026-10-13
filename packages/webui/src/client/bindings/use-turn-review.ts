// The turn-review binding: the React surface of the review owner.
//
// The owner lives on the application, so a card that mounts reads whatever the
// owner already holds for that turn — including an answer a second surface asked
// for — and its unmount does not take the answer with it.

import { useCallback, useEffect, useState } from "react";

import {
  initialWebuiDiffState,
  type WebuiDiffState,
} from "../features/review/contracts/review-view.js";
import type { WebuiTurnReviewKey } from "../features/review/contracts/turn-review.js";
import { useWebuiApplicationOptional } from "./application-context.js";

export function useWebuiTurnReview(key: WebuiTurnReviewKey | undefined): {
  readonly state: WebuiDiffState;
  readonly mutate: (action: "revert" | "reapply") => void;
  readonly dismissError: () => void;
} {
  const owner = useWebuiApplicationOptional()?.turnReview;
  const sessionId = key?.sessionId;
  const turnId = key?.turnId;
  const assistantMessageId = key?.assistantMessageId;
  const changeSetId = key?.changeSetId;
  const [state, setState] = useState<WebuiDiffState>(initialWebuiDiffState);
  const keyOf = useCallback(
    (): WebuiTurnReviewKey | undefined =>
      sessionId
        ? {
            sessionId,
            ...(turnId ? { turnId } : {}),
            ...(assistantMessageId ? { assistantMessageId } : {}),
            ...(changeSetId ? { changeSetId } : {}),
          }
        : undefined,
    [assistantMessageId, changeSetId, sessionId, turnId],
  );
  useEffect(() => {
    const current = keyOf();
    if (!owner || !current) {
      setState(initialWebuiDiffState);
      return undefined;
    }
    setState(owner.read(current));
    const unsubscribe = owner.subscribe(() => setState(owner.read(current)));
    // Opening the card is the read: the owner joins it with any read already in
    // flight for the same turn.
    void owner.load(current);
    return unsubscribe;
  }, [keyOf, owner]);
  const mutate = useCallback(
    (action: "revert" | "reapply") => {
      const current = keyOf();
      if (!owner || !current) return;
      void owner.mutate(current, action);
    },
    [keyOf, owner],
  );
  const dismissError = useCallback(() => {
    const current = keyOf();
    if (!owner || !current) return;
    owner.dismissError(current);
  }, [keyOf, owner]);
  return { state, mutate, dismissError };
}

/** Whether the runtime offers turn diffs at all (see the owner's
 *  `supportsQueries`). Read from the owner so no surface keeps its own copy of
 *  the capability. */
export function useWebuiTurnReviewAvailable(): boolean {
  const owner = useWebuiApplicationOptional()?.turnReview;
  return owner?.supportsQueries() ?? false;
}
