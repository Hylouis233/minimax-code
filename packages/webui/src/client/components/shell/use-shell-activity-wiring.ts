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
 * anything (ticket #49 criterion 4: restore before the first write lives in one
 * place, and it is not this one).
 *
 * The options are the capabilities this wiring uses, not the application object:
 * the shell may not reach into the assembly that composes it (role rule, plan
 * §5.3), and the active-turn probe's own type lives with the turn substrate. The
 * caller supplies `probeActiveTurns` as a closure, so the probe stays opaque
 * here and no second declaration of it exists.
 *
 * Extracted from `WebuiClientFoundationApp.tsx` (A-005).
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { WebuiSessionActivityMap } from "../../features/sessions/projection/session-activity.js";
import type { WebuiClientSession } from "../../features/sessions/contracts/session-view.js";

/** The activity slice, as the shell's session store holds it. */
export interface ShellActivitySessionStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => { readonly activity: WebuiSessionActivityMap };
}

export type ShellSessionActivity = WebuiSessionActivityMap;

/** The `workspace.git.changed` signal's shape, as the owner publishes it. */
export interface ShellWorkspaceGitSignal {
  readonly workspace?: string;
  readonly aliases?: readonly string[];
}

/** The rows the unread controller seeds from, and the probe's narrower input. */
export type ShellActivitySessionRow = Pick<WebuiClientSession, "sessionId" | "updatedAt">;
export type ShellActivityProbeRow = Pick<WebuiClientSession, "sessionId">;

export interface ShellActivityWorkspaceQueries {
  readonly invalidateWorkspaceGit: (payload: ShellWorkspaceGitSignal) => void;
  readonly invalidateReview: () => void;
}

export interface UseShellActivityWiringOptions {
  readonly sessionStore: ShellActivitySessionStore;
  readonly workspaceQueries: ShellActivityWorkspaceQueries;
  /** The rail's current page; its sessions seed the restore and the probe. */
  readonly railPage: { readonly sessions: readonly ShellActivitySessionRow[] };
  readonly selectedSessionId: string | undefined;
  /** Routes a `workspace.git.changed` signal to the owner that invalidates views. */
  readonly onWorkspaceGitChanged: (
    listener: (payload: ShellWorkspaceGitSignal) => void,
  ) => () => void;
  /** Fires when the channel is ready again, so the rail can re-probe. */
  readonly onChannelReady: (listener: () => void) => () => void;
  /** Follows the route the shell resolved; the application keeps the one record. */
  readonly select: (sessionId: string | undefined) => void;
  readonly markRead: (sessionId: string) => void;
  readonly seed: (sessions: readonly ShellActivitySessionRow[]) => void;
  readonly hydrate: (sessionId: string | undefined) => void;
  /**
   * Runs the shared, deduplicated active-turn probe (plan §7.1 slice) for the
   * given rows. The caller closes over the probe the assembly built (T19), which
   * keeps its type out of this module.
   */
  readonly probeActiveTurns: (sessions: readonly ShellActivityProbeRow[]) => () => void;
  /** Subscribes to settled turn mutations, which stale the review views. */
  readonly subscribeTurnReviewMutations: (listener: () => void) => () => void;
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
    workspaceQueries,
    railPage,
    selectedSessionId,
    onWorkspaceGitChanged,
    onChannelReady,
    select,
    markRead,
    seed,
    hydrate,
    probeActiveTurns,
    subscribeTurnReviewMutations,
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
   * A `workspace.git.changed` signal invalidates exactly the views it affects: the
   * owner matches the signal against the review and environment views it currently
   * holds and refreshes only those, coalescing the environment reload into its
   * window (ticket #51). The route reaches the owner through this subscription —
   * no shell state and no revision counter in between (T11); the subscription
   * exists because the workspace owners are still built by this mount, which the
   * shell composition (T19) moves.
   */
  useEffect(
    () =>
      onWorkspaceGitChanged((payload) =>
        workspaceQueries.invalidateWorkspaceGit(payload),
      ),
    [onWorkspaceGitChanged, workspaceQueries],
  );
  /**
   * The shell's remaining reaction, subscribed rather than installed as a
   * replaceable set (T05): it runs after the application's own routes have run and
   * cannot displace one. Temporary adapter until the reconnect reconciliation has
   * an owner (T12).
   */
  useEffect(
    () =>
      onChannelReady(() => {
        setActivityNow(Date.now());
        setActivityProbeNonce((nonce) => nonce + 1);
      }),
    [onChannelReady],
  );
  // A settled turn mutation (revert / reapply) changed the working tree, so the
  // review views for it are stale. The turn owner announces the settlement and
  // this is where the affected family is invalidated (plan §4.5: a mutation
  // commits once, then invokes the affected owners' explicit invalidation
  // commands) — no panel keeps a refresh token for it.
  useEffect(
    () => subscribeTurnReviewMutations(() => workspaceQueries.invalidateReview()),
    [subscribeTurnReviewMutations, workspaceQueries],
  );
  // The application's selection follows the route the shell resolved. The
  // coordinator and the unread controller judge events against the selected
  // session, so the store's selection is the one record of it — the shell does
  // not keep a second copy to hand over (plan §4.2, §4.3).
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
    // Once per list change, for every visible row. Not once per event: the
    // stream already answers for turns it saw, and the reconnect nonce is the
    // only other moment a re-probe is warranted.
    return probeActiveTurns(railPage.sessions);
  }, [probeActiveTurns, railPage, activityProbeNonce]);

  return { sessionActivity, activityNow, activityProbeNonce };
}
