/**
 * The shell's activity wiring: the unread/activity slice it renders from, and
 * every reaction that keeps it current.
 *
 * Three inputs feed the rail's activity, none sufficient alone: the list seeds
 * first-paint times, the global event stream keeps them current (it carries no
 * session id, so one subscription covers every row), and `getActiveTurn` repairs
 * what the stream never delivered. On top of that sit the reconnect nonce (the
 * events that would have said a turn started were missed while the stream was
 * down) and the clock tick the age labels are a function of.
 *
 * The writes belong to the application's unread controller; this hook is the
 * shell's read and its subscriptions, which is why nothing here persists
 * anything (restore before the first write lives in one place, and it is not
 * this one).
 *
 * What this hook does *not* subscribe to is as load-bearing as what it does. A
 * workspace-git change and a settled turn mutation both invalidate resources
 * other businesses read, and both links are installed by the assembly before
 * event ingress starts. Routing them through a mount meant a fact reached two
 * owners only while a particular view happened to be on screen — so the reactions
 * below are about the rail's own view of the world (reconnect, selection, read
 * state, age) and nothing else.
 *
 * The options are the capabilities this wiring uses, not the application object:
 * the shell may not reach into the assembly that composes it (role rule), and
 * the active-turn probe's own type lives with the turn substrate. The caller
 * supplies `probeActiveTurns` as a closure, so the probe stays opaque here and
 * no second declaration of it exists.
 *
 * Extracted from `WebuiClientFoundationApp.tsx`.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { WebuiSessionActivityMap } from "../features/sessions/projection/session-activity.js";
import type { WebuiClientSession } from "../features/sessions/contracts/session-view.js";

/** The activity slice, as the shell's session store holds it. */
export interface ShellActivitySessionStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => { readonly activity: WebuiSessionActivityMap };
}

export type ShellSessionActivity = WebuiSessionActivityMap;

/** The rows the unread controller seeds from, and the probe's narrower input. */
export type ShellActivitySessionRow = Pick<WebuiClientSession, "sessionId" | "updatedAt">;
export type ShellActivityProbeRow = Pick<WebuiClientSession, "sessionId">;

export interface UseShellActivityWiringOptions {
  readonly sessionStore: ShellActivitySessionStore;
  /** The rail's current page; its sessions seed the restore and the probe. */
  readonly railPage: { readonly sessions: readonly ShellActivitySessionRow[] };
  readonly selectedSessionId: string | undefined;
  /** Fires when the channel is ready again, so the rail can re-probe. */
  readonly onChannelReady: (listener: () => void) => () => void;
  /** Follows the route the shell resolved; the application keeps the one record. */
  readonly select: (sessionId: string | undefined) => void;
  readonly markRead: (sessionId: string) => void;
  readonly seed: (sessions: readonly ShellActivitySessionRow[]) => void;
  readonly hydrate: (sessionId: string | undefined) => void;
  /**
   * Declares which rows the rail is interested in.
   *
   * Interest, not work: the application's scheduler compares the *identity set*
   * and issues a probe only for an identity that is newly interesting, so a
   * refresh that only changes the search text costs nothing. The caller closes
   * over the probe the assembly built, which keeps its type out of this module.
   */
  readonly setActivityInterest: (sessions: readonly ShellActivityProbeRow[]) => void;
  /** A reconnect: nothing observed while the stream was down can be trusted. */
  readonly reconcileActivity: () => void;
}

export interface ShellActivityWiring {
  readonly sessionActivity: ShellSessionActivity;
  readonly activityNow: number;
  readonly activityProbeNonce: number;
}

export function useShellActivityWiring(
  options: UseShellActivityWiringOptions,
): ShellActivityWiring {
  const {
    sessionStore,
    railPage,
    selectedSessionId,
    onChannelReady,
    select,
    markRead,
    seed,
    hydrate,
    setActivityInterest,
    reconcileActivity,
  } = options;

  const sessionActivity = useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSnapshot().activity,
    () => sessionStore.getSnapshot().activity,
  );
  const [activityNow, setActivityNow] = useState(() => Date.now());
  // Bumped on reconnect to re-probe: the events that would have told us a turn
  // started were missed while the stream was down, and the stream cannot
  // replay them. `SessionComposer` closes the same gap the same way.
  const [activityProbeNonce, setActivityProbeNonce] = useState(0);

  /**
   * The shell's remaining reaction, subscribed rather than installed as a
   * replaceable set: it runs after the application's own routes have run and
   * cannot displace one. Temporary adapter until the reconnect reconciliation
   * has an owner.
   */
  useEffect(
    () =>
      onChannelReady(() => {
        setActivityNow(Date.now());
        setActivityProbeNonce((nonce) => nonce + 1);
      }),
    [onChannelReady],
  );
  // The application's selection follows the route the shell resolved. The
  // coordinator and the unread controller judge events against the selected
  // session, so the store's selection is the one record of it — the shell does
  // not keep a second copy to hand over.
  useEffect(() => {
    select(selectedSessionId);
  }, [select, selectedSessionId]);
  // Opening a session is what marks it read. Keyed on the id rather than run on
  // mount, so arriving *at* a session from a link does not clear the badge the
  // user was about to see on the row they came from.
  useEffect(() => {
    if (!selectedSessionId) return;
    markRead(selectedSessionId);
  }, [markRead, selectedSessionId]);
  // The age labels are a function of the clock, not of the data. Without a tick
  // they would freeze at whatever they read when the last event arrived, and
  // every row would agree on how long ago "now" was.
  useEffect(() => {
    const timer = setInterval(() => setActivityNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // Seeding needs the page; the restore does not, which is why they are two
  // effects. `railPage` is a fresh object on every refresh and on every search
  // keystroke, so folding the restore into this one would re-read storage and
  // re-apply it over the live counts on every keystroke.
  useEffect(() => {
    seed(railPage.sessions);
  }, [seed, railPage]);
  // Re-hydrate when the open session changes: the active session is excluded
  // from the restore, so arriving at a different one must not inherit the badge
  // the previous one cleared. The controller marks itself hydrated on the first
  // call (the composition root hydrates before the channel opens), and this
  // later call only re-applies the floor.
  useEffect(() => {
    hydrate(selectedSessionId);
  }, [hydrate, selectedSessionId]);
  useEffect(() => {
    // The interest set, not a probe per page object: the scheduler reads the
    // identities in it and issues work only for the ones that are newly
    // interesting, which is what makes a search keystroke cost zero probes.
    setActivityInterest(railPage.sessions);
  }, [setActivityInterest, railPage]);
  useEffect(() => {
    // Once per reconnect. Not once per event: the stream already answers for the
    // turns it saw, and a reconnect is the only other moment that invalidates
    // what the rail believes.
    if (activityProbeNonce === 0) return;
    reconcileActivity();
  }, [reconcileActivity, activityProbeNonce]);

  return { sessionActivity, activityNow, activityProbeNonce };
}
