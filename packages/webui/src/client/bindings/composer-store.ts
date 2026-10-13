// The composer's own owner module, read by its own presentation (plan §8 Phase 3
// B2; ticket #67).
//
// §4.2 field 1 gives `composer` the queue's state, and §5.6 puts the owner at
// `application/composer-store.ts`. The component used to hold the queue in
// `useState`, which is the temporary home the ledger recorded at `:780-781`.
//
// The fallback keeps a composer mounted without an application (unit tests, a
// standalone surface) working against a per-mount store instead of no store at all.

import { useMemo } from "react";

import type { WebuiComposerStore } from "../application/composer-store.js";
import { createWebuiComposerStore } from "../application/composer-store.js";
import { useWebuiApplicationOptional } from "./application-context.js";

export function useWebuiComposerStore(): WebuiComposerStore {
  const application = useWebuiApplicationOptional();
  const fallback = useMemo(() => createWebuiComposerStore(), []);
  return application?.composer ?? fallback;
}
