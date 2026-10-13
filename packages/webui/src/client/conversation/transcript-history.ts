// Transcript history request ownership (plan §4.2 "history request
// coordination", §4.5 "History owns a per-session/page resource with independent
// request generations, plus a selected-view generation for presentation").
//
// This used to be a singleton: one `selectedSessionId`, one `generation` and one
// `requestId` for the whole owner. Two of the plan's problems followed from that.
// A page request for one session fenced a page request for another, and a
// head-page request and an older-page request for the same session shared one
// identity, so a pagination anchor and a stream-recovery read were conflated —
// §4.5: "stream recovery and older-page pagination cannot be assumed to share
// one key".
//
// There are now two identities, and they are the two contracts of
// `request-freshness`:
//
// - a **keyed resource** per `(sessionId, anchor)`, where the anchor is the page
//   cursor or `head`. Each key carries its own request generation, so a newer
//   request supersedes only its own key's earlier answer;
// - a **selected-view slot** for presentation. Selecting another session
//   invalidates the token captured for the session that left, so its late answer
//   is refused — the promise the old singleton made, kept separate from the
//   per-page identity instead of entangled with it.

import type {
  WebuiClientMessageLoader,
  WebuiClientMessagePage,
} from "../features/transcript/contracts/message-view.js";
import {
  createWebuiKeyedResource,
  createWebuiSelectedSlot,
  type WebuiCommitToken,
} from "./request-freshness.js";
import { mergeOlderTranscriptPage } from "./transcript-request-ownership.js";

/**
 * The slice this owner writes, as a contract the assembly satisfies.
 *
 * The conversation substrate may not reach the session-record repository (plan
 * §5.3: conversation depends on pure shared DTOs and injected IO/writer
 * contracts), so what it needs is stated here and the application adapts its
 * store to it.
 */
export interface WebuiTranscriptHistoryWriter {
  readonly updateTranscript: (
    sessionId: string,
    update: (current: WebuiTranscriptRecord) => WebuiTranscriptRecord,
  ) => void;
}

/** The transcript slice of one session's record, as this owner reads it. */
export interface WebuiTranscriptRecord {
  readonly page: WebuiClientMessagePage;
  readonly generation: number;
  readonly loading: boolean;
  readonly error?: string;
}

/** The page a load produced, and the identity a later check is made against. */
export interface WebuiTranscriptPageHandle {
  readonly sessionId: string;
  /** Absent for the head page. */
  readonly cursor?: string;
  readonly token: WebuiCommitToken;
}

export interface WebuiTranscriptHistoryOwner {
  readonly selectSession: (sessionId: string | undefined) => void;
  readonly seed: (sessionId: string, page: WebuiClientMessagePage) => void;
  /**
   * Reads the head page, joining a read already in flight for that key.
   *
   * Opening a session view is the caller: two readers wanting the same page at
   * once (the transcript and a context inspection) share one request rather than
   * one superseding the other.
   */
  readonly loadPage: (sessionId: string) => Promise<WebuiTranscriptLoadOutcome>;
  /**
   * Reads the head page as it is NOW: freshness advances first, so an answer
   * already in flight cannot land. A turn settling is the caller — the page it
   * held was written before the turn's messages were persisted.
   */
  readonly refreshPage: (sessionId: string) => Promise<WebuiTranscriptLoadOutcome>;
  readonly loadOlder: (
    sessionId: string,
    cursor: string,
  ) => Promise<WebuiTranscriptLoadOutcome>;
  /** Whether the page a load produced is still the one its key holds. */
  readonly isCurrentPage: (handle: WebuiTranscriptPageHandle) => boolean;
  /**
   * The head page for a session, from this owner's keyed resource: a cached answer
   * is returned as it is, and otherwise one read is issued (or joined, when the
   * transcript is already reading the same key).
   *
   * This is the seam a *context-only* inspection uses (plan §4.5: "context-only
   * inspection can reuse a compatible history response"). It exists so the
   * composer reads the transcript's page instead of issuing its own `getMessages`
   * for the same session, which used to cost a second page read on every switch.
   */
  readonly ensurePage: (sessionId: string) => Promise<WebuiClientMessagePage | undefined>;
}

export type WebuiTranscriptLoadOutcome =
  | { readonly status: "applied"; readonly page: WebuiTranscriptPageHandle }
  | { readonly status: "stale" }
  | { readonly status: "failed" };

