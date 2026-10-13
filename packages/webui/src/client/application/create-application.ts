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

import {
  createWebuiEventCoordinator,
  type WebuiEventCoordinator,
  type WebuiEventEffects,
} from "./turn/event-coordinator.js";
import type { WebuiOpenEventChannel } from "./turn/event-channel.js";
import { createWebuiSessionStore } from "./session-store.js";
import type { WebuiSessionStore } from "./session-store.js";
import {
  createWebuiStreamLeaseController,
  type WebuiStreamLeaseController,
} from "./turn/stream-lease-controller.js";
import type { WebuiApplicationState } from "./state.js";
import { WEBUI_HOME_SESSION_KEY } from "./state.js";
import {
  createWebuiTurnCoordinator,
  type WebuiTurnCoordinator,
} from "./turn/turn-coordinator.js";
import type { WebuiTurnCoordinatorDeps } from "./turn/turn-coordinator.js";
import {
  createWebuiUnreadController,
  type WebuiUnreadController,
} from "./sessions/unread.js";
import {
  createWebuiComposerStore,
  type WebuiComposerStore,
} from "./composer/composer-store.js";
import {
  createWebuiVersionCells,
  type WebuiVersionCells,
} from "./version-cell.js";
import {
  createWebuiTranscriptHistoryOwner,
  type WebuiTranscriptHistoryOwner,
} from "./transcript/transcript-history.js";
import type {
  WebuiTurnCapabilityPort,
  WebuiTurnCapabilitySlice,
} from "./turn/turn-capabilities.js";
import { createWebuiTurnCapabilitySlice } from "./turn/turn-capabilities.js";
import type { WebuiClientMessageLoader } from "../contracts/transcript/message-view.js";

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
  readonly effects?: WebuiEventEffects;
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
  readonly loadMessages?: WebuiClientMessageLoader;
  /**
   * The unread storage adapter (`infrastructure/storage.ts`), injected because
   * the application layer may not import infrastructure. Absent degrades to a
   * no-op: hydration completes immediately against no stored counts, which is
   * the correct behaviour for SSR and unit tests.
   */
  readonly unreadStorage?: {
    readonly read?: () => Readonly<Record<string, number>>;
    readonly write?: (counts: Readonly<Record<string, number>>) => void;
  };
  /** Seed for the composer store (SSR / tests). */
  readonly composer?: WebuiComposerStore;
}

export interface WebuiApplication {
  /** The current application snapshot; stable until something changes. */
  readonly getSnapshot: () => WebuiApplicationState;
  /** Subscribe to snapshot changes. Returns a detach; never closes a channel. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly select: (sessionId: string | undefined) => void;
  readonly store: WebuiSessionStore;
  readonly leases: WebuiStreamLeaseController;
  readonly events: WebuiEventCoordinator;
  readonly turns: WebuiTurnCoordinator;
  /** The published turn capability slice (send / resume / load / stop). */
  readonly turnCapabilities: WebuiTurnCapabilitySlice;
  readonly transcriptHistory: WebuiTranscriptHistoryOwner;
  /** The one owner of unread hydration ordering (plan §7.6). */
  readonly unread: WebuiUnreadController;
  /** The one owner of composer drafts and input history (plan §7.6). */
  readonly composer: WebuiComposerStore;
  /**
   * The two version cells, one per fence (§4.2 field 6). The application owns the
   * instance; the business owns the policy and reads the cell it is given.
   */
  readonly versionCells: WebuiVersionCells;
  /**
   * Commit home→session adoption as one transition: carry the home turn's live
   * record onto the created session, move the home composer slot onto it and
   * select it. Both store writes are no-notify; the caller writes the hash and
   * the React selection once.
   */
  readonly adoptHomeSession: (sessionId: string) => void;
  /**
   * Replace the effects the event coordinator runs.
   *
   * The coordinator reads its effects through a slot rather than a value, so the
   * application can be constructed before the effects exist — the composition
   * root builds the application and provides it, and the subtree below it
   * registers the per-session handlers and its own view reactions once it is
   * mounted. Registration **replaces** the whole set and returns a detach that
   * restores the set in force before the call, so a remount is symmetric.
   *
   * Members the set does not carry are removed rather than forwarded as
   * no-ops: the coordinator branches on their presence (`if (effects.setGoal)`
   * chooses between the registered write path and its own store write), so an
   * always-present forwarder would silently take the registered branch.
   */
  readonly setEventEffects: (effects: WebuiEventEffects) => () => void;
  /** Tear down: detach the coordinator, dispose the store, close the channel. */
  readonly dispose: () => void;
}

