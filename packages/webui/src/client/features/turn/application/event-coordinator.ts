// The application event coordinator (plan §7.1 `features/turn/application/event-coordinator.ts`).
//
// It is the **sole consumer of the process-event channel** and the sole owner of
// the two write paths that used to be spread across the shell, the composer and
// both workspace panels:
//
//   * it routes each process event to the *existing* domain reducers — the
//     activity reducer and the effect reducer are kept unchanged; what is
//     unified is the ingress, the owned effect execution and the write
//     authority, not the reducers themselves;
//   * it runs the effect commands the effect reducer produces against the
//     store's writers, so components no longer compute and apply business
//     effects from a raw event callback;
//   * live stream frames do not come through here at all. They arrive at the
//     stream sink (`client/mechanisms/stream-loop.ts`), which owns the single
//     lease fence; this coordinator handles process events only.
//
// One channel, one coordinator: `attach` subscribes exactly once and `detach`
// only removes that one listener. The channel's lifetime belongs to the
// application, so unsubscribing never tears it down.

import type { WebuiRuntimeEvent } from "../../../../shared/contracts/stream.js";
import type { WebuiGoal } from "../../../../shared/contracts/goal.js";
import {
  reduceWebuiEffect,
} from "./effect-reducer.js";
import type {
  WebuiEffectCommand,
  WebuiEffectState,
} from "./effect-reducer.js";
import type {
  WebuiPendingPermission,
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireRequest,
} from "../../../../shared/contracts/interactions.js";
import type { WebuiStreamState } from "../projection/stream-state.js";
// The same resolver the effect reducer's own session guard uses. It carries
// the nested-goal fallback for `thread_goal.*` events, whose payload declares
// the id inside `goal` rather than at the top level. Reading the top level
// only here dropped every such event before it could reach the reducer.
import { eventSessionId } from "../../interactions/projection/event-parsers.js";
import type { WebuiProcessEventChannel } from "./event-channel.js";
import type { WebuiSessionStore } from "../../../application/session-store.js";
import type { WebuiStreamLeaseController } from "./stream-lease-controller.js";

export interface WebuiEffectHandlers {
  readonly refreshPending: () => void | Promise<unknown>;
  readonly setSending: (sending: boolean) => void;
  readonly setStream: (patch: (current: WebuiStreamState) => WebuiStreamState) => void;
  readonly setPermissions: (patch: (current: readonly WebuiPendingPermission[]) => readonly WebuiPendingPermission[]) => void;
  readonly setQuestionnaire: (patch: (current: WebuiQuestionnaireRequest | undefined) => WebuiQuestionnaireRequest | undefined) => void;
  readonly setGoal: (goal: WebuiGoal | undefined) => void;
  readonly refreshGoal: () => void | Promise<unknown>;
  readonly attachStream?: (turnId: string | undefined, mode: "attach" | "recheck") => void;
}

/** Runs reducer commands against the application-owned writers and effects. */
export function applyWebuiEffectCommands(
  commands: readonly WebuiEffectCommand[],
  handlers: WebuiEffectHandlers,
  readStream?: () => WebuiStreamState,
): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case "refresh-pending":
        Promise.resolve(handlers.refreshPending()).catch(() => undefined);
        break;
      case "refresh-goal":
        Promise.resolve(handlers.refreshGoal()).catch(() => undefined);
        break;
      case "set-sending":
        if (cmd.when && readStream && !cmd.when(readStream())) break;
        handlers.setSending(cmd.sending);
        break;
      case "set-stream":
        handlers.setStream(cmd.patch);
        break;
      case "set-permissions":
        handlers.setPermissions(cmd.patch);
        break;
      case "set-questionnaire":
        handlers.setQuestionnaire(cmd.patch);
        break;
      case "set-goal":
        handlers.setGoal(cmd.goal);
        break;
      case "attach-stream":
        handlers.attachStream?.(cmd.turnId, cmd.mode);
        break;
    }
  }
}

