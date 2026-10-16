// The turn commands the composer runs through the application layer.
//
// The stop command already lives in `turn-coordinator.ts`. This module moves
// the rest of the composer's owned execution out of the component and
// alongside it: the **attach** that follows a turn this client did not start,
// the **recheck** of a lease a `session.start` no longer matches, the **gap
// recovery** that repairs a missed `session.start`, and the **send** whose first
// message may create the session the turn then streams into.
//
// The shape is the same one `stopWebuiTurn` uses: a framework-free unit that
// takes the component's setters and transports as arguments. It is a *move*, not
// a re-implementation — every property the component's inline copies pinned
// (the lease claimed before the loop opens, the cursor anchored from history,
// the sending flag cleared only by the loop that still owns the stream, the
// probe reading the lease before it leaves and again when it returns) is
// preserved verbatim. Nothing here opens a channel: the process-event ingress
// stays exactly where it is.

import type {WebuiClientMessageEnqueuer} from "../../composer/contracts/command-port.js";
import type {WebuiClientSessionResumer} from "../contracts/execution-port.js";
import type { WebuiClientMessageLoader } from "../../transcript/contracts/message-view.js";
import type { WebuiClientSessionCreator } from "../../sessions/contracts/session-port.js";
import type { WebuiAttachmentInput } from "../../../../shared/contracts/messages.js";
import type {
  WebuiComposerTurnCallbacks,
  WebuiConversationTurnCommands,
  WebuiTurnSendIntent,
} from "../contracts/turn-commands.js";
export type { WebuiConversationTurnCommands, WebuiTurnSendIntent } from "../contracts/turn-commands.js";
import type { WebuiTurnCommandWriter } from "../contracts/turn-command-views.js";
import { createWebuiStreamPhaseCommands } from "./stream-phase-commands.js";
import { createWebuiTurnLifecycleCommands } from "./turn-lifecycle-commands.js";
import { createWebuiTurnCommands } from "./turn-command-writer.js";
import type { WebuiComposerSubmitHandlers } from "../../composer/contracts/composer-turn.js";
import {
  buildWebuiComposerHandlers,
  submitWebuiComposerTurn,
} from "./composer-submission.js";
import type {
  WebuiSubmissionOperation,
  WebuiTaskSessionSubmitter,
} from "../contracts/submission.js";
import { isWebuiSubscriptionProbeCurrent, ownsWebuiStreamGeneration, resolveWebuiSubscriptionRecheck, settleStaleWebuiSubscription, type WebuiStreamState } from "../projection/stream-state.js";
import { streamRecoveryProjection } from "../projection/stream-recovery.js";
import { runWebuiStreamLoop, type WebuiStreamLoopDeps } from "../../../conversation/stream-loop.js";
import type { WebuiStreamLoopSink } from "../contracts/stream-loop.js";
import {
  webuiActiveTurnProbeFor,
  type WebuiActiveTurnProbe,
  type WebuiActiveTurnProbeFn,
} from "./active-turn-probe.js";
import { streamStateBundle } from "./stream-state-bundle.js";
import type { WebuiSessionStore } from "../../../application/session-store.js";
import { WEBUI_HOME_SESSION_KEY } from "../../../application/state.js";
import type { WebuiTurnCapabilitySlice } from "./turn-capabilities.js";
import type { WebuiDeliveryDisposers } from "./delivery-disposers.js";
import type { WebuiSessionScopeManager } from "../../../conversation/session-scope.js";
import { stopWebuiTurn } from "./turn-coordinator.js";
import {
  classifyWebuiSubmission,
  readWebuiSubmissionAdmissionState,
} from "./execution-target.js";

export interface WebuiAttachTurnDeps {
  readonly sessionId: string | undefined;
  /** The turn named by the event, or `undefined` when it carried none. */
  readonly turnId: string | undefined;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly readStream: () => WebuiStreamState;
  readonly setSending: (sending: boolean) => void;
  /**
   * This attachment's stream sink. Built by the binding that owns the store
   * writer — the sole caller of this command — so its writes are already fenced
   * against the generation it claims, and no component ever holds the factory
   * that mints it.
   */
  readonly sink: WebuiStreamLoopSink;
}

/**
 * Follow a turn this client did not start, through the same stream loop a local
 * send uses — so history anchoring, cursor resume, `resume_overflow` resync, the
 * lease and every terminal exit stay handled in exactly one place.
 */