/** Owns transcript history RPCs and commits their results into the one session map. */
export function createWebuiTranscriptHistoryOwner(deps: {
  readonly transcript: WebuiTranscriptHistoryWriter;
  readonly loadMessages?: WebuiClientMessageLoader;
}): WebuiTranscriptHistoryOwner {
  const pages = createWebuiKeyedResource<WebuiClientMessagePage>();
  const presentation = createWebuiSelectedSlot<{ readonly sessionId: string }>();
  const incarnation = pages.capture({ sessionId: "", anchor: "head" }).incarnation;

  const keyOf = (sessionId: string, cursor: string | undefined) => ({
    sessionId,
    anchor: cursor ?? "head",
  });

  const selectSession = (sessionId: string | undefined): void => {
    if (presentation.identity() === sessionId) return;
    presentation.select(sessionId);
    if (sessionId)
      deps.transcript.updateTranscript(sessionId, (current) => ({
        ...current,
        generation: current.generation + 1,
        loading: !current.page.messages,
      }));
  };

  const seed = (sessionId: string, page: WebuiClientMessagePage): void => {
    deps.transcript.updateTranscript(sessionId, (current) =>
      current.page.messages ? current : { ...current, page, loading: false },
    );
  };

  /**
   * One page read for one key.
   *
   * `join` goes through the resource's own read, so two readers asking for the
   * same key share one request — the context inspection and the transcript do
   * exactly that when a session view opens. `fresh` advances the key's freshness
   * first, which is what a caller wants when the answer may have changed under it
   * (a turn just settled, a mutation landed): the read already in flight can no
   * longer commit and a new one starts.
   */
  const load = async (
    sessionId: string,
    cursor: string | undefined,
    mode: "join" | "fresh",
  ): Promise<WebuiTranscriptLoadOutcome> => {
    if (!deps.loadMessages) return { status: "failed" };
    if (presentation.identity() !== sessionId) selectSession(sessionId);
    const key = keyOf(sessionId, cursor);
    if (mode === "fresh") pages.invalidate(key);
    // Captured before the read: refused if the presentation has moved on.
    const presentationToken = presentation.capture();
    deps.transcript.updateTranscript(sessionId, (state) => ({
      ...state,
      loading: true,
      error: undefined,
    }));
    const loadMessages = deps.loadMessages;
    // What THIS read produced. A joining read produces nothing (its fetch is
    // never called), and a read the resource refused produces nothing either —
    // both are told apart below by whether the entry carries this exact answer.
    let own: { readonly value?: WebuiClientMessagePage } = {};
    await pages.load(key, async () => {
      const value = await loadMessages({
        id: sessionId,
        ...(cursor ? { before: cursor } : {}),
      });
      own = { value };
      return value;
    });
    const entry = pages.read(key);
    // Not holding a ready answer: either this read was superseded (by a newer
    // request for the same key, or by an invalidation) or it failed.
    if (!entry || entry.status !== "ready" || (own.value && entry.value !== own.value)) {
      // A superseded failure reports nothing: it belongs to a read nobody is
      // waiting for any more.
      if (entry?.status === "error" && own.value === undefined) {
        const failure = entry.error;
        deps.transcript.updateTranscript(sessionId, (state) => ({
          ...state,
          error: failure,
          loading: false,
        }));
        return { status: "failed" };
      }
      return { status: "stale" };
    }
    const page = entry.value;
    // `WebuiResourceState.value` is optional even for a ready entry, so the page
    // is asserted once here rather than at each use.
    if (!page) return { status: "stale" };
    // The presentation fence: a page that arrived for a session the view has
    // left is not written, so the store never gains a page nothing presented.
    if (
      !presentation.commit(presentationToken, {
        status: "ready",
        value: { sessionId },
      })
    ) {
      return { status: "stale" };
    }
    deps.transcript.updateTranscript(sessionId, (state) => {
      const current = state;
      const olderResult = cursor
        ? mergeOlderTranscriptPage(
            {
              ownerSessionId: sessionId,
              generation: current.generation,
              page: current.page,
              loading: false,
            },
            page,
            cursor,
          )
        : undefined;
      return {
        ...state,
        page: olderResult?.state.page ?? page,
        loading: false,
        ...(olderResult?.error ? { error: olderResult.error } : {}),
      };
    });
    return {
      status: "applied",
      page: { sessionId, ...(cursor ? { cursor } : {}), token: pages.capture(key) },
    };
  };

  const ensurePage = async (
    sessionId: string,
  ): Promise<WebuiClientMessagePage | undefined> => {
    const key = keyOf(sessionId, undefined);
    const cached = pages.read(key);
    if (cached?.status === "ready") return cached.value;
    if (!deps.loadMessages) return undefined;
    const loadMessages = deps.loadMessages;
    await pages.load(key, () => loadMessages({ id: sessionId }));
    const entry = pages.read(key);
    return entry?.status === "ready" ? entry.value : undefined;
  };

  return {
    selectSession,
    seed,
    ensurePage,
    loadPage: (sessionId) => load(sessionId, undefined, "join"),
    refreshPage: (sessionId) => load(sessionId, undefined, "fresh"),
    loadOlder: (sessionId, cursor) => load(sessionId, cursor, "fresh"),
    isCurrentPage: (handle) =>
      !pages.isDisposed() &&
      handle.token.incarnation === incarnation &&
      pages.revision(keyOf(handle.sessionId, handle.cursor)) ===
        handle.token.revision,
  };
}