/**
 * Reduce one process event against a session's latest state and run the
 * commands it produces.
 *
 * This is the per-session half of `handleEvent`, extracted so the channel
 * consumer and the tests drive the same function. It used to be a factory that
 * returned the callback — with nobody calling it: `handleEvent` spelled the
 * same four lines out inline, so the extraction existed twice and only the
 * inline copy ran.
 */
export function applyWebuiEventToSession(
  sessionId: string,
  event: WebuiRuntimeEvent,
  readStream: () => WebuiStreamState,
  readState: () => Omit<WebuiEffectState, "stream">,
  handlers: WebuiEffectHandlers,
): void {
  const commands = reduceWebuiEffect(
    { ...readState(), stream: readStream() },
    event,
    sessionId,
  ).commands;
  applyWebuiEffectCommands(commands, handlers, readStream);
}

/** The parsed payload of a `workspace.git.changed` process event. */
export interface WebuiWorkspaceGitChangedPayload {
  readonly workspace?: string;
  readonly aliases?: readonly string[];
}

/**
 * The permanent domain routes (T05's `permanent-domain-event-routing`).
 *
 * They are installed by the application assembly **before** ingress opens, and
 * there is no replaceable effect set: a view reaction may subscribe after a
 * commit, but it cannot displace the route that owns the commit. The distinction
 * is the correction the T01 ledger's C2 records — an event set registered by a
 * subtree supplied its own goal handler for the session it was mounted on, and a
 * goal event for any other session was dropped, because the handler's presence
 * suppressed the coordinator's own write and then found no registration to route
 * to.
 *
 * Every member is required: a missing route would be a silent drop, and
 * `createWebuiApplication` always installs them.
 */
export interface WebuiDomainEventRoutes {
  /** The goal write path for one session, through that session's owner. */
  readonly setGoal: (sessionId: string, goal: WebuiGoal | undefined) => void;
  /** The steering re-read for one session, through that session's owner. */
  readonly refreshGoal: (sessionId: string) => void | Promise<unknown>;
  /** Fence this session's pending-interaction projection. */
  readonly invalidatePending: (sessionId: string) => void;
  /** The authoritative permission/questionnaire re-read for one session. */
  readonly refreshPending: (sessionId: string) => void | Promise<unknown>;
  /** Attach to, or recheck, the turn a `session.start` names. */
  readonly attachStream: (
    sessionId: string,
    turnId: string | undefined,
    mode: "attach" | "recheck",
  ) => void;
  /**
   * The channel was accepted: a possible observation gap. Not a barrier — a
   * `session.start` can still slip past it — so reconciliation decides what to
   * re-read.
   */
  readonly channelReady: () => void;
  /**
   * A `workspace.git.changed` event, which carries no session id. The owner
   * invalidates the workspace git and review queries it affects.
   */
  readonly workspaceGitChanged: (payload: WebuiWorkspaceGitChangedPayload) => void;
}

export interface WebuiEventCoordinatorDeps {
  readonly store: WebuiSessionStore;
  /** The permanent owner routes. See `WebuiDomainEventRoutes`. */
  readonly routes: WebuiDomainEventRoutes;
  readonly leases: WebuiStreamLeaseController;
  readonly readActiveSessionId: () => string | undefined;
  /**
   * The unread controller, which owns the activity reduction and gates counted
   * events on hydration (plan §7.6 "Unread"). The coordinator routes every
   * event to it instead of reducing the activity map itself, so there is one
   * implementation of the activity write path.
   */
  readonly unread: WebuiActivityIngress;
}

/**
 * The activity ingress the coordinator routes events to. A
 * `WebuiUnreadController` satisfies it structurally.
 */
export interface WebuiActivityIngress {
  readonly recordEvent: (
    event: WebuiRuntimeEvent,
    activeSessionId: string | undefined,
  ) => void;
}