export function attachWebuiTurn(deps: WebuiAttachTurnDeps): Promise<void> {
  const { sessionId, turnId, resumeSession, loadMessages, readStream, setSending, sink } = deps;
  if (!sessionId || !resumeSession) return Promise.resolve();
  const existing = readStream();
  if (existing.subscription) return Promise.resolve();
  setSending(true);
  return runWebuiStreamLoop(
    { resumeSession, loadMessages, projection: streamRecoveryProjection, streamState: streamStateBundle },
    {
      sessionId,
      attachTurnId: turnId,
      ...(existing.cursor ? { afterCursor: existing.cursor } : {}),
    },
    sink,
  ).then((generation) => {
    // Only clear the indicator if this loop still owns the stream. A loop that
    // finished after a newer turn started would otherwise make the new turn
    // look idle while it is still streaming.
    if (ownsWebuiStreamGeneration(readStream(), generation)) setSending(false);
  });
}

export interface WebuiRecheckSubscriptionDeps {
  readonly sessionId: string | undefined;
  readonly getActiveTurn?: WebuiActiveTurnProbeFn;
  /** A shared, deduplicated probe; falls back to one built for `getActiveTurn`. */
  readonly probe?: WebuiActiveTurnProbe;
  readonly readStream: () => WebuiStreamState;
  /**
   * Drop the subscription only if the live lease still carries this generation.
   * Named and scoped, so a probe that started before a newer turn cannot clear
   * the lease that turn now owns.
   */
  readonly releaseSubscription: (generation: number) => void;
  /** Attach to the turn the recheck resolved to (`retarget`). */
  readonly attach: (turnId: string | undefined) => void;
}

/**
 * `session.start` named a turn we do not hold while holding another. The event
 * alone cannot say whether the held lease is stale or genuinely concurrent, so
 * the authoritative active turn decides.
 */
export function recheckWebuiSubscription(deps: WebuiRecheckSubscriptionDeps): void {
  const { sessionId, readStream, releaseSubscription, attach } = deps;
  if (!sessionId) return;
  const probe = deps.probe ?? webuiActiveTurnProbeFor(deps.getActiveTurn);
  if (!probe) return;
  // Read the lease *before* the probe leaves, not when it returns. A local send
  // that claims during the round trip gets a lease with no turn id yet; reading
  // only at resolution time would let this stale snapshot retarget the user's
  // own turn away from them.
  const probed = readStream().subscription;
  if (!probed) return;
  void probe
    .probe(sessionId)
    .then((active) => {
      const owned = readStream().subscription;
      // The lease this probe was about is gone or has been replaced. The answer
      // describes a turn that is no longer ours to act on.
      if (!isWebuiSubscriptionProbeCurrent(probed, owned) || !owned) return;
      const decision = resolveWebuiSubscriptionRecheck(owned, active);
      if (decision === "hold") return;
      // Scoped to the generation we decided is stale: a newer loop may have
      // claimed while the probe was in flight, and that lease is the live one.
      releaseSubscription(owned.generation);
      if (decision === "retarget" && active) attach(active.turnId);
    })
    .catch(() => undefined);
}

export interface WebuiRecoverMissedTurnDeps {
  readonly sessionId: string | undefined;
  readonly getActiveTurn?: WebuiActiveTurnProbeFn;
  readonly probe?: WebuiActiveTurnProbe;
  readonly readStream: () => WebuiStreamState;
  /** Settle only the same lease when an authoritative read finds no active turn. */
  readonly settleStaleSubscription: (generation: number) => void;
  readonly attach: (turnId: string | undefined) => void;
}

/**
 * Gap recovery: a `session.start` can arrive before this client finished
 * subscribing, or be missed while `watchEvents` reconnects, and the session
 * list cannot answer the question — its `status` carries no turn id. Ask the
 * server instead.
 */
export function recoverMissedWebuiTurn(deps: WebuiRecoverMissedTurnDeps): void {
  const { sessionId, readStream, settleStaleSubscription, attach } = deps;
  if (!sessionId) return;
  const probe = deps.probe ?? webuiActiveTurnProbeFor(deps.getActiveTurn);
  if (!probe) return;
  const probed = readStream().subscription;
  void probe
    .probe(sessionId)
    .then((active) => {
      // A locally issued send can be accepted before `getActiveTurn` reflects
      // it. Its stream lease is already evidence of a live attempt, so an
      // empty probe must not settle it. Recovery only reconciles recovered
      // leases that were established from an earlier authoritative read.
      if (probed?.owner === "recovered") {
        const owned = readStream().subscription;
        if (!isWebuiSubscriptionProbeCurrent(probed, owned)) return;
        if (!active || active.busyReason !== "turn") {
          settleStaleSubscription(probed.generation);
          return;
        }
      }
      if (!active || active.busyReason !== "turn") return;
      // Read the lease at resolution time, not at call time: a local send that
      // started while the probe was in flight has already claimed it.
      if (readStream().subscription) return;
      attach(active.turnId);
    })
    .catch(() => undefined);
}