/**
 * The effects slot the coordinator reads.
 *
 * The coordinator captures the object **once** and closes over it, so the slot's
 * identity is what stays stable while its members change: registering rewrites
 * the keys in place. Members the registration does not carry are deleted rather
 * than left as permanent forwarders, because the coordinator branches on their
 * presence — `if (effects.setGoal)` at `event-coordinator.ts` chooses between the
 * registered goal write path and its own store write, and a forwarder that is
 * always defined would take the registered branch on a host that registered
 * nothing.
 */
function createEventEffectsSlot(initial: WebuiEventEffects): {
  readonly slot: WebuiEventEffects;
  readonly snapshot: () => WebuiEventEffects;
  readonly replace: (next: WebuiEventEffects) => void;
} {
  const slot: Record<string, unknown> = {};
  const replace = (next: WebuiEventEffects): void => {
    for (const key of Object.keys(slot)) delete slot[key];
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined) slot[key] = value;
    }
  };
  replace(initial);
  return {
    slot: slot as WebuiEventEffects,
    snapshot: () => ({ ...(slot as WebuiEventEffects) }),
    replace,
  };
}

export function createWebuiApplication(
  deps: WebuiApplicationDeps,
): WebuiApplication {
  const store = deps.store ?? createWebuiSessionStore();
  const leases = createWebuiStreamLeaseController(store);
  const readActiveSessionId =
    deps.readActiveSessionId ?? (() => store.getSelectedSessionId());
  // The one unread controller: hydration ordering and the single persistence
  // writer. It is hydrated *before* the channel is opened, so a counted event
  // can never arrive against an un-hydrated map (the gate `recordEvent` holds).
  const unread = createWebuiUnreadController({
    store,
    ...(deps.unreadStorage?.read ? { read: deps.unreadStorage.read } : {}),
    ...(deps.unreadStorage?.write ? { write: deps.unreadStorage.write } : {}),
  });
  unread.hydrate(readActiveSessionId());
  const composer = deps.composer ?? createWebuiComposerStore();
  // The two fence cells (§8 Phase 3 B2). Created once per application, because
  // the coordinator that uses one is constructed on every render and a counter
  // living in it would reset; published, because §4.2 field 6 makes the goal's
  // fence `goal`'s state and interactions' late-read protection `interactions'`,
  // so the component must not be the thing that declares them.
  const versionCells = createWebuiVersionCells();
  // The effects slot: the initial set is the composition root's, and a later
  // registration (the subtree that owns the effects) replaces it in place. The
  // coordinator holds the slot object, not a copy of its members, so a
  // registration made after construction is what the next event sees.
  const eventEffects = createEventEffectsSlot(deps.effects ?? {});
  const events = createWebuiEventCoordinator({
    store,
    leases,
    readActiveSessionId,
    unread,
    effects: eventEffects.slot,
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
  const transcriptHistory = createWebuiTranscriptHistoryOwner({
    store,
    loadMessages: deps.loadMessages,
  });
  // Exactly one channel per application instance, opened once. The coordinator
  // is its sole consumer; nothing else subscribes to it directly.
  const channel = deps.openEventChannel();
  const detach = events.attach(channel);

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    select: store.select,
    store,
    leases,
    events,
    turns,
    turnCapabilities,
    transcriptHistory,
    unread,
    composer,
    versionCells,
    adoptHomeSession: (sessionId) => {
      // One committed transition: the home turn's live record moves onto the
      // created session, the composer's home slot moves onto it, and the
      // session is selected. Migration is no-notify (the view switching keys
      // re-reads the target in its own effect); selection notifies once.
      store.migrateSession(WEBUI_HOME_SESSION_KEY, sessionId);
      composer.adoptHome(sessionId);
      store.select(sessionId);
    },
    setEventEffects: (next) => {
      const previous = eventEffects.snapshot();
      eventEffects.replace(next);
      return () => eventEffects.replace(previous);
    },
    dispose: () => {
      detach();
      store.dispose();
      channel.close?.();
    },
  };
}
