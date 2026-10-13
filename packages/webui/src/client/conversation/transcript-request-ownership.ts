// Transcript page merging.
//
// This module used to also carry a request-ownership coordinator: a generation
// plus request-id fence, a `runWebuiTranscriptPageRequest` wrapper that drove
// load/success/error/finally through it, and two state helpers. None of it had
// a production caller — `transcript-history.ts` owns request ownership for the
// live path and implements the same fence inline — so the only thing keeping
// the coordinator alive was the test that imported it. The behaviour it pinned
// is covered on the live seam instead (`webui-application-commands.test.ts`),
// and what remains here is the one function the application actually calls.
//
// `WebuiOwnedTranscriptState` stays because `mergeOlderTranscriptPage` takes it.

import type { WebuiClientMessagePage } from "../features/transcript/contracts/message-view.js";

function mergeQueryCollapseViews(
  current: NonNullable<WebuiClientMessagePage["queryCollapseViews"]>,
  older: NonNullable<WebuiClientMessagePage["queryCollapseViews"]>,
) {
  const byQueryKey = new Map(current.map((view) => [view.queryKey, view]));
  for (const view of older) byQueryKey.set(view.queryKey, view);
  return [...byQueryKey.values()];
}

export interface WebuiOwnedTranscriptState {
  readonly ownerSessionId: string;
  readonly generation: number;
  readonly page: WebuiClientMessagePage;
  readonly loading: boolean;
  readonly error?: string;
}

export function mergeOlderTranscriptPage(
  current: WebuiOwnedTranscriptState,
  olderPage: WebuiClientMessagePage,
  requestedCursor: string,
): { readonly state: WebuiOwnedTranscriptState; readonly error?: string } {
  if (
    (olderPage.messages?.length ?? 0) === 0 ||
    (olderPage.hasMore && olderPage.nextCursor === requestedCursor)
  ) {
    return {
      state: {
        ...current,
        page: { ...current.page, hasMore: false, nextCursor: undefined },
      },
      error: "没有找到更早的消息，请刷新会话后重试。",
    };
  }

  return {
    state: {
      ...current,
      page: {
        messages: [
          ...(olderPage.messages ?? []),
          ...(current.page.messages ?? []),
        ],
        queryCollapseViews: mergeQueryCollapseViews(
          current.page.queryCollapseViews ?? [],
          olderPage.queryCollapseViews ?? [],
        ),
        nextCursor: olderPage.nextCursor,
        hasMore: olderPage.hasMore,
      },
    },
  };
}