export interface WebuiSendTurnArgs {
  readonly sessionId: string | undefined;
  readonly message: string;
  /**
   * The task use case, so a first message's creation goes through the one owner.
   * Absent on a host that cannot create, which the submission reports as `unsupported`.
   */
  readonly taskSessions?: WebuiTaskSessionSubmitter;
  readonly clientIntent?: string;
  readonly planMode?: boolean;
  readonly attachments?: readonly WebuiAttachmentInput[];
  readonly onAttachmentsSubmitted?: () => void;
  readonly sending: boolean;
  /**
   * The component-owned callbacks. The lease-bearing half of the handler bundle
   * is assembled here, from the writer this command builds, so a caller supplies
   * intent and never a sink.
   */
  readonly callbacks: WebuiComposerTurnCallbacks;
  /** Read the live slice. The home→session migration below changes the key. */
  readonly readStream?: () => WebuiStreamState;
  readonly deps: Omit<WebuiStreamLoopDeps, "projection" | "streamState">;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
  /**
   * Builds the turn's writer. The owner is not an argument: the writer belongs
   * to the session this send is for (or to the home slot before that session
   * exists), and the binding that builds it already knows which.
   */
  readonly createWriter: () => WebuiTurnCommandWriter;
}

/**
 * The one way a turn reaches the wire. A retry re-enters THIS command rather
 * than a second send of its own, so it inherits every rule an ordinary send
 * obeys — including the "a turn is already in flight ⇒ enqueue" branch inside
 * `submitWebuiComposerTurn`.
 */
export async function sendWebuiTurn(
  args: WebuiSendTurnArgs,
): Promise<WebuiSubmissionOperation | undefined> {
  let writer = args.createWriter();
  // The bundle is woven here, from the writer this command owns: `createSink`
  // reads the *current* writer, so a turn whose first message created the
  // session mints its lease against the migrated key rather than the home slot.
  const turnHandlers: WebuiComposerSubmitHandlers = buildWebuiComposerHandlers({
    createSink: () => writer.createSink(),
    resetStreamForTurn: () => writer.resetStreamForTurn(),
    setRefusal: (refusal) => writer.setStreamRefusal(refusal),
    setSending: (sending) => writer.setTurnSending(sending),
    ...(args.readStream ? { readStream: args.readStream } : {}),
    onDraftChange: args.callbacks.onDraftChange,
    ...(args.callbacks.onNeedsSession ? { onNeedsSession: args.callbacks.onNeedsSession } : {}),
    ...(args.callbacks.onQueued ? { onQueued: args.callbacks.onQueued } : {}),
    onSessionCreated: (createdSessionId, selected) => {
      args.callbacks.onSessionCreated?.(createdSessionId, selected);
      // The writer moves whatever the use case decided about selection: the attempt's frames belong to
      // the session it created, whether or not the view follows the user there.
      if (writer.kind === "home" && writer.migrateToSession) {
        writer = writer.migrateToSession(createdSessionId);
      }
    },
  });
  return await submitWebuiComposerTurn(
    {
      sessionId: args.sessionId,
      // `submitWebuiComposerTurn` reads `message ?? draft` and trims it, so
      // passing the effective text as `message` re-sends it through exactly the
      // path an ordinary send takes.
      draft: args.message,
      message: args.message,
      ...(args.clientIntent
        ? { clientIntent: args.clientIntent }
        : args.planMode
          ? { clientIntent: "plan-entry" }
          : {}),
      attachments: args.attachments,
      onAttachmentsSubmitted: args.onAttachmentsSubmitted,
      sending: args.sending,
      deps: args.deps,
      enqueueMessage: args.enqueueMessage,
      ...(args.taskSessions ? { submitTask: args.taskSessions } : {}),
      createSessionWorkspaceDir: args.createSessionWorkspaceDir,
      teamModeOff: args.teamModeOff,
    },
    turnHandlers,
  );
}

/**
 * What a turn command needs to run: the application-owned canonical record
 * repository, the session it is about, and the published capability slice.
 */
