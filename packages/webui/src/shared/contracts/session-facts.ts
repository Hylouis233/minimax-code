// The session event vocabulary this client accepts, as a closed list.
//
// The wire carries `type` as a string, and until this file existed the client's
// vocabulary was implicit: `readWebuiSessionFact` had a `switch` and everything else
// fell into the same silence as an event that was never routed at all. A fact the
// runtime started publishing therefore reached no page and nothing failed — the
// client would simply stop being current about it.
//
// Two lists, one decision each:
//
//   * `WEBUI_SESSION_FACT_TYPES` — the catalogue facts the runtime publishes about a
//     session's lifecycle. Every one of them is either applied by the decoder or
//     named in its deliberately-unapplied list, and the decoder asserts that
//     partition exhaustively, so adding a name here forces the decision.
//   * `WEBUI_NON_CATALOGUE_SESSION_EVENTS` — event names that share the vocabulary
//     but are not catalogue facts: turn progress, queue state, and the local session
//     index. The client routes each of them elsewhere, and they are written down
//     with the reason so "not handled here" is a statement rather than an omission.
//
// The runtime publishes these names as literals (`type: "session.…"`) — it has no
// catalogue type to import, and this package cannot be depended on from that side.
// `test/unit/webui-session-fact-catalogue.test.ts` therefore derives the check from
// the runtime's own source: it scans for literal event names and fails, with the
// name, on any that is in neither list. That is what makes a newly added fact a
// compile-and-test failure here instead of a silent gap, and it is the closest tie
// available while the host publishes strings rather than a catalogue.

/** A session catalogue fact: something the runtime publishes about a session. */
export const WEBUI_SESSION_FACT_TYPES = [
  // Applied by the session-fact decoder.
  "session.created",
  "session.renamed",
  "session.title_updated",
  "session.model_updated",
  "session.interaction_mode.changed",
  "session.visibility_updated",
  "session.pinned_updated",
  "session.deleted",
  // Received and deliberately not applied, with the reason at the list in
  // `features/turn/application/session-fact.ts`.
  "session.compaction.started",
  "session.compaction.completed",
  "session.compaction.failed",
  "session.llm_retry",
  "message.rewind",
  "agent.created",
  "agent.updated",
  "rotation.completed",
  "content.retry.exceeded",
] as const;

export type WebuiSessionFactType = (typeof WEBUI_SESSION_FACT_TYPES)[number];

/** One event name in the vocabulary that is not a session catalogue fact. */
export interface WebuiNonCatalogueSessionEvent {
  readonly type: string;
  /** Who handles it, so a reader knows where "not here" sends it. */
  readonly handledBy: string;
}

/**
 * Names that are not catalogue facts.
 *
 * Each is published by the runtime and consumed by another route in this client —
 * the turn effect reducer, the queue view, the event coordinator's own paths, or the
 * local session index. Listing them turns "the decoder does not answer for this" into
 * a claim with an owner.
 */
export const WEBUI_NON_CATALOGUE_SESSION_EVENTS: readonly WebuiNonCatalogueSessionEvent[] = [
  { type: "session.start", handledBy: "turn/application/effect-reducer" },
  { type: "session.finish", handledBy: "turn/application/effect-reducer" },
  { type: "session.abort", handledBy: "turn/application/effect-reducer" },
  { type: "session.error", handledBy: "turn/application/effect-reducer" },
  { type: "session.queue.updated", handledBy: "turn/application/event-coordinator" },
  { type: "session.discovered", handledBy: "the runtime's own session index, not the wire catalogue" },
];
