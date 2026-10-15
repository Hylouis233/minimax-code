// The command views a session's record writer is bound to, published so a caller
// outside the sessions business can name them (plan §5.3 rule 2: composition
// supplies a peer command dependency where a direct import would form a business
// implementation cycle).
//
// The factories that build these views stay in
// `features/sessions/application/session-commands.ts`: each needs the stream loop
// mechanism or the stream-state transforms, so no contracts module can hold them.
// The turn substrate drives them without importing the sessions business's
// implementation — composition injects the factories, and these are the shapes it
// and the interactions coordinator name.

import type { WebuiStreamLoopSink } from "../../features/turn/contracts/stream-loop.js";
import type { WebuiStreamState } from "../../features/turn/contracts/stream-state.js";

/** The phases the stream slice can be moved to by name. */
export type WebuiStreamPhase = WebuiStreamState["phase"];

/**
 * The **stream-phase** view: every member moves or settles the `phase` field and
 * writes nothing else.
 */
export interface WebuiStreamPhaseCommands {
  /** Move the stream's phase without touching any other field. */
  readonly markStreamPhase: (phase: WebuiStreamPhase) => void;
  /** A turn is live: it is streaming. */
  readonly startStreaming: () => void;
  /** The turn ends locally. */
  readonly endStreaming: () => void;
  /** A pending interaction gates the turn. */
  readonly awaitInteraction: () => void;
  /**
   * The user stopped the turn: settle the slice to `done`/`aborted` and drop
   * the claim marker so the loop it silenced cannot write again.
   */
  readonly settleStoppedStream: () => void;
}

/**
 * The **turn-lifecycle** view: opening a turn's stream, clearing it for a new
 * task, recording what it carries and closing it. It is the one view that also
 * writes the `sending` indicator, because `sending` is the submit's lifecycle
 * flag rather than part of the phase.
 */
export interface WebuiTurnLifecycleCommands {
  /**
   * The stream a turn is about to open: the slice resets to the initial state
   * with a live phase and a fresh elapsed anchor. Intent-named because the
   * reset is what "a turn starts here" means.
   */
  readonly resetStreamForTurn: () => void;
  /**
   * Replace the live stream with the idle initial state — returning to a blank
   * composer (New Task), so the previous session's turn cannot bleed through.
   */
  readonly clearStream: () => void;
  /** Apply the history-derived context snapshot without exposing the stream writer. */
  readonly setContextUsage: (contextUsage: Record<string, unknown>) => void;
  /** Record or clear the refusal banner's message. */
  readonly setStreamRefusal: (refusal: string | undefined) => void;
  /** The `sending` indicator the composer renders from. */
  readonly setTurnSending: (sending: boolean) => void;
  /**
   * Release the subscription this client holds **only** if the live lease still
   * carries that generation, so a probe that started before a newer turn cannot
   * clear the newer lease.
   */
  readonly releaseStreamSubscription: (generation: number) => void;
}

/**
 * A turn's stream writer, expressed as the named commands a component submits.
 * It is a structural adapter — it imports no store — so a component can build
 * it for a send and immediately stop holding it: from then on it only submits
 * the intents below, and the home→session migration stays behind
 * `migrateToSession` exactly as before.
 *
 * There is deliberately no `updateStream(update)`: the sink is built **inside**
 * the adapter, so the generation fence travels with the writer instead of being
 * a convention the caller has to honour.
 */
export interface WebuiTurnCommandWriter {
  readonly kind: "session" | "home";
  readonly createSink: () => WebuiStreamLoopSink;
  readonly resetStreamForTurn: () => void;
  readonly setStreamRefusal: (refusal: string | undefined) => void;
  readonly setTurnSending: (sending: boolean) => void;
  readonly migrateToSession?: (sessionId: string) => WebuiTurnCommandWriter;
}