export interface WebuiTurnCommandContext {
  readonly store: WebuiSessionStore;
  readonly sessionId: string | undefined;
  readonly capabilities?: WebuiTurnCapabilitySlice;
  /**
   * Where each attempt's real disposer is registered, so the application holds
   * something it can close. Absent on a host that has no registry; the attempt
   * then simply cannot be detached by this client.
   */
  readonly deliveries?: WebuiDeliveryDisposers;
  /**
   * The session scope. An accepted attempt takes a **delivery** lease for as long
   * as it runs, so navigating away cannot release a session that still owes a
   * turn — and the lease ends when the attempt does, not when the view does.
   */
  readonly scope?: WebuiSessionScopeManager;
  /** The task use case the substrate creates through. */
  readonly taskSessions?: WebuiTaskSessionSubmitter;
}

/** What a surface supplies to send: intent and data, never a writer or a sink. */
/**
 * The turn commands a surface invokes, with the application's own construction
 * behind them.
 *
 * A binding used to choose the record key, build the writer, mint the sink and
 * cut the transports out of the capability slice — four decisions about
 * application state, made in a React hook. They are made once here instead, so a
 * binding is a subscription plus an invocation, and a second surface (or a
 * headless caller) gets the same key choice, the same sink and the same
 * absent-capability refusal without repeating any of it.
 *
 * The record key is `sessionId ?? WEBUI_HOME_SESSION_KEY`: a first message may
 * create the session it is sent to, and the writer's own `migrateToSession`
 * carries the attempt from the home slot to that session.
 */