export interface WebuiEventCoordinator {
  /** Subscribe to the channel exactly once; returns a detach that removes it. */
  readonly attach: (channel: WebuiProcessEventChannel) => () => void;
  readonly handleEvent: (event: WebuiRuntimeEvent) => void;
  readonly detach: () => void;
  /** Whether the coordinator currently holds the channel subscription. */
  readonly isAttached: () => boolean;
}

export function createWebuiEventCoordinator(
  deps: WebuiEventCoordinatorDeps,
): WebuiEventCoordinator {
  const { store, leases, readActiveSessionId, unread } = deps;
  let unsubscribe: (() => void) | undefined;

  const handlersFor = (sessionId: string): WebuiEffectHandlers => ({
    refreshPending: () => deps.routes.refreshPending(sessionId),
    // The route, never the replaceable set: a mounted view cannot take the goal
    // read away from the owner that fences it.
    refreshGoal: () => deps.routes.refreshGoal(sessionId),
    setSending: (sending) =>
      store.updateSession(sessionId, (current) => ({ ...current, sending })),
    setStream: (patch) =>
      store.updateSession(sessionId, (current) => ({
        ...current,
        stream: patch(current.stream),
      })),
    setPermissions: (patch) =>
      store.updateSession(sessionId, (current) => ({
        ...current,
        permissions: patch(current.permissions),
      })),
    setQuestionnaire: (patch) =>
      store.updateSession(sessionId, (current) => ({
        ...current,
        questionnaire: patch(current.questionnaire),
      })),
    setGoal: (goal) => {
      // Every goal write goes through the session's owner, so the version fence
      // sees it and a late re-read cannot resurrect what it replaced.
      deps.routes.setGoal(sessionId, goal);
    },
    attachStream: (turnId, mode) => deps.routes.attachStream(sessionId, turnId, mode),
  });

  const handleEvent = (event: WebuiRuntimeEvent): void => {
    if (store.isDisposed()) return;
    const activeSessionId = readActiveSessionId();
    // The unread controller owns the activity reduction, and accepts a counted
    // event only once hydration has completed — one write path, not the shell's
    // effect plus the coordinator's.
    unread.recordEvent(event, activeSessionId);
    // A workspace-git event carries no session id. It is routed to the
    // application-wide invalidation hook, not a per-session effect, so the
    // workspace panels' git and review queries are invalidated through the
    // coordinator instead of a second subscription in the panels.
    if (event.type === "workspace.git.changed") {
      const rawWorkspace = event.payload.workspace;
      const rawAliases = event.payload.aliases;
      deps.routes.workspaceGitChanged({
        ...(typeof rawWorkspace === "string" ? { workspace: rawWorkspace } : {}),
        ...(Array.isArray(rawAliases)
          ? {
              aliases: rawAliases.filter(
                (alias): alias is string => typeof alias === "string",
              ),
            }
          : {}),
      });
      return;
    }
    const sessionId = eventSessionId(event);
    if (!sessionId) return;
    deps.routes.invalidatePending(sessionId);
    // The effect executor is the existing one; it walks the command list in
    // order, and its `set-*` commands land on this coordinator's store writers.
    applyWebuiEventToSession(
      sessionId,
      event,
      () => store.readSession(sessionId).stream,
      () => {
        const current = store.readSession(sessionId);
        return {
          permissions: current.permissions,
          questionnaire: current.questionnaire,
          goal: current.goal,
        };
      },
      handlersFor(sessionId),
    );
  };

  const detach = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
  };

  return {
    attach: (channel) => {
      if (unsubscribe) return unsubscribe;
      const off = channel.subscribe(
        (event) => handleEvent(event),
        () => deps.routes.channelReady(),
      );
      unsubscribe = off;
      return off;
    },
    handleEvent,
    detach,
    isAttached: () => unsubscribe !== undefined,
  };
}
