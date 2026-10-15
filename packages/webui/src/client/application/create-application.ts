// The application instance (plan §7.1 `application/create-application.ts`).
//
// One call builds the whole browser-side application object: the store, the
// single lease controller, the event coordinator and the turn coordinator, and
// it opens **exactly one** process-event channel for the instance. The channel
// is opened here and handed to the event coordinator, which is its sole
// consumer; components subscribe to the application snapshot this object
// exposes.
//
// This module is the live process-event ingress. The composition root creates
// one application through it; ticket #45 switched all four former `watchEvents`
// call sites (the shell, the composer and both workspace panels) onto it in one
// delivery unit, because a migration period where the shell used the new
// ingress while the composer still opened its own connection would make the
// migration itself a source of duplicated state.

import { createWebuiPortSlices, type WebuiPortSlices } from "./port-slices.js";
import { createWebuiSessionWorkflows } from "../features/sessions/application/session-workflows.js";
import { createWebuiCommandWorkflows } from "../features/composer/application/command-workflows.js";
import { createWebuiComposerController } from "../features/composer/application/composer-controller.js";
import { submitWebuiGoal } from "../features/composer/application/composer-workflows.js";
import type { WebuiComposerController } from "../features/composer/contracts/composer-controller.js";
import { WEBUI_COMPOSER_HOME_KEY } from "../features/composer/application/composer-history.js";
import { createWebuiTurnLifecycleCommands } from "../features/sessions/application/session-commands.js";
import { createWebuiTerminalOwner } from "../features/terminal/application/terminal-owner.js";
import { createWebuiWorkspaceQueries } from "../features/workspace/application/workspace-queries.js";
import { createWebuiAccountWorkflows } from "../features/account/application/account-workflows.js";
import { createWebuiModelsWorkflows } from "../features/models/application/models-workflows.js";
import { createWebuiSettingsWorkflows } from "../features/settings/application/settings-workflows.js";
import { createWebuiPluginWorkflows } from "../features/plugins/application/plugin-workflows.js";
import { createWebuiComposerPluginCatalogue } from "../features/plugins/application/composer-catalogue.js";
import { createWebuiPluginActions } from "../features/plugins/contracts/plugin-actions.js";
import { createWebuiPlanReviewWorkflow } from "../features/interactions/application/interaction-coordinator.js";
import { webuiActiveTurnProbeFor } from "../features/turn/application/active-turn-probe.js";
import {
  createWebuiEventCoordinator,
  type WebuiWorkspaceGitChangedPayload,
  type WebuiEventCoordinator,
} from "../features/turn/application/event-coordinator.js";
import type { WebuiOpenEventChannel, WebuiProcessEventChannel } from "../features/turn/application/event-channel.js";
import { createWebuiSessionStore, createWebuiTranscriptHistoryWriter } from "./session-store.js";
import { createWebuiTaskSessionWorkflows } from "./task-session-workflows.js";
import type { WebuiSessionStore } from "./session-store.js";
import {
  createWebuiStreamLeaseController,
  type WebuiStreamLeaseController,
} from "../features/turn/application/stream-lease-controller.js";
import {
  createWebuiSessionScopeManager,
  type WebuiSessionScopeManager,
} from "../conversation/session-scope.js";
import {
  createWebuiDeliveryDisposers,
  type WebuiDeliveryDisposers,
} from "../features/turn/application/delivery-disposers.js";
import {
  createWebuiConversationTurnCommands,
  type WebuiConversationTurnCommands,
} from "../features/turn/application/turn-commands.js";
import { createWebuiTurnCommandCollaborators } from "./turn-command-wiring.js";
import {
  createWebuiGoalSessionOwners,
  type WebuiGoalSessionOwners,
} from "../features/goal/application/goal-session-owners.js";
import type { WebuiGoalPortSlice } from "../features/goal/application/goal-coordinator.js";
import {
  createWebuiInteractionSessionOwners,
  type WebuiInteractionSessionOwners,
} from "../features/interactions/application/interaction-session-owners.js";
import type { WebuiInteractionPortSlice } from "../features/interactions/application/interaction-coordinator.js";
import {
  selectWebuiCatalogFlatPage,
  selectWebuiCatalogTreePage,
} from "../features/sessions/application/session-catalog.js";
import { selectWebuiSessionAgentName, selectWebuiSessionLookups } from "../features/sessions/projection/session-lookups.js";
import type { WebuiApplicationState } from "./state.js";
import { WEBUI_HOME_SESSION_KEY } from "./state.js";
import {
  createWebuiTurnCoordinator,
  type WebuiTurnCoordinator,
} from "../features/turn/application/turn-coordinator.js";
import type { WebuiTurnCoordinatorDeps } from "../features/turn/application/turn-coordinator.js";
import {
  createWebuiUnreadController,
  type WebuiUnreadController,
} from "../features/sessions/application/unread.js";
import {
  createWebuiComposerStore,
  type WebuiComposerStore,
} from "../features/composer/application/composer-store.js";
import { createWebuiVersionCells, type WebuiVersionCells } from "./version-cell.js";
import {
  createWebuiIdentityEpochs,
  type WebuiIdentityEpochs,
} from "./identity-epochs.js";
import {
  createWebuiTranscriptHistoryOwner,
  type WebuiTranscriptHistoryOwner,
} from "../conversation/transcript-history.js";
import type {
  WebuiTurnCapabilityPort,
  WebuiTurnCapabilitySlice,
} from "../features/turn/application/turn-capabilities.js";
import { createWebuiTurnCapabilitySlice } from "../features/turn/application/turn-capabilities.js";
import {
  createWebuiTurnReviewOwner,
  type WebuiTurnReviewOwner,
} from "../features/review/application/turn-review-owner.js";
import type { WebuiTurnReviewPort } from "../features/review/contracts/turn-review.js";
import type {
  WebuiClientMessageLoader,
  WebuiClientMessagePage,
} from "../features/transcript/contracts/message-view.js";
import type { WebuiTranscriptCommands } from "../features/transcript/contracts/session-read-port.js";
import type { WebuiStreamState } from "../features/turn/projection/stream-state.js";
import {
  selectWebuiSessionStream,
  selectWebuiSessionTranscriptPage,
} from "./selectors.js";

