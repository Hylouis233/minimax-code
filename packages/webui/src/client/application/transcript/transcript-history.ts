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
} from "../../contracts/transcript/message-view.js";
import {
  createWebuiKeyedResource,
  createWebuiSelectedSlot,
  type WebuiCommitToken,
} from "../request-freshness.js";
import type { WebuiSessionStore } from "../session-store.js";
import { mergeOlderTranscriptPage } from "./transcript-request-ownership.js";

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
  readonly loadPage: (sessionId: string) => Promise<WebuiTranscriptLoadOutcome>;
  readonly loadOlder: (
    sessionId: string,
    cursor: string,
  ) => Promise<WebuiTranscriptLoadOutcome>;
  /** Whether the page a load produced is still the one its key holds. */
  readonly isCurrentPage: (handle: WebuiTranscriptPageHandle) => boolean;
}

export type WebuiTranscriptLoadOutcome =
  | { readonly status: "applied"; readonly page: WebuiTranscriptPageHandle }
  | { readonly status: "stale" }
  | { readonly status: "failed" };

/** Owns transcript history RPCs and commits their results into the one session map. */
export function createWebuiTranscriptHistoryOwner(deps: {
  readonly store: WebuiSessionStore;
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
      deps.store.updateSession(sessionId, (current) => ({
        ...current,
        transcript: {
          ...current.transcript,
          generation: current.transcript.generation + 1,
          loading: !current.transcript.page.messages,
        },
      }));
  };

  const seed = (sessionId: string, page: WebuiClientMessagePage): void => {
    deps.store.updateSession(sessionId, (current) =>
      current.transcript.page.messages
        ? current
        : {
            ...current,
            transcript: { ...current.transcript, page, loading: false },
          },
    );
  };

  const load = async (
    sessionId: string,
    cursor?: string,
  ): Promise<WebuiTranscriptLoadOutcome> => {
    if (!deps.loadMessages) return { status: "failed" };
    if (presentation.identity() !== sessionId) selectSession(sessionId);
    const key = keyOf(sessionId, cursor);
    // A newer request for THIS key supersedes the one before it. A request for
    // another session, or for another anchor of the same session, keeps its own
    // generation and is unaffected. Freshness advances before the read, so the
    // answer already in flight for the previous revision can no longer commit.
    pages.invalidate(key);
    const token = pages.capture(key);
    // Captured before the read: refused if the presentation has moved on.
    const presentationToken = presentation.capture();
    deps.store.updateSession(sessionId, (state) => ({
      ...state,
      transcript: { ...state.transcript, loading: true, error: undefined },
    }));
    const handle: WebuiTranscriptPageHandle = {
      sessionId,
      ...(cursor ? { cursor } : {}),
      token,
    };
    try {
      const page = await deps.loadMessages({
        id: sessionId,
        ...(cursor ? { before: cursor } : {}),
      });
      if (!pages.commit(token, { status: "ready", value: page })) {
        return { status: "stale" };
      }
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
      deps.store.updateSession(sessionId, (state) => {
        const current = state.transcript;
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
          transcript: {
            ...state.transcript,
            page: olderResult?.state.page ?? page,
            loading: false,
            ...(olderResult?.error ? { error: olderResult.error } : {}),
          },
        };
      });
      return { status: "applied", page: handle };
    } catch (reason) {
      // A superseded request reports nothing: its failure belongs to a read
      // nobody is waiting for any more.
      if (!pages.commit(token, { status: "error" })) return { status: "stale" };
      deps.store.updateSession(sessionId, (state) => ({
        ...state,
        transcript: {
          ...state.transcript,
          error: reason instanceof Error ? reason.message : String(reason),
          loading: false,
        },
      }));
      return { status: "failed" };
    }
  };

  return {
    selectSession,
    seed,
    loadPage: (sessionId) => load(sessionId),
    loadOlder: (sessionId, cursor) => load(sessionId, cursor),
    isCurrentPage: (handle) =>
      !pages.isDisposed() &&
      handle.token.incarnation === incarnation &&
      pages.revision(keyOf(handle.sessionId, handle.cursor)) ===
        handle.token.revision,
  };
}
