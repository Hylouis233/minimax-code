// The stream loop's *published* interface: what a caller hands the loop and
// what the loop hands back through its sink.
//
// These two shapes live here for the same reason the stream *state* types do
// (`./stream-state.ts`): a mechanism may import only `contracts` and `shared`
// (plan §7.2), and the loop's own module is a mechanism. Declaring them beside
// the state they read means the mechanism imports them back instead of the
// caller having to name a mechanism-declared type, and it lets a business
// publish the command views it builds over them without reaching into
// `mechanisms/`.
//
// The implementations stay in `client/mechanisms/stream-loop.ts`
// (`runWebuiStreamLoop`, `buildWebuiStreamLoopSink`, `applyWebuiStreamLoopExtra`).

import type { WebuiStreamFrame } from "../../../../shared/contracts/stream.js";
import type {
  WebuiClientMessageSender,
  WebuiClientSessionResumer,
} from "./execution-port.js";
import type { WebuiClientMessageLoader } from "../../transcript/contracts/message-view.js";
import type {
  WebuiStreamMessage,
  WebuiStreamState,
  WebuiStreamSubscription,
} from "./stream-state.js";

/**
 * The transports a stream loop drives while it runs: send, resume, load. They
 * are the caller-facing half of the mechanism's `WebuiStreamLoopDeps`, which
 * adds the two injected transforms on top, so a caller that assembles its own
 * argument object — the composer's submit workflow does — can name the
 * transports without reaching into `mechanisms/`.
 */
export interface WebuiStreamLoopTransports {
  readonly sendMessage?: WebuiClientMessageSender;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly loadMessages?: WebuiClientMessageLoader;
}

/**
 * The stream fields an attachment may seed while it loads history. Closed on
 * purpose (plan §7.6 "who may write"): the loop's attach path needs the context
 * snapshot, the elapsed anchor, the `resume_overflow` flag it is repairing and
 * the refusal it clears — and nothing else. It deliberately excludes
 * `subscription` and `lastClaimedGeneration`, which the generation fence reads;
 * an extra that could write them would let any holder of a superseded sink
 * re-admit its own writes.
 */
export interface WebuiStreamLoopExtra {
  readonly contextUsage?: Record<string, unknown>;
  readonly processingStartedAtMs?: number;
  readonly resumeRequired?: boolean;
  readonly refusal?: string;
}

export interface WebuiStreamLoopSink {
  /** Push a single frame through the reducer; called for every frame. */
  readonly applyFrame: (frame: WebuiStreamFrame) => void;
  /** Replace the phase without touching the rest of the state. */
  readonly setPhase: (phase: WebuiStreamState["phase"]) => void;
  /** Replace the transcript without touching the rest of the state. */
  readonly setMessages: (messages: readonly WebuiStreamMessage[]) => void;
  /**
   * Claim the session's live stream for this client before it opens, so a
   * `session.start` event for our own turn adopts the lease instead of
   * opening a second stream. Local sends claim as `local-send`; attachments
   * claim as `recovered` because the turn was not ours.
   *
   * A sink claims **once**. Implementations return the generation they already
   * own on a repeat call instead of minting another one, because a second claim
   * would re-stamp the fence and let a superseded loop take the lease back.
   *
   * Optional: a caller that does not model subscription ownership (the
   * throw-on-everything failure fixtures, for instance) simply has no lease to
   * claim, and the `session.start` handler stays inert for it.
   */
  readonly claimSubscription?: (
    owner: WebuiStreamSubscription["owner"],
    turnId?: string,
  ) => number | undefined;
  /**
   * Drop the lease. Every terminal exit releases it.
   *
   * The loop calls this one **raw**, never through `safeSink`: the wrapper
   * disables itself after the first failure, which would strand the lease
   * exactly when the store is least able to recover. Cleanup is not a render
   * path, so it does not obey the failure-containment rule.
   */
  readonly releaseSubscription?: () => void;
  /**
   * Extra stream fields an attachment seeds while loading history — the
   * context snapshot and the turn start the live elapsed counter reads.
   *
   * The parameter is {@link WebuiStreamLoopExtra}, not `Partial<WebuiStreamState>`:
   * the open-ended version also accepted `subscription` and
   * `lastClaimedGeneration`, the two fields the generation fence itself reads,
   * so a caller holding a superseded sink could re-stamp itself as the newest
   * claimant and every write after that passed the fence.
   */
  readonly setStreamExtra?: (extra: WebuiStreamLoopExtra) => void;
  /**
   * Record an unrecoverable failure with a user-visible reason. The
   * second argument is set when the reducer had already accepted at
   * least one frame before the failure, so the user-visible
   * transcript may be incomplete; the shell renders an additional
   * message in that case.
   */
  readonly refuse: (reason: string, options?: { transcriptIncomplete?: boolean }) => void;
}