/**
 * The session reads the shell composes its screens from (plan §5.1: the shell
 * may not import the assembly, and it renders the providers its descendants
 * read through, so it cannot reach them through those bindings either).
 * Published on the application instance — the composition root's own interface
 * — because that instance is what the shell is handed. Both reads answer from
 * the one store; `undefined` means "whatever is selected", and with no session
 * selected that is the home slot the first turn streams into.
 */
export interface WebuiApplicationReads {
  readonly stream: (sessionId: string | undefined) => WebuiStreamState;
  readonly transcriptPage: (
    sessionId: string | undefined,
  ) => WebuiClientMessagePage;
}

export interface WebuiApplicationDeps {
  /** Opens the process-event channel. Called exactly once per instance. */
  readonly openEventChannel: WebuiOpenEventChannel;
  /**
   * The one session store the instance owns. Supply it to bind the application
   * to a store created by the caller (the composition root creates exactly one
   * and the shell hands it in); when omitted a fresh store is created here.
   * Either way there is exactly one map — this is not a second store.
   */
  readonly store?: WebuiSessionStore;
  /** The session the UI currently has selected; default reads the store. */
  readonly readActiveSessionId?: () => string | undefined;

  /** Transport-facing dependencies of the turn coordinator. */
  readonly turns: Omit<WebuiTurnCoordinatorDeps, "store" | "leases">;
  /**
   * The port the turn capability slice is cut from — the composition root's
   * closure over the transport (plan §8 Phase 1 step 1). The slice is built
   * here, not by the component that submits a turn intent, so `attachTurn` /
   * `sendTurn` / `stopTurn` receive no capability from their caller. Absent on
   * a host with nothing wired (SSR, unit tests), which is exactly the state
   * the loop's absent-capability guards exist for.
   */
  readonly turnCapabilities?: WebuiTurnCapabilityPort;
  /**
   * The turn-review capability. The application owns the review family's query
   * and mutation (plan §5.2 review row), so a surface reads it from the
   * application rather than holding its own copy; the absent case is the state
   * the owner's own `unsupported` outcome covers.
   */
  readonly turnReview?: WebuiTurnReviewPort;
  readonly loadMessages?: WebuiClientMessageLoader;
  /**
   * The unread storage adapter (`platform/storage.ts`), injected because
   * the application layer may not import infrastructure. Absent degrades to a
   * no-op: hydration completes immediately against no stored counts, which is
   * the correct behaviour for SSR and unit tests.
   */
  readonly unreadStorage?: {
    readonly read?: () => Readonly<Record<string, number>>;
    readonly write?: (counts: Readonly<Record<string, number>>) => void;
  };
  /**
   * The new-task workspace's persisted "no project" choice
   * (`platform/storage.ts`), injected for the same reason as `unreadStorage`.
   * Absent reads as "nothing was ever cleared" and drops the write, which is
   * what a host with no storage (SSR, unit tests) means.
   */
  readonly workspacePreference?: {
    readonly readNoProjectFlag?: () => boolean;
    readonly writeNoProjectFlag?: (value: boolean) => void;
  };
  /** Seed for the composer store (SSR / tests). */
  readonly composer?: WebuiComposerStore;
  /**
   * The goal capability, so the application can own the goal owner rather than
   * the view that happens to be mounted (T05). Absent on a host with nothing
   * wired, which is the state the owner's own absent-capability handling covers.
   */
  readonly goalPort?: WebuiGoalPortSlice;
  /**
   * The interaction capability, so the application owns the permission and
   * questionnaire owner rather than the view that happens to be mounted (T05).
   */
  readonly interactionsPort?: WebuiInteractionPortSlice;
  /**
   * The fallback requester name for a session. Defaults to the catalogue's own
   * answer for that session, which is where the shell reads it too.
   */
  readonly readAgentName?: (sessionId: string) => string;
  /**
   * The per-business port slices (T19). The composition root cuts them once and
   * hands them in; the application builds every business owner from them, so no
   * view builds an owner to reach a capability (plan §8 Phase 2, §6 W6). Absent
   * on a host with nothing wired: the slices then cut from the turn capability,
   * which is the same degradation the shell used to perform.
   */
  readonly slices?: WebuiPortSlices;
  /**
   * The session-file import the session workflows submit through. Injected for
   * the same reason as `unreadStorage`: the application layer may not import
   * `platform/`.
   */
  readonly sessionImport?: Parameters<typeof createWebuiSessionWorkflows>[0]["importSession"];
  /**
   * The session-file export the session workflows submit through. Injected for
   * the same reason as `sessionImport`: the implementation is a browser
   * navigation, so it belongs to the composition root's platform layer.
   */
  readonly sessionExport?: Parameters<typeof createWebuiSessionWorkflows>[0]["exportSession"];
}

