// Purpose-named domain commands for the migrated execution state
// (plan §7.6 "Final state ownership and write authority"; ticket #45
// prerequisite 3).
//
// The session store owns the session record — the live stream, the `sending`
// flag, the pending permissions, the questionnaire and the goal — and every
// write to it is one of the named changes below, never a raw setter call from a
// component. This module is the **command surface** for those writes: a
// framework-free factory that binds the commands to a set of write targets, so
// a component *submits a command* (`startStreaming()`, `removePendingPermission
// (id)`) instead of holding and calling a store writer.
//
// Naming alone does not narrow authority, so the surface carries no
// reducer-taking writer: a command that accepted `(current) => next` would let a
// component rewrite any field of the slice and walk straight around the
// generation fence the owner applies. The stream's open-ended writes stay behind
// single-field intent commands (`markStreamPhase`, `setContextUsage`,
// `setStreamRefusal`, …), and the *lease* is not on this surface at all: a sink
// factory here would let a component mint a new lease at will and take one from
// a newer turn. Opening a turn's stream belongs to the binding that owns the
// store writer, which composes it into the attach/send intents a component
// submits (plan §7.2 `:555`, §7.6 `:583`). Nothing here
// opens a channel or reads a transport: the process-event ingress is untouched,
// and the write targets are injected exactly as `turn-commands.ts` already
// injects the setters it moved out of the composer.
//
// Since ticket #58 the surface is **three views, not one bag**, matching plan §8
// Phase 1 step 2: `WebuiStreamPhaseCommands` (the phase field only),
// `WebuiTurnLifecycleCommands` (opening, clearing, recording and closing a
// turn's stream, and the `sending` flag) and `WebuiInteractionCommands` (the
// pending interactions). Each is a separate object with its own factory and its
// own injected targets, so a consumer handed one view cannot reach another's
// commands — the narrowing is structural rather than a convention. Every
// member's disposition is recorded in `docs/webui/command-surface.md`, which
// `pnpm check:webui-commands` keeps current.

import type { WebuiGoal } from "../../../../shared/contracts/goal.js";
import type {
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
} from "../../../../shared/contracts/interactions.js";
import {
  initialWebuiStreamState,
  settleAbortedStream,
} from "../../turn/projection/stream-state.js";
import type { WebuiStreamState } from "../../turn/projection/stream-state.js";
import { releaseWebuiSubscription } from "../../../mechanisms/stream-lease.js";
import { buildWebuiStreamLoopSink } from "../../../mechanisms/stream-loop.js";
import type { WebuiStreamLoopSink } from "../../turn/contracts/stream-loop.js";
import { streamStateBundle } from "../../turn/application/stream-state-bundle.js";
import type {
  WebuiStreamPhaseCommands,
  WebuiTurnCommandWriter,
  WebuiTurnLifecycleCommands,
} from "../../../contracts/sessions/turn-command-views.js";

export function createWebuiStreamPhaseCommands(
  targets: WebuiStreamPhaseTargets,
): WebuiStreamPhaseCommands {
  const { setStream } = targets;
  return {
    markStreamPhase: (phase) => setStream((current) => ({ ...current, phase })),
    startStreaming: () =>
      setStream((current) => ({ ...current, phase: "streaming" })),
    endStreaming: () => setStream((current) => ({ ...current, phase: "idle" })),
    awaitInteraction: () =>
      setStream((current) => ({ ...current, phase: "waiting" })),
    settleStoppedStream: () => setStream(settleAbortedStream),
  };
}

/** The write target both turn views are bound to. */
export interface WebuiStreamWriteTarget {
  readonly setStream: (
    update: (current: WebuiStreamState) => WebuiStreamState,
  ) => void;
}

/** The stream-phase view needs no `sending` write, and is not given one. */
export type WebuiStreamPhaseTargets = WebuiStreamWriteTarget;

export interface WebuiTurnLifecycleTargets extends WebuiStreamWriteTarget {
  readonly setSending: (sending: boolean) => void;
}

