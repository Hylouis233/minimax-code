// React subscription to a session's snapshot (plan §7.2
// `client/bindings/use-session-state.ts`).
//
// It is the split-out React half of the retired module-level session store
// hook: the store and its writer now live in
// `client/application/session-store.ts`, and
// this hook only *reads* the store's snapshot and narrows it with the
// application selectors. No second map is created here — the hook holds no
// state of its own beyond what `useSyncExternalStore` needs to schedule a
// render when the application notifies.
//
// The interaction commands are built here too, bound to the store's interaction
// writer for the owner key, so the composer submits `applyGoal` /
// `replacePendingPermissions` and holds no writer for that state (plan §7.6;
// ticket #45).
//
// Since ticket #57 the turn intents take **no capabilities**. `attachTurn`,
// `sendTurn` and `stopTurn` are submitted with intent and data only; the
// capabilities they run on are read, at call time, from the application's
// published turn capability slice (`application/turn-capabilities.ts`), which
// the composition root cut from the port it holds in a closure. A host with
// nothing wired has no slice member for the operation, and the loop's own
// absent-capability guard refuses the turn with a stated reason.

import { useMemo } from "react";

import {
  selectWebuiSession,
  selectWebuiSessionGoal,
  selectWebuiSessionPermissions,
  selectWebuiSessionQuestionnaire,
  selectWebuiSessionStream,
} from "../application/selectors.js";
import type { WebuiGoal } from "../../shared/contracts/goal.js";
import type {
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
} from "../../shared/contracts/interactions.js";
import type { WebuiAttachmentInput } from "../../shared/contracts/messages.js";
import type { WebuiApplicationSessionState } from "../application/state.js";
import {
  initialWebuiApplicationSessionState,
  WEBUI_HOME_SESSION_KEY,
} from "../application/state.js";
import type { WebuiStreamState } from "../features/turn/projection/stream-state.js";
import {
  createWebuiInteractionCommands,
  type WebuiInteractionCommands,
} from "../features/sessions/application/session-commands.js";
import { createWebuiStreamPhaseCommands } from "../features/turn/application/stream-phase-commands.js";
import { createWebuiTurnCommands } from "../features/turn/application/turn-command-writer.js";
import { createWebuiTurnLifecycleCommands } from "../features/turn/application/turn-lifecycle-commands.js";
import type {
  WebuiStreamPhaseCommands,
  WebuiTurnLifecycleCommands,
} from "../features/turn/contracts/turn-command-views.js";
import { createWebuiConversationTurnCommands } from "../features/turn/application/turn-commands.js";
import {
  useWebuiApplicationOptional,
  useWebuiSessionStoreContext,
  useWebuiSessionStoreSnapshot,
} from "./application-context.js";

export function useWebuiTranscriptHistoryOwner() {
  return useWebuiApplicationOptional()?.transcriptHistory;
}

export function useWebuiSessionState(
  sessionId: string | undefined,
): WebuiApplicationSessionState {
  const snapshot = useWebuiSessionStoreSnapshot();
  if (!sessionId) return initialWebuiApplicationSessionState;
  return selectWebuiSession(snapshot, sessionId) ?? initialWebuiApplicationSessionState;
}

export function useWebuiSessionStream(
  sessionId: string | undefined,
): WebuiStreamState {
  const snapshot = useWebuiSessionStoreSnapshot();
  if (!sessionId) return initialWebuiApplicationSessionState.stream;
  return selectWebuiSessionStream(snapshot, sessionId);
}

/** The session's pending permissions, read through the selector. */
export function useWebuiSessionPermissions(
  sessionId: string | undefined,
): readonly WebuiPendingPermission[] {
  const snapshot = useWebuiSessionStoreSnapshot();
  if (!sessionId) return initialWebuiApplicationSessionState.permissions;
  return selectWebuiSessionPermissions(snapshot, sessionId);
}

/** The session's pending questionnaire, read through the selector. */
export function useWebuiSessionQuestionnaire(
  sessionId: string | undefined,
): WebuiQuestionnaireRequest | undefined {
  const snapshot = useWebuiSessionStoreSnapshot();
  return sessionId ? selectWebuiSessionQuestionnaire(snapshot, sessionId) : undefined;
}

/** The session's goal, read through the selector. */
export function useWebuiSessionGoal(
  sessionId: string | undefined,
): WebuiGoal | undefined {
  const snapshot = useWebuiSessionStoreSnapshot();
  return sessionId ? selectWebuiSessionGoal(snapshot, sessionId) : undefined;
}

/**
 * The interaction command surface for one session (or the home slot). The
 * component calls `replacePendingPermissions` / `removePendingPermission` /
 * `applyQuestionnaire` / `applyGoal` through this, never a store setter; the
 * interaction writer stays inside the binding and is rebuilt only when the
 * owner key changes.
 */