export function createWebuiConversationTurnCommands(
  context: WebuiTurnCommandContext,
): WebuiConversationTurnCommands {
  const { store, sessionId, capabilities, taskSessions } = context;

  /**
   * The record writer for this turn: the session's, or the home slot's before a
   * first message creates the session. Kept as the store writer as well, because
   * the stop command needs the stream/sending writes the command adapter does not
   * publish.
   */
  const storeWriterFor = () =>
    sessionId
      ? store.createSessionWriter({ kind: "session", sessionId })
      : store.createSessionWriter({ kind: "home" });
  const writerFor = (): WebuiTurnCommandWriter => createWebuiTurnCommands(storeWriterFor());

  /**
   * The published views, bound to a writer of this owner's own. A
   * surface used to build these — and the writer behind them — itself, which made
   * every binding a second construction of the same two objects; they are built
   * here instead and handed out through the contract.
   */
  const viewWriter = storeWriterFor();
  const phase = createWebuiStreamPhaseCommands({ setStream: viewWriter.setStream });
  const lifecycle = createWebuiTurnLifecycleCommands({
    setStream: viewWriter.setStream,
    setSending: viewWriter.setSending,
  });

  /** The live slice. The home→session migration changes which key this reads. */
  const readStream = (): WebuiStreamState =>
    store.readSession(sessionId ?? WEBUI_HOME_SESSION_KEY).stream;

  /**
   * The loop's transports, cut from the slice: an unwired operation is absent,
   * and the loop refuses with its own stated reason instead of a caller having
   * to know the operation is missing.
   */
  const recordKey = (): string => sessionId ?? WEBUI_HOME_SESSION_KEY;
  /**
   * One attempt's hold on its session: the registered disposer and the delivery
   * lease. Both start when the attempt opens and end when it settles — a
   * navigation in between must not release either.
   */
  const holdDelivery = (): {
    readonly onDelivery: (handle: { readonly close: () => void }) => void;
    readonly release: () => void;
  } => {
    let releaseHandle: (() => void) | undefined;
    let releaseInterest: (() => void) | undefined;
    return {
      onDelivery: (handle) => {
        releaseHandle = context.deliveries?.track(recordKey(), handle);
        releaseInterest = context.scope?.acquire(recordKey(), "delivery", `attempt:${recordKey()}`);
      },
      release: () => {
        releaseHandle?.();
        releaseInterest?.();
        releaseHandle = undefined;
        releaseInterest = undefined;
      },
    };
  };
  const loopDeps = (
    hold: { readonly onDelivery: (handle: { readonly close: () => void }) => void },
  ): Omit<WebuiStreamLoopDeps, "projection" | "streamState"> => ({
    ...(capabilities?.send
      ? { sendMessage: (body, onFrame) => capabilities.send!(body, onFrame, hold.onDelivery) }
      : {}),
    ...(capabilities?.resume
      ? {
          resumeSession: (body, onFrame) =>
            capabilities.resume!(body, onFrame, hold.onDelivery),
        }
      : {}),
    ...(capabilities?.load ? { loadMessages: capabilities.load } : {}),
  });

  // One shared, deduplicated probe per transport: `webuiActiveTurnProbeFor` keys
  // its cache by the `getActiveTurn` function, so the shell's rail probe and this
  // command set collapse a same-session probe into one round trip.
  const activeTurnProbe = (): WebuiActiveTurnProbe | undefined =>
    webuiActiveTurnProbeFor(capabilities?.activeTurn);

  /** Drop the lease only if it still carries the generation the probe decided is stale. */
  const releaseSubscription = (generation: number): void => {
    const writer = storeWriterFor();
    createWebuiTurnLifecycleCommands({
      setStream: writer.setStream,
      setSending: writer.setSending,
    }).releaseStreamSubscription(generation);
  };

  const settleStaleSubscription = (generation: number): void => {
    const writer = storeWriterFor();
    let settled = false;
    writer.setStream((current) => {
      const next = settleStaleWebuiSubscription(current, generation);
      settled = next !== current;
      return next;
    });
    if (settled) writer.setSending(false);
  };

  const attach = (turnId: string | undefined): Promise<void> => {
    const writer = writerFor();
    const hold = holdDelivery();
    return attachWebuiTurn({
      sessionId,
      turnId,
      ...(capabilities?.resume ? { resumeSession: capabilities.resume } : {}),
      ...(capabilities?.load ? { loadMessages: capabilities.load } : {}),
      readStream,
      setSending: writer.setTurnSending,
      sink: writer.createSink(),
    }).finally(hold.release);
  };

  const probeDeps = (): Pick<WebuiRecheckSubscriptionDeps, "probe"> &
    Pick<WebuiRecoverMissedTurnDeps, "probe"> => {
    const probe = activeTurnProbe();
    return probe ? { probe } : {};
  };

  return {
    recheck: (turnId) =>
      recheckWebuiSubscription({
        sessionId,
        ...(capabilities?.activeTurn ? { getActiveTurn: capabilities.activeTurn } : {}),
        ...probeDeps(),
        readStream,
        releaseSubscription,
        attach,
      }),
    recover: () =>
      recoverMissedWebuiTurn({
        sessionId,
        ...(capabilities?.activeTurn ? { getActiveTurn: capabilities.activeTurn } : {}),
        ...probeDeps(),
        readStream,
        settleStaleSubscription,
        attach,
      }),
    send: async (intent) => {
      const writer = writerFor();
      const hold = holdDelivery();
      const admissionDeps = {
        store,
        capabilities: capabilities ?? {},
        ...(taskSessions ? { taskSessions } : {}),
      };
      const admission = readWebuiSubmissionAdmissionState(admissionDeps, { sessionId });
      const decision = classifyWebuiSubmission(admissionDeps, { sessionId });
      return await sendWebuiTurn({
        sessionId,
        ...(taskSessions ? { taskSessions } : {}),
        message: intent.message,
        ...(intent.clientIntent ? { clientIntent: intent.clientIntent } : {}),
        ...(intent.planMode ? { planMode: intent.planMode } : {}),
        attachments: intent.attachments,
        onAttachmentsSubmitted: intent.onAttachmentsSubmitted,
        // The UI submits intent only. The execution owner reads the canonical
        // target at invocation time so a stale render cannot choose send vs queue.
        sending: admission.turnLive && decision !== "unsupported" && decision !== "needs-session",
        callbacks: intent.callbacks,
        readStream,
        deps: loopDeps(hold),
        ...(capabilities?.enqueue ? { enqueueMessage: capabilities.enqueue } : {}),
        ...(intent.createSessionWorkspaceDir
          ? { createSessionWorkspaceDir: intent.createSessionWorkspaceDir }
          : {}),
        ...(intent.teamModeOff ? { teamModeOff: intent.teamModeOff } : {}),
        // The writer and, through it, the sink are built here: the caller names
        // no key and holds no factory.
        createWriter: () => writer,
      }).finally(hold.release);
    },
    attach: (turnId) => {
      void attach(turnId);
    },
    stop: async () => {
      if (!sessionId || !capabilities?.stop) return;
      await stopWebuiTurn({
        abortSession: capabilities.stop,
        sessionId,
        setSending: lifecycle.setTurnSending,
        settleStream: phase.settleStoppedStream,
      });
    },
    phase,
    lifecycle,
  };
}