export type WebuiApplicationLifecycleState = "constructed" | "started" | "disposed";

/** What `start` needs from the caller: the route it booted at. */
export interface WebuiApplicationStart {
  /**
   * The session the initial route names, or `undefined` for the home surface.
   * Parsed by the entry (it owns the browser location), passed in so hydration
   * sees the same selection the first render will.
   */
  readonly initialSessionId?: string;
}

export interface WebuiApplication {
  /**
   * The lifecycle state (plan §4.1). `constructed` performs no IO; `started` has
   * one open ingress; `disposed` is terminal and refuses to restart.
   */
  readonly state: () => WebuiApplicationLifecycleState;
  /**
   * Hydrate persisted browser state for `initialSessionId`, install the
   * assembly's routes and open the one event ingress.
   *
   * Idempotent while started, and a refusal (returning `false`, opening
   * nothing) after disposal. The initial selection is passed in rather than
   * read later, because the route has to be known *before* unread hydration:
   * `hydrate` drops the stored count for the session being opened, so an
   * unread value hydrated without it is the badge the user was about to read.
   */
  readonly start: (options?: WebuiApplicationStart) => boolean;
  /** The current application snapshot; stable until something changes. */
  readonly getSnapshot: () => WebuiApplicationState;
  /** Subscribe to snapshot changes. Returns a detach; never closes a channel. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * The session reads a surface composes from without importing the assembly
   * (T19). Same store, same subscription as `getSnapshot`; the mapping from
   * "nothing selected" to the home slot stays inside the assembly, so a reader
   * asks for the selected slot rather than naming the sentinel.
   */
  readonly reads: WebuiApplicationReads;
  readonly select: (sessionId: string | undefined) => void;
  readonly store: WebuiSessionStore;
  readonly leases: WebuiStreamLeaseController;
  /**
   * Why each session is still needed (plan §4.3). Independent of component
   * mounting: a delivery or settlement lease outlives the view that started it.
   */
  readonly sessionScope: WebuiSessionScopeManager;
  /**
   * The goal owners, one per session (T05). An event route commits through them
   * whether or not a view is mounted, and each session has its own fence.
   */
  readonly goals: WebuiGoalSessionOwners;
  /**
   * The interaction owners, one per session (T05). An event route re-reads and
   * fences through them, and a transcript submits its reply to them, whether or
   * not the composer is mounted on that session.
   */
  readonly interactions: WebuiInteractionSessionOwners;
  /**
   * The client deliveries this application can actually close (plan §4.3).
   * Disposal closes them; it never aborts a host turn.
   */
  readonly deliveries: WebuiDeliveryDisposers;
  readonly events: WebuiEventCoordinator;
  readonly turns: WebuiTurnCoordinator;
  /** The published turn capability slice (send / resume / load / stop). */
  readonly turnCapabilities: WebuiTurnCapabilitySlice;
  /** The one owner of a turn's diff query and revert/reapply (T10). */
  readonly turnReview: WebuiTurnReviewOwner;
  readonly transcriptHistory: WebuiTranscriptHistoryOwner;
  /** Message actions exposed to transcript UI as application commands. */
  readonly transcriptCommands: WebuiTranscriptCommands;
  /** The one owner of unread hydration ordering (plan §7.6). */
  readonly unread: WebuiUnreadController;
  /** The one owner of composer drafts and input history (plan §7.6). */
  readonly composer: WebuiComposerStore;
  readonly composerController: WebuiComposerController;
  /**
   * The port slices the assembly cut (§6 W6). Published so a surface reads the
   * narrowed slice rather than the composed transport: the shell provides these
   * to its descendants and reads none of them itself.
   */
  readonly portSlices: WebuiPortSlices;
  /** The browser terminal owner (T15). */
  readonly terminalOwner: ReturnType<typeof createWebuiTerminalOwner>;
  /** The session business's loads and mutations, one per assembly (T19). */
  readonly sessionWorkflows: ReturnType<typeof createWebuiSessionWorkflows>;
  /** The task/session use case: task workspace policy, creation, and home identity. */
  readonly taskSessions: ReturnType<typeof createWebuiTaskSessionWorkflows>;
  /** The composer business's slash-command runner. */
  readonly commandWorkflows: ReturnType<typeof createWebuiCommandWorkflows>;
  /** The workspace file/environment/review query owner (T19). */
  readonly workspaceQueries: ReturnType<typeof createWebuiWorkspaceQueries>;
  /** The account owner: sign-in, api-key status and usage (T19). */
  readonly accountWorkflows: ReturnType<typeof createWebuiAccountWorkflows>;
  /** The settings owner: instructions, memory, profile and display (T19). */
  readonly settingsWorkflows: ReturnType<typeof createWebuiSettingsWorkflows>;
  /** The models owner: catalogue, selection and provider CRUD (T19). */
  readonly modelsWorkflows: ReturnType<typeof createWebuiModelsWorkflows>;
  /** The plugin manager's owner (T19). */
  readonly pluginWorkflows: ReturnType<typeof createWebuiPluginWorkflows>;
  /** The composer's plugin/skill read model, separate from the manager's (T08). */
  readonly composerPluginCatalogue: ReturnType<typeof createWebuiComposerPluginCatalogue>;
  /** The plan-review reply workflow (T19). */
  readonly planReviewWorkflow: ReturnType<typeof createWebuiPlanReviewWorkflow>;
  /**
   * The one active-turn probe (plan §7.1): a same-session probe from two views
   * collapses to one round trip, and absent means the host predates the
   * operation — the rail's own condition, not a second probe.
   */
  readonly activeTurnProbe: ReturnType<typeof webuiActiveTurnProbeFor>;
  /**
   * The two version cells, one per fence (§4.2 field 6). The application owns the
   * instance; the business owns the policy and reads the cell it is given.
   */
  readonly versionCells: WebuiVersionCells;
  /**
   * The opaque credential/config generation context (§4.5; T02). Owners put a
   * token in a resource key and compare with `isCurrent`; the business that owns
   * a write advances the epoch it invalidates. Tokens are instance-scoped and
   * carry no credential value.
   */
  readonly identityEpochs: WebuiIdentityEpochs;
  /**
   * The one reconciliation entry point (plan §4.4: "Reconnect and selection use
   * the same reconciliation entry point, with per-key request coalescing and
   * epoch guards").
   *
   * It runs the authoritative re-reads the installed routes own for one session —
   * the pending-interaction read, the goal re-read and the pending invalidation —
   * and is what a selection change or a suspected observation gap calls instead of
   * each surface inventing its own probe. `sessionId` defaults to the application's
   * selection.
   *
   * Today the routes are the ones the mounted surfaces registered (the same
   * objects the channel's coordinator runs), so this adds a named entry point
   * without a second path; T05 replaces the registration with permanent
   * application-owned routes behind the same call.
   */
  readonly reconcile: (sessionId?: string) => void;
  /**
   * Commit home→session adoption as one transition: carry the home turn's live
   * record onto the created session, move the home composer slot onto it and
   * select it. Both store writes are no-notify; the caller writes the hash and
   * the React selection once.
   */
  readonly adoptHomeSession: (sessionId: string) => void;
  /**
   * Subscribe to a domain event that carries no session id (a workspace-git
   * change). A reaction, not a route: it runs after the coordinator has routed
   * the event to the owners, and it cannot displace anything (plan §4.4).
   *
   * Temporary adapter: the workspace business owns this invalidation once its
   * query owner exists (T11); until then the surface that holds the affected
   * views subscribes here.
   */
  readonly onWorkspaceGitChanged: (
    listener: (payload: WebuiWorkspaceGitChangedPayload) => void,
  ) => () => void;
  /**
   * Subscribe to the channel-accepted signal. A reaction, not a route: the
   * application's own reconciliation runs first, then listeners are told.
   */
  readonly onChannelReady: (listener: () => void) => () => void;
  /** Tear down: detach the coordinator, dispose the store, close the channel. */
  readonly dispose: () => void;
}