export function useWebuiInteractionCommands(
  sessionId: string | undefined,
): WebuiInteractionCommands {
  const store = useWebuiSessionStoreContext();
  return useMemo(
    () =>
      createWebuiInteractionCommands(
        store.createInteractionWriter(
          sessionId
            ? { kind: "session", sessionId }
            : { kind: "home" },
        ),
      ),
    [store, sessionId],
  );
}

/**
 * What a component submits to attach to a turn. The turn id and nothing else:
 * `resumeSession` / `loadMessages` are no longer the caller's to supply — the
 * composition root holds the port, and the binding reads the slice at call
 * time (ticket #57). A field for either one is rejected here.
 */
export type WebuiTurnAttachIntent = {
  /** The turn named by the event, or `undefined` when it carried none. */
  readonly turnId: string | undefined;
};

/** What a component submits to send (or retry) a turn — intent and data only. */
export interface WebuiTurnSendIntent {
  readonly message: string;
  readonly clientIntent?: string;
  readonly planMode?: boolean;
  readonly attachments?: readonly WebuiAttachmentInput[];
  readonly onAttachmentsSubmitted?: () => void;
  readonly sending: boolean;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onSessionCreated?: (sessionId: string) => void;
  readonly onQueued?: () => void;
}

/**
 * The stream/sending command surface for one session (or the home slot), the
 * three turn intents (`attachTurn` / `sendTurn` / `stopTurn`) and an imperative
 * `readStream` for the async turn paths that cannot subscribe (plan §7.6;
 * ticket #45 prerequisite 5).
 *
 * The store writer stays inside this hook, and so does the attempt's sink: a
 * component *submits* an intent and never receives a factory that could mint a
 * lease of its own and take one from a newer turn. The capabilities each intent
 * needs come from the application's turn capability slice, read here at call
 * time, so the component supplies none of them (ticket #57). `readStream` reads
 * the current slice off the same store rather than a module-level map.
 */
export function useWebuiSessionCommands(sessionId: string | undefined): {
  /**
   * The stream-phase view: the five commands that move or settle `phase`. A
   * consumer handed this object cannot reach a lifecycle or interaction write.
   */
  readonly phase: WebuiStreamPhaseCommands;
  /** The turn-lifecycle view: open, clear, record, close, and the `sending` flag. */
  readonly lifecycle: WebuiTurnLifecycleCommands;
  readonly readStream: () => WebuiStreamState;
  readonly attachTurn: (input: WebuiTurnAttachIntent) => void;
  readonly sendTurn: (input: WebuiTurnSendIntent) => Promise<void>;
  /** Recheck a lease a `session.start` no longer matches (T04). */
  readonly recheckTurn: (turnId: string | undefined) => void;
  /** Gap recovery for a `session.start` missed before the subscription was live. */
  readonly recoverTurn: () => void;
  readonly stopTurn: () => Promise<void>;
} {
  const store = useWebuiSessionStoreContext();
  // The published slice. Absent outside a provider (SSR, unit tests) and
  // partial on a host that wires only some operations — both are the states the
  // loop's absent-capability guards are written for.
  const application = useWebuiApplicationOptional();
  const capabilities = application?.turnCapabilities;
  // The registry the application disposes with: an attempt this client started
  // is closable by the application rather than only by its own loop.
  const deliveries = application?.deliveries;
  // The scope the attempt leases against, so navigating away cannot release a
  // session that still owes a turn (plan §4.3).
  const scope = application?.sessionScope;
  return useMemo(() => {
    const writerFor = () =>
      sessionId
        ? store.createSessionWriter({ kind: "session", sessionId })
        : store.createSessionWriter({ kind: "home" });
    const writer = writerFor();
    const readStream = () =>
      store.readSession(sessionId ?? WEBUI_HOME_SESSION_KEY).stream;
    const turnCommands = createWebuiConversationTurnCommands({
      store,
      sessionId,
      ...(capabilities ? { capabilities } : {}),
      ...(deliveries ? { deliveries } : {}),
      ...(scope ? { scope } : {}),
    });
    // Two views, built from the same writer and handed out separately
    // (ticket #58). The interaction view is published by its own hook
    // (`useWebuiInteractionCommands`), which is the third group.
    const phase = createWebuiStreamPhaseCommands({ setStream: writer.setStream });
    const lifecycle = createWebuiTurnLifecycleCommands({
      setStream: writer.setStream,
      setSending: writer.setSending,
    });
    return {
      phase,
      lifecycle,
      readStream,
      // The three turn intents are invocations now: the record key, the writer,
      // the attempt's sink and the transports cut from the capability slice are
      // the application's own construction (T04). This hook names none of them.
      attachTurn: ({ turnId }) => turnCommands.attach(turnId),
      recheckTurn: (turnId) => turnCommands.recheck(turnId),
      recoverTurn: () => turnCommands.recover(),
      sendTurn: ({ onDraftChange, onNeedsSession, onSessionCreated, onQueued, ...args }) =>
        turnCommands.send({
          ...args,
          callbacks: { onDraftChange, onNeedsSession, onSessionCreated, onQueued },
        }),
      stopTurn: () => turnCommands.stop(),
    };
  }, [store, sessionId, capabilities]);
}