export function createWebuiTurnLifecycleCommands(
  targets: WebuiTurnLifecycleTargets,
): WebuiTurnLifecycleCommands {
  const { setStream, setSending } = targets;
  return {
    resetStreamForTurn: () =>
      setStream(() => ({
        ...initialWebuiStreamState,
        phase: "streaming",
        processingStartedAtMs: Date.now(),
      })),
    clearStream: () => setStream(() => initialWebuiStreamState),
    setContextUsage: (contextUsage) =>
      setStream((current) => ({ ...current, contextUsage })),
    setStreamRefusal: (refusal) => setStream((current) => ({ ...current, refusal })),
    setTurnSending: (sending) => setSending(sending),
    releaseStreamSubscription: (generation) =>
      setStream((current) => releaseWebuiSubscription(current, { generation })),
  };
}

/** The write targets the interaction commands are bound to. */
export interface WebuiInteractionCommandTargets {
  readonly setPermissions: (
    update: (
      current: readonly WebuiPendingPermission[],
    ) => readonly WebuiPendingPermission[],
  ) => void;
  readonly setQuestionnaire: (
    value:
      | WebuiQuestionnaireRequest
      | undefined
      | ((
          current: WebuiQuestionnaireRequest | undefined,
        ) => WebuiQuestionnaireRequest | undefined),
  ) => void;
  readonly setGoal: (goal: WebuiGoal | undefined) => void;
}

export interface WebuiInteractionCommands {
  /** A fresh read of the pending permissions replaces the current list. */
  readonly replacePendingPermissions: (
    permissions: readonly WebuiPendingPermission[],
  ) => void;
  /** Answering one permission drops exactly that request. */
  readonly removePendingPermission: (requestId: string) => void;
  /** Apply or clear the pending questionnaire. */
  readonly applyQuestionnaire: (
    request: WebuiQuestionnaireRequest | undefined,
  ) => void;
  /** Apply or clear the session goal. */
  readonly applyGoal: (goal: WebuiGoal | undefined) => void;
}

export function createWebuiInteractionCommands(
  targets: WebuiInteractionCommandTargets,
): WebuiInteractionCommands {
  const { setPermissions, setQuestionnaire, setGoal } = targets;
  return {
    replacePendingPermissions: (permissions) =>
      setPermissions(() => permissions),
    removePendingPermission: (requestId) =>
      setPermissions((current) =>
        current.filter((item) => item.requestId !== requestId),
      ),
    applyQuestionnaire: (request) => setQuestionnaire(request),
    applyGoal: (goal) => setGoal(goal),
  };
}

export function createWebuiTurnCommands(writer: {
  readonly kind: "session" | "home";
  readonly setStream: (
    update: (current: WebuiStreamState) => WebuiStreamState,
  ) => void;
  readonly setSending: (sending: boolean) => void;
  readonly migrateToSession?: (sessionId: string) => {
    readonly kind: "session";
    readonly setStream: (
      update: (current: WebuiStreamState) => WebuiStreamState,
    ) => void;
    readonly setSending: (sending: boolean) => void;
  };
}): WebuiTurnCommandWriter {
  const lifecycle = createWebuiTurnLifecycleCommands({
    setStream: writer.setStream,
    setSending: writer.setSending,
  });
  return {
    kind: writer.kind,
    // The attempt's sink, built from this writer's own `setStream`: the fence
    // travels with the writer instead of being a convention the caller honours.
    createSink: () => buildWebuiStreamLoopSink(writer.setStream, streamStateBundle),
    resetStreamForTurn: lifecycle.resetStreamForTurn,
    setStreamRefusal: lifecycle.setStreamRefusal,
    setTurnSending: lifecycle.setTurnSending,
    ...(writer.migrateToSession
      ? {
          migrateToSession: (sessionId: string) =>
            createWebuiTurnCommands(writer.migrateToSession!(sessionId)),
        }
      : {}),
  };
}