export function createWebuiApplication(
  deps: WebuiApplicationDeps,
): WebuiApplication {
  const store = deps.store ?? createWebuiSessionStore();
  const leases = createWebuiStreamLeaseController(store);
  const sessionScope = createWebuiSessionScopeManager();
  const deliveries = createWebuiDeliveryDisposers();
  // The goal owners are the application's, not a view's: a goal event commits
  // through the session's owner even with nothing mounted (plan §4.4).
  const goals = createWebuiGoalSessionOwners({
    store,
    ...(deps.goalPort ? { port: deps.goalPort } : {}),
  });
  /**
   * The agent a session belongs to, read from the catalogue the rail renders —
   * the same source the shell uses for the composer's fallback requester name.
   */
  const catalogueAgentName = (sessionId: string): string => {
    const catalog = store.getSnapshot().catalog;
    const flat = selectWebuiCatalogFlatPage(catalog);
    const tree = selectWebuiCatalogTreePage(catalog);
    return selectWebuiSessionAgentName(selectWebuiSessionLookups(flat, tree), sessionId);
  };
  const readAgentName = deps.readAgentName ?? catalogueAgentName;
  const interactions = createWebuiInteractionSessionOwners({
    store,
    ...(deps.interactionsPort ? { port: deps.interactionsPort } : {}),
    readAgentName,
  });
  /**
   * The one selection command. Selecting activates the new session's scope and
   * releases the previous selection's lease — and only that lease, so an
   * accepted delivery or an outstanding settlement survives the navigation.
   */
  const selectSession = (sessionId: string | undefined): void => {
    sessionScope.select(sessionId);
    store.select(sessionId);
    composerController?.selectSession(sessionId);
    // Selecting is where a retained dirty marker pays out: the session was
    // marked while nothing needed it, and now something does (plan §4.3).
    if (sessionId !== undefined && dirtyResources.has(sessionId)) {
      dirtyResources.delete(sessionId);
      reconcileSession(sessionId);
    }
  };
  const readActiveSessionId =
    deps.readActiveSessionId ?? (() => store.getSelectedSessionId());
  // The one unread controller: hydration ordering and the single persistence
  // writer. It is *not* hydrated here: hydration is the one thing that reads
  // persisted browser state, so it belongs to `start`, after the initial route
  // is known. `recordEvent` stays gated on the hydration flag, and the ingress
  // is opened after hydration in the same call, so the ordering guarantee is
  // unchanged (plan §4.1).
  const unread = createWebuiUnreadController({
    store,
    ...(deps.unreadStorage?.read ? { read: deps.unreadStorage.read } : {}),
    ...(deps.unreadStorage?.write ? { write: deps.unreadStorage.write } : {}),
  });
  const composer = deps.composer ?? createWebuiComposerStore();
  // The two fence cells (§8 Phase 3 B2). Created once per application, because
  // the coordinator that uses one is constructed on every render and a counter
  // living in it would reset; published, because §4.2 field 6 makes the goal's
  // fence `goal`'s state and interactions' late-read protection `interactions'`,
  // so the component must not be the thing that declares them.
  const versionCells = createWebuiVersionCells();
  // The opaque identity/freshness context (§4.5). Created once per instance so a
  // remount gets fresh tokens, and published because every owner that keys a
  // resource by credential/config generation reads it.
  const identityEpochs = createWebuiIdentityEpochs();
  // The effects slot: the initial set is the composition root's, and a later
  // registration (the subtree that owns the effects) replaces it in place. The
  // coordinator holds the slot object, not a copy of its members, so a
  // registration made after construction is what the next event sees.
  /**
   * The reactions a surface subscribes to for the two signals that carry no
   * session id of their own. They run after the owners have been routed to, and
   * they cannot replace a route (plan §4.4).
   */
  const workspaceGitListeners = new Set<(payload: WebuiWorkspaceGitChangedPayload) => void>();
  /**
   * The dirty markers a read-required event left behind for a session nothing
   * needs yet. They survive until interest arrives or the session is purged —
   * the alternative, dropping the event, is the silent loss plan §4.3 forbids.
   */
  const dirtyResources = new Set<string>();
  const channelReadyListeners = new Set<() => void>();
  const notify = <T>(listeners: Set<(value: T) => void>, value: T): void => {
    for (const listener of [...listeners]) listener(value);
  };
  /**
   * The conversation command set for one session, built on demand: the attach
   * and recheck routes are the application's, so a `session.start` is followed
   * whether or not a composer is mounted (T05).
   */
  const turnCommands = new Map<string, WebuiConversationTurnCommands>();
  let composerController: WebuiComposerController | undefined;
  /**
   * The one reconciliation entry point (plan §4.4): the same owner routes the
   * event path uses, so selection and reconnect do not run a second one.
   */
  const reconcileSession = (sessionId: string): void => {
    if (lifecycleState() === "disposed") return;
    interactions.owner(sessionId).invalidatePendingReads();
    void interactions.owner(sessionId).refresh();
    void goals.owner(sessionId).refreshGoal();
  };
  /**
   * The peer command factories every turn command set here drives (plan §5.3
   * rule 2). Built once: the substrate's port is the same object for every
   * session, so constructing it per session would only add wiring sites.
   */
  const turnCommandCollaborators = createWebuiTurnCommandCollaborators();
  const turnCommandsFor = (sessionId: string | undefined): WebuiConversationTurnCommands => {
    const key = sessionId ?? WEBUI_HOME_SESSION_KEY;
    const existing = turnCommands.get(key);
    if (existing) return existing;
    const commands = createWebuiConversationTurnCommands({
      store,
      sessionId,
      collaborators: turnCommandCollaborators,
      ...(deps.turnCapabilities ? { capabilities: turnCapabilities } : {}),
      deliveries,
      scope: sessionScope,
    });
    turnCommands.set(key, commands);
    return commands;
  };
  const events = createWebuiEventCoordinator({
    store,
    leases,
    readActiveSessionId,
    unread,
    // The permanent routes, installed here — before `start` opens ingress —
    // and outside anything a view can replace, so no surface can displace them.
    routes: {
      setGoal: (sessionId, goal) => goals.owner(sessionId).applyGoal(goal),
      refreshGoal: (sessionId) => goals.owner(sessionId).refreshGoal(),
      invalidatePending: (sessionId) => interactions.owner(sessionId).invalidatePendingReads(),
      refreshPending: (sessionId) => {
        if (!sessionScope.isInterested(sessionId)) {
          // No interest yet: retain the marker and reconcile when it arrives,
          // rather than fanning out a background read (plan §4.3).
          dirtyResources.add(sessionId);
          return;
        }
        dirtyResources.delete(sessionId);
        return interactions.owner(sessionId).refresh();
      },
      attachStream: (sessionId, turnId, mode) => {
        const commands = turnCommandsFor(sessionId);
        if (mode === "recheck") commands.recheck(turnId);
        else commands.attach(turnId);
      },
      // The application's own reconciliation first, then the surfaces that
      // subscribed: a reconnect is a possible observation gap, not a barrier.
      channelReady: () => {
        for (const sessionId of sessionScope.interested()) {
          dirtyResources.delete(sessionId);
          reconcileSession(sessionId);
          turnCommandsFor(sessionId).recover();
        }
        notify(channelReadyListeners, undefined);
      },
      workspaceGitChanged: (payload) => notify(workspaceGitListeners, payload),
    },
  });
  const turns = createWebuiTurnCoordinator({
    store,
    leases,
    ...deps.turns,
  });
  // The slice is cut once, here, from the port the composition root holds. A
  // caller of `attachTurn` / `sendTurn` / `stopTurn` never supplies a
  // capability again (plan §8 Phase 1 step 1).
  const turnCapabilities = createWebuiTurnCapabilitySlice(
    deps.turnCapabilities ?? {},
  );
  const turnReview = createWebuiTurnReviewOwner({ port: deps.turnReview ?? {} });
  const transcriptHistory = createWebuiTranscriptHistoryOwner({
    // The substrate writes the transcript slice through this contract rather than
    // through the record repository (plan §5.3).
    transcript: createWebuiTranscriptHistoryWriter(store),
    loadMessages: deps.loadMessages,
  });
  // The business owners, built by the assembly rather than by the mounted view
  // (T19; plan §6 W6, the shell's own treatment). A view composes screens and
  // reads these; it neither builds one nor holds the capability to build one, so
  // "which business can reach which port" is decided here rather than by which
  // port a component happened to be handed.
  const slices = deps.slices ?? createWebuiPortSlices(deps.turnCapabilities ?? {});
  const terminalOwner = createWebuiTerminalOwner(slices.workspace);
  const transcriptCommands: WebuiTranscriptCommands = {
    ...(slices.sessions.getSessionForkOptions
      ? { getSessionForkOptions: (request) => slices.sessions.getSessionForkOptions!(request) }
      : {}),
    ...(slices.sessions.forkSession
      ? { forkSession: (request) => slices.sessions.forkSession!(request) }
      : {}),
    ...(slices.transcript.getSessionRewindPreview
      ? { getSessionRewindPreview: (request) => slices.transcript.getSessionRewindPreview!(request) }
      : {}),
    ...(slices.transcript.rewindSession
      ? { rewindSession: (request) => slices.transcript.rewindSession!(request) }
      : {}),
    ...(slices.transcript.editSessionMessage
      ? { editSessionMessage: (request) => slices.transcript.editSessionMessage!(request) }
      : {}),
  };
  const sessionWorkflows = createWebuiSessionWorkflows({
    store,
    // A delete clears the composer slot's draft and history, so a fresh session
    // does not inherit the deleted session's text.
    composer,
    port: slices.sessions,
    ...(deps.sessionImport ? { importSession: deps.sessionImport } : {}),
    ...(deps.sessionExport ? { exportSession: deps.sessionExport } : {}),
    // A delete is an accepted mutation: it holds a settlement lease and revokes
    // the deleted session's interests (plan §4.3).
    scope: sessionScope,
  });
  const commandWorkflows = createWebuiCommandWorkflows({ port: slices.composer });
  composerController = createWebuiComposerController({
    store: composer,
    readSelectedSessionId: readActiveSessionId,
    adoptHomeSession: (sessionId) => {
      store.migrateSession(WEBUI_HOME_SESSION_KEY, sessionId);
      composer.adoptHome(sessionId);
      selectSession(sessionId);
    },
    turnCommandsFor,
    commandWorkflows,
    canEnqueue: turnCapabilities.enqueue !== undefined,
    canSend: turnCapabilities.send !== undefined,
    readGoal: (sessionId) => store.readSession(sessionId).goal,
    createOrPatchGoal: async (input, onSessionCreated) => {
      const originalSessionId = input.sessionId;
      const recordKey = originalSessionId ?? WEBUI_HOME_SESSION_KEY;
      const initialOwner = goals.owner(recordKey);
      let targetSessionId = originalSessionId;
      let usesPatch = Boolean(store.readSession(recordKey).goal && initialOwner.patchGoal);
      let createdSessionId: string | undefined;
      const goal = await submitWebuiGoal({
        sessionId: originalSessionId,
        objective: input.objective,
        currentGoal: store.readSession(recordKey).goal,
        createGoal: initialOwner.createGoal ?? (async () => { throw new Error("当前运行时不支持创建目标"); }),
        ...(initialOwner.patchGoal ? { patchGoal: initialOwner.patchGoal } : {}),
        resolveGoal: (sessionId) => {
          targetSessionId = sessionId;
          const owner = goals.owner(sessionId);
          const currentGoal = store.readSession(sessionId).goal;
          usesPatch = Boolean(currentGoal && owner.patchGoal);
          return {
            currentGoal,
            createGoal: owner.createGoal ?? (async () => { throw new Error("当前运行时不支持创建目标"); }),
            ...(owner.patchGoal ? { patchGoal: owner.patchGoal } : {}),
          };
        },
        ...(sessionWorkflows.createSession ? { createSession: sessionWorkflows.createSession } : {}),
        ...(input.createSessionWorkspaceDir ? { createSessionWorkspaceDir: input.createSessionWorkspaceDir } : {}),
        ...(input.teamModeOff ? { teamModeOff: true } : {}),
      }, (sessionId) => {
        createdSessionId = sessionId;
        onSessionCreated(sessionId);
      });
      const sessionId = targetSessionId ?? createdSessionId;
      if (!sessionId) throw new Error("创建目标会话未返回会话 ID");
      if (!usesPatch) goals.owner(sessionId).applyGoal(goal);
      return { goal, sessionId };
    },
    refreshPending: (sessionId) => interactions.owner(sessionId).refresh(),
    refreshGoal: async (sessionId) => { await goals.owner(sessionId).refreshGoal(); },
    recoverTurn: (sessionId) => turnCommandsFor(sessionId).recover(),
    refreshInspection: async (sessionId) => {
      await Promise.all([modelsWorkflows.loadModels(sessionId), accountWorkflows.loadAccount(sessionId)]);
    },
    clearHomeTurn: () => {
      const writer = store.createSessionWriter({ kind: "home" });
      const lifecycle = createWebuiTurnLifecycleCommands({ setStream: writer.setStream, setSending: writer.setSending });
      lifecycle.clearStream();
      lifecycle.setTurnSending(false);
    },
  });
  const workspaceQueries = createWebuiWorkspaceQueries({ port: slices.workspace });
  const accountWorkflows = createWebuiAccountWorkflows({
    port: slices.account,
    identityEpochs,
  });
  const settingsWorkflows = createWebuiSettingsWorkflows({
    port: slices.settings,
    identityEpochs,
  });
  // `models` owns the catalogue, the selection and the provider list (plan
  // §5.6). The one call that crosses the boundary is the api-key upsert's: it
  // refreshes `settings`' status read through that owner's published command
  // rather than copying the read.
  const modelsWorkflows = createWebuiModelsWorkflows({
    port: slices.models,
    refreshApiKeyStatus: () => accountWorkflows.loadApiKeyStatus(),
    identityEpochs,
  });
  const pluginWorkflows = createWebuiPluginWorkflows({ port: slices.plugins });
  // The composer's view of what is installed and what the agent can run: a
  // separate read model from `pluginWorkflows` on purpose, so neither
  // overwrites the other when one reloads (T08).
  /**
   * The task/session use case (plan §5.5 P01 step 3). The workspace policy it owns
   * used to be the shell's: which directory a fresh home starts in, what the
   * auto-fill may do to it, and what an explicit pick means. It is constructed
   * here because it needs the canonical store, the composer store and the session
   * catalogue; the host injects only the persisted preference.
   */
  const taskSessionWorkflows = createWebuiTaskSessionWorkflows({
    store,
    composer,
    storage: {
      readNoProjectFlag: () => deps.workspacePreference?.readNoProjectFlag?.() ?? false,
      writeNoProjectFlag: (value) => deps.workspacePreference?.writeNoProjectFlag?.(value),
    },
    catalogue: sessionWorkflows,
  });

  const composerPluginCatalogue = createWebuiComposerPluginCatalogue({
    actions: createWebuiPluginActions(slices.plugins),
    ...(slices.plugins.listSkills ? { listSkills: slices.plugins.listSkills } : {}),
  });
  // The plan-review reply goes to the session's interaction owner (T05). The
  // selection and the agent name are read when the reply is submitted rather
  // than captured by the view that renders the card, so a card left open across
  // a selection change replies to the session it belongs to.
  // One shared, deduplicated active-turn probe (plan §7.1). The rail and the
  // composer ask the same question, so a probe racing between two views for one
  // session collapses to one round trip; the probe is built by the assembly so a
  // second consumer cannot build a second one (T19).
  const activeTurnProbe = webuiActiveTurnProbeFor(slices.turn.activeTurn);
  const planReviewWorkflow = createWebuiPlanReviewWorkflow({
    answerQuestionnaire: (request, answers) => {
      const target = readActiveSessionId();
      if (!target) {
        return Promise.resolve({ ok: false, error: "Questionnaire replies are unavailable" });
      }
      return interactions
        .owner(target)
        .answerQuestionnaire(request, answers, readAgentName(target));
    },
  });
  // The ingress handle: nothing is opened at construction. `start` opens exactly
  // one channel and attaches the coordinator to it; `dispose` detaches, disposes
  // the store that fences late commits, and closes the channel.
  let lifecycle: WebuiApplicationLifecycleState = "constructed";
  /** Read by helpers defined above the lifecycle block. */
  const lifecycleState = (): WebuiApplicationLifecycleState => lifecycle;
  let channel: WebuiProcessEventChannel | undefined;
  let detach: (() => void) | undefined;

  return {
    state: () => lifecycle,
    start: (options) => {
      // A disposed instance is terminal: no hydration, no ingress, no second
      // life through the same object (plan §4.1).
      if (lifecycle === "disposed") return false;
      if (lifecycle === "started") return true;
      const initialSessionId = options?.initialSessionId;
      // Order matters: the route the caller booted at is applied first, so the
      // unread restore drops the count for the session being opened rather than
      // raising the badge the user is looking at.
      if (initialSessionId !== undefined) selectSession(initialSessionId);
      unread.hydrate(initialSessionId ?? readActiveSessionId());
      channel = deps.openEventChannel();
      detach = events.attach(channel);
      lifecycle = "started";
      return true;
    },
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    // Read through the store's live snapshot, exactly as the selectors did at
    // their call sites; `undefined` selects the home slot (plan §4.2 home
    // adoption), which is the assembly's own identity for "no session yet".
    reads: {
      stream: (sessionId) =>
        selectWebuiSessionStream(
          store.getSnapshot(),
          sessionId ?? WEBUI_HOME_SESSION_KEY,
        ),
      transcriptPage: (sessionId) =>
        selectWebuiSessionTranscriptPage(store.getSnapshot(), sessionId),
    },
    select: selectSession,
    store,
    leases,
    sessionScope,
    deliveries,
    goals,
    interactions,
    events,
    turns,
    turnCapabilities,
    turnReview,
    transcriptHistory,
    transcriptCommands,
    unread,
    composer,
    composerController,
    portSlices: slices,
    terminalOwner,
    sessionWorkflows,
    taskSessions: taskSessionWorkflows,
    commandWorkflows,
    workspaceQueries,
    accountWorkflows,
    settingsWorkflows,
    modelsWorkflows,
    pluginWorkflows,
    composerPluginCatalogue,
    activeTurnProbe,
    planReviewWorkflow,
    versionCells,
    identityEpochs,
    reconcile: (sessionId) => {
      // A disposed instance reconciles nothing: its store is fenced, so a read
      // that landed now could not commit anyway.
      if (lifecycle === "disposed") return;
      const target = sessionId ?? readActiveSessionId();
      if (!target) return;
      reconcileSession(target);
    },
    adoptHomeSession: (sessionId) => {
      // One committed transition: the home turn's live record moves onto the
      // created session, the composer's home slot moves onto it, and the
      // session is selected. Migration is no-notify (the view switching keys
      // re-reads the target in its own effect); selection notifies once.
      store.migrateSession(WEBUI_HOME_SESSION_KEY, sessionId);
      composer.adoptHome(sessionId);
      selectSession(sessionId);
    },
    onWorkspaceGitChanged: (listener) => {
      workspaceGitListeners.add(listener);
      return () => workspaceGitListeners.delete(listener);
    },
    onChannelReady: (listener) => {
      channelReadyListeners.add(listener);
      return () => channelReadyListeners.delete(listener);
    },
    dispose: () => {
      if (lifecycle === "disposed") return;
      detach?.();
      detach = undefined;
      // Close what this client is observing before fencing the store: the
      // attempt's frames can no longer reach a snapshot, and the host turn keeps
      // running (plan §4.3, §8.1).
      deliveries.closeAll();
      sessionScope.dispose();
      goals.dispose();
      interactions.dispose();
      // The account owner runs the login and OAuth-status polls, so its end is
      // the application's end rather than a component unmount (T09, T19).
      accountWorkflows.dispose();
      sessionWorkflows.dispose();
      // The terminal owner's disposer is the client's own end: its watches stop
      // and the PTYs it created are killed here rather than left running for a
      // page that is going away (T15 criterion 3). Fire-and-forget because this
      // disposal is synchronous; the requests are already on their way.
      void terminalOwner.disposeAll();
      workspaceGitListeners.clear();
      channelReadyListeners.clear();
      dirtyResources.clear();
      turnCommands.clear();
      composerController?.dispose();
      store.dispose();
      channel?.close?.();
      channel = undefined;
      lifecycle = "disposed";
    },
  };
}
