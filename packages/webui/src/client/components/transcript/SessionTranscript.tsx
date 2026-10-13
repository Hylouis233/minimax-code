// SessionTranscript — the per-session message log: groups, projectWebuiMessage
// flattening, history paging, streaming loader, and the embedded
// WebuiQuestionnaireResponse renderer for historical questionnaire answers.
//
// W3 tier 4 lift: this cluster (2 components) was moved verbatim out of
// `app.tsx`. The bodies are byte-identical to what used to live there;
// the lift is move-only. `app.tsx` keeps a thin re-export block so
// existing consumers (`webui-shell.test.ts`, importers via `app.tsx`)
// keep their current import path during the W3 wave.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ChatSkeleton } from "./TranscriptSkeletons.js";
import { ActivityIndicator, MessageAfterQueryStreamingPlaceholder, MessagePassiveLoadingPlaceholder } from "./ActivityIndicator.js";
import { TurnNavigator, type TurnSummary } from "./TurnNavigator.js";
import { MessageItem } from "./MessageItem.js";
import { formatWebuiMessageTimestamp } from "../../projection/transcript/message-timestamp.js";
import type { WebuiMessageActionCapabilities } from "../../contracts/transcript/transcript-view.js";
import { useWebuiSessionQuestionnaire, useWebuiSessionState, useWebuiSessionStream, useWebuiTranscriptHistoryOwner } from "../../bindings/use-session-state.js";
import { isTurnLive } from "../../projection/turn/stream-state.js";
import {
  isWebuiPlanReviewRequest,
  webuiPlanMarkdown,
  webuiPlanPath,
} from "../../projection/interactions/plan-mode.js";
import { WebuiPlanDeliveryCard } from "../interactions/PlanModeCards.js";
import type { WebuiClientMessagePage } from "../../contracts/transcript/message-view.js";
import type { WebuiTranscriptItem } from "../../contracts/transcript/transcript-view.js";
import type { WebuiTransport } from "../../contracts/transport.js";
import type { WebuiQuestionnaireRequest } from "../../../shared/contracts/interactions.js";

/** Capability subset the transcript passes through to each message item.
 *  Single source of truth lives in `WebuiTransport`; this alias keeps the
 *  prop block free of per-key `WebuiTransport["x"]` redeclarations. */
type WebuiSessionTranscriptCapabilities = Pick<
  WebuiTransport,
  | "getTurnDiff"
  | "revertTurnDiff"
  | "reapplyTurnDiff"
  | "getSessionForkOptions"
  | "forkSession"
  | "getSessionRewindPreview"
  | "rewindSession"
  | "editSessionMessage"
>;
import type { WebuiTurnDiffView } from "../../../shared/contracts/session.js";
import type { WebuiQuestionnaireResponseSummary } from "../../contracts/transcript/transcript-view.js";
import type { WebuiMessageFileReference } from "../../projection/transcript/message-file-reference.js";
import type { WorkspacePanelCommand } from "../../projection/workspace/workspace-panel-state.js";
import {
  groupWebuiTranscriptItems,
  projectWebuiTranscriptMessages,
  projectWebuiQueryDurations,
  projectWebuiProcessSegments,
} from "../../projection/transcript/transcript-projection.js";
import { projectWebuiTranscriptMessage } from "../../projection/transcript/message-projection.js";
import { projectWebuiTranscriptView } from "../../projection/transcript/transcript-view-model.js";
import {
  projectHistoricalTurnView,
  projectLiveTurnView,
  type WebuiLiveTurnView,
  type WebuiTurnView,
} from "../../projection/transcript/transcript-shape.js";
import {
  transcriptViewport,
  useWebuiTranscriptScroll,
} from "../../bindings/use-transcript-scroll.js";

const EMPTY_TRANSCRIPT_PAGE: WebuiClientMessagePage = {};

/**
 * Historical questionnaire-response projection. Once the user submits a
 * questionnaire we render the question and the recorded answers inside the
 * conversation so a rewinded session still remembers what the user picked.
 */
export function WebuiQuestionnaireResponse({
  messageId,
  summary,
  timestamp,
}: {
  readonly messageId: string;
  readonly summary: WebuiQuestionnaireResponseSummary;
  readonly timestamp?: number;
}): ReactElement {
  const { requestId, answers } = summary;
  return (
    <article
      className="webui-questionnaire-history flex w-full max-w-[80%] min-w-0 flex-col gap-3 rounded-2xl border-[0.5px] border-border_default bg-bg_grouped_secondary_elevated p-4 text-text_default_primary"
      data-webui-questionnaire-history="true"
      data-message-id={messageId}
      data-webui-questionnaire-request={requestId}
      data-testid={`questionnaire-history-${requestId}`}
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <span
          className="text-size_14 font-medium leading-line_height_20 text-text_default_primary"
          data-testid="questionnaire-history-label"
        >
          问卷回答
        </span>
        {typeof timestamp === "number" ? (
          <time
            className="shrink-0 text-size_12 leading-line_height_16 text-text_default_tertiary"
            dateTime={new Date(timestamp).toISOString()}
            data-testid="questionnaire-history-timestamp"
          >
            {formatWebuiMessageTimestamp(timestamp)}
          </time>
        ) : null}
      </header>
      <ul
        className="webui-questionnaire-history-answers flex min-w-0 flex-col gap-3"
        data-testid="questionnaire-history-answers"
      >
        {answers.map((answer, index) => (
          <li
            key={`${requestId}-${index}`}
            className="webui-questionnaire-history-answer flex min-w-0 flex-col gap-1.5 text-size_14 leading-line_height_20"
            data-testid={`questionnaire-history-answer-${index}`}
          >
            <strong
              className="text-text_default_primary"
              data-testid={`questionnaire-history-answer-${index}-question`}
            >
              {answer.question}
            </strong>
            <ul className="flex min-w-0 flex-wrap gap-2">
              {answer.labels.map((label, labelIndex) => (
                <li
                  key={`${requestId}-${index}-${labelIndex}`}
                  className="webui-questionnaire-history-label max-w-full rounded-lg bg-bg_grouped_tertiary px-3 py-1.5 text-text_default_secondary [overflow-wrap:anywhere]"
                  data-testid={`questionnaire-history-answer-${index}-label-${labelIndex}`}
                >
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <details className="webui-questionnaire-history-details border-t-[0.5px] border-border_default pt-2">
        <summary className="w-fit cursor-pointer text-size_12 leading-line_height_16 text-text_default_tertiary hover:text-text_default_secondary">
          查看回答信息
        </summary>
        <dl
          className="webui-questionnaire-history-meta mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-size_12 leading-line_height_16 text-text_default_tertiary"
          data-testid="questionnaire-history-meta"
        >
          <div className="contents" data-testid="questionnaire-history-meta-requestId">
            <dt>requestId</dt>
            <dd className="min-w-0 break-all font-mono">{requestId || "(未提供)"}</dd>
          </div>
          {summary.schemaVersion ? (
            <div className="contents" data-testid="questionnaire-history-meta-schema">
              <dt>schemaVersion</dt>
              <dd className="font-mono">{summary.schemaVersion}</dd>
            </div>
          ) : null}
          {summary.submittedAt ? (
            <div className="contents" data-testid="questionnaire-history-meta-submitted">
              <dt>submittedAt</dt>
              <dd className="min-w-0 break-all font-mono">{summary.submittedAt}</dd>
            </div>
          ) : null}
          {summary.mode ? (
            <div className="contents" data-testid="questionnaire-history-meta-mode">
              <dt>mode</dt>
              <dd className="break-all font-mono">{summary.mode}</dd>
            </div>
          ) : null}
          {summary.source ? (
            <div className="contents" data-testid="questionnaire-history-meta-source">
              <dt>source</dt>
              <dd className="break-all font-mono">{summary.source}</dd>
            </div>
          ) : null}
          {summary.featureKey ? (
            <div className="contents" data-testid="questionnaire-history-meta-feature-key">
              <dt>featureKey</dt>
              <dd className="break-all font-mono">{summary.featureKey}</dd>
            </div>
          ) : null}
        </dl>
      </details>
    </article>
  );
}

export function WebuiSessionTranscript({
  sessionId,
  initialMessages,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  getSessionForkOptions,
  forkSession,
  getSessionRewindPreview,
  rewindSession,
  editSessionMessage,
  answerPlanBuild,
  workspaceDir,
  onOpenFile,
  onOpenTurnReview,
  onOpenPlanFile,
}: {
  readonly sessionId: string;
  readonly initialMessages?: WebuiClientMessagePage;
  readonly workspaceDir?: string;
  readonly onOpenFile?: (input: { readonly sessionId: string; readonly workspaceDir: string; readonly reference: WebuiMessageFileReference }) => void;
  readonly onOpenTurnReview?: (command: Extract<WorkspacePanelCommand, { type: "open-turn-review" }>) => void;
  readonly onOpenPlanFile?: (input: { readonly sessionId: string; readonly path: string; readonly content: string }) => void;
  readonly answerPlanBuild?: (request: WebuiQuestionnaireRequest) => Promise<void>;
} & WebuiSessionTranscriptCapabilities): ReactElement {
  const historyOwner = useWebuiTranscriptHistoryOwner();
  const transcriptState = useWebuiSessionState(sessionId).transcript;
  const hasCanonicalPage = transcriptState.page.messages !== undefined;
  const visiblePage = hasCanonicalPage
    ? transcriptState.page
    : initialMessages ?? transcriptState.page ?? EMPTY_TRANSCRIPT_PAGE;
  const loading = hasCanonicalPage
    ? transcriptState.loading
    : initialMessages
      ? false
      : transcriptState.loading;
  const error = transcriptState.error;
  const transcriptRef = useRef<HTMLElement | null>(null);
  const stream = useWebuiSessionStream(sessionId);
  const streamPhase = stream.phase;
  // The plan file is a MESSAGE in the transcript, not a floating card: the
  // desktop renders it as the footer of the turn that wrote the plan. It lives
  // on the pending questionnaire, so the transcript reads the same channel the
  // composer does and anchors the card to `request.tool.messageId`.
  //
  // The composer keeps its own copy for the decision; this read only decides
  // whether a plan card belongs in the message column.
  const pendingQuestionnaire = useWebuiSessionQuestionnaire(sessionId);
  const planReview = isWebuiPlanReviewRequest(pendingQuestionnaire)
    ? pendingQuestionnaire
    : undefined;
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [planError, setPlanError] = useState<string | undefined>(undefined);
  const planAnchorMessageId = planReview?.tool?.messageId;
  const submitPlanBuild = useCallback(() => {
    if (!planReview || !answerPlanBuild) return;
    setPlanError(undefined);
    setPlanSubmitting(true);
    void answerPlanBuild(planReview)
      .catch((error: unknown) => {
        setPlanError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setPlanSubmitting(false));
  }, [answerPlanBuild, planReview]);
  // 预览 opens the whole plan file in the workspace panel, the way the desktop
  // hands the markdown to its file viewer. The file lives outside the workspace
  // root, so the content travels with the command instead of being read back.
  const openPlanFile = useCallback(
    (request: WebuiQuestionnaireRequest) => {
      const path = webuiPlanPath(request);
      if (!path || !onOpenPlanFile) return;
      onOpenPlanFile({ sessionId, path, content: webuiPlanMarkdown(request) });
    },
    [onOpenPlanFile, sessionId],
  );
  // History and stream frames feed one transcript projection. The live
  // records update the same message identities in this list while history
  // supplies the persisted fields and older messages.
  const turnLive = isTurnLive(streamPhase);
  const previousTurnStateRef = useRef({ sessionId, turnLive });
  useEffect(() => {
    if (initialMessages) historyOwner?.seed(sessionId, initialMessages);
    void historyOwner?.loadPage(sessionId);
  }, [historyOwner, initialMessages, sessionId]);
  useEffect(() => {
    const previous = previousTurnStateRef.current;
    previousTurnStateRef.current = { sessionId, turnLive };
    // 加载历史页只处理会话内的 live → idle 转换；切换会话由首屏请求负责。
    if (previous.sessionId !== sessionId || !previous.turnLive || turnLive) return undefined;
    void historyOwner?.loadPage(sessionId);
    return undefined;
  }, [historyOwner, sessionId, turnLive]);
  // One view model, derived in one place (`projection/transcript/
  // transcript-view-model.ts`); this component renders what it returns.
  const view = useMemo(
    () =>
      projectWebuiTranscriptView({
        sessionId,
        visiblePage,
        streamMessages: stream.messages,
        streamPhase,
        processingStartedAtMs: stream.processingStartedAtMs,
        turnLive,
        loading,
        error,
      }),
    [
      error,
      loading,
      sessionId,
      stream.messages,
      stream.processingStartedAtMs,
      streamPhase,
      turnLive,
      visiblePage,
    ],
  );
  const {
    messageProjections,
    items,
    turnViewsByMessageId,
    groups,
    liveAssistantMessages,
    liveAssistantView,
    liveGroupViews,
    trailingLiveGroupId,
    liveActivityGroupId,
    liveActivityAtTranscriptLevel,
    turns,
    showEmptyState,
  } = view;
  // The scroll binding owns the viewport, the auto-follow policy and the pin
  // (plan §6: scroll is one of the three responsibilities cut out of this file).
  const { releaseAutoFollow } = useWebuiTranscriptScroll({
    transcriptRef,
    sessionId,
    turnLive,
    contentKey: items,
  });
  const loadOlder = visiblePage.hasMore && visiblePage.nextCursor
    ? () => {
        if (loading) return;
        const requestedCursor = visiblePage.nextCursor;
        if (!requestedCursor) return;
        // 翻历史是用户主动往上走：交还控制权，否则更早消息并进来之后
        // 贴底跟随会把他从正在读的位置拽回末尾。
        releaseAutoFollow();
        const viewport = transcriptViewport(transcriptRef.current);
        const previousScrollTop = viewport?.scrollTop;
        void historyOwner?.loadOlder(sessionId, requestedCursor).then((outcome) => {
          requestAnimationFrame(() => {
            if (
              outcome.status === "applied" &&
              historyOwner.isCurrentPage(outcome.page) &&
              transcriptRef.current?.dataset.webuiTranscript === sessionId &&
              viewport?.isConnected &&
              previousScrollTop !== undefined
            ) {
              viewport.scrollTop = previousScrollTop;
            }
          });
        });
      }
    : undefined;
  return (
    <section
      ref={transcriptRef}
      aria-label="Transcript"
      data-webui-transcript={sessionId}
      data-webui-transcript-empty={showEmptyState ? "true" : undefined}
      className="message-container-viewport scrollbar-hide webui-session-transcript-scroll relative flex w-full flex-col"
      data-webui-session-transcript-scroll="true"
    >
      <div
        className="message-list flex w-full flex-col gap-spacing_8"
        data-webui-message-list="true"
      >
        {error ? (
          <p
            role="alert"
            className="text-text_default_secondary text-size_14 leading-line_height_20"
          >
            Unable to load messages: {error}
          </p>
        ) : null}
        {!turnLive && loading && items.length === 0 ? <ChatSkeleton /> : null}
        {showEmptyState ? (
          <p
            className="webui-transcript-empty-state text-text_default_secondary text-size_14 leading-line_height_20"
            data-testid="transcript-empty-state"
          >
            当前会话暂无消息
          </p>
        ) : null}
        {loadOlder ? (
          <div className="flex w-full justify-center py-1">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loading}
              className="webui-button-secondary text-size_14 leading-line_height_20"
              aria-label={loading ? "正在加载更早消息" : "加载更早消息"}
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="size-4 flex-none"
              >
                <path
                  d="m4 10 4-4 4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{loading ? "正在加载…" : "加载更早消息"}</span>
            </button>
          </div>
        ) : null}
        {groups.flatMap((group) => {
          const userItem = group.items.find(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "user",
          );
          const questionnaireResponseItem = group.items.find(
            (
              item,
            ): item is Extract<
              WebuiTranscriptItem,
              { kind: "questionnaire_response" }
            > => item.kind === "questionnaire_response",
          );
          const result: ReactElement[] = [];
          if (questionnaireResponseItem) {
            result.push(
              <WebuiQuestionnaireResponse
                key={`${group.messageId}-questionnaire`}
                messageId={group.messageId}
                summary={questionnaireResponseItem.summary}
                timestamp={questionnaireResponseItem.timestamp}
              />,
            );
          }
          if (userItem) {
            const projectedUserView = turnViewsByMessageId.get(
              userItem.messageId,
            );
            const historicalUserView =
              projectedUserView?.source === "historical"
                ? projectedUserView
                : undefined;
            result.push(
              <MessageItem
                key={group.messageId}
                view={
                  {
                    ...(historicalUserView ?? {
                      source: "historical",
                      messageId: userItem.messageId,
                      role: "user",
                      sessionId,
                    }),
                    source: "historical",
                    messageId: userItem.messageId,
                    role: "user",
                    sessionId,
                    userText: userItem.text,
                    actions: userItem.actions,
                    timestamp: userItem.timestamp,
                    isGoal: userItem.isGoal,
                  }
                }
                getSessionForkOptions={getSessionForkOptions}
                forkSession={forkSession}
                getSessionRewindPreview={getSessionRewindPreview}
                rewindSession={rewindSession}
                editSessionMessage={editSessionMessage}
                workspaceDir={workspaceDir}
                onOpenFile={onOpenFile}
                onOpenTurnReview={onOpenTurnReview}
              />,
            );
          }
          if (result.length > 0) return result;
          // Fall through to the assistant-group renderer below.
          // `wallClockDurationMs` and `processSegments` are group-level
          // facts: the first is the group's span and the second preserves
          // per-message activity rows across the assistant group. The
          // historical per-message adapter leaves processSegments out;
          // this group projection supplies it before rendering.
          const thinkingItems = group.items.filter(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "thinking",
          );
          const tools = group.items
            .filter(
              (
                item,
              ): item is Extract<WebuiTranscriptItem, { kind: "tool" }> =>
                item.kind === "tool",
            )
            .flatMap((item) => item.tools);
          const answers = group.items.filter(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "assistant",
          );
          const actions = group.items.find(
            (
              item,
            ): item is Extract<
              WebuiTranscriptItem,
              { actions?: WebuiMessageActionCapabilities }
            > => "actions" in item,
          )?.actions;
          const initialDiff = [...group.items]
            .reverse()
            .find(
              (
                item,
              ): item is Extract<
                WebuiTranscriptItem,
                { diff?: WebuiTurnDiffView }
              > => "diff" in item,
            )?.diff;
          const projectedAssistantView = turnViewsByMessageId.get(
            group.messageId,
          );
          const historicalAssistantView =
            projectedAssistantView?.source === "historical"
              ? projectedAssistantView
              : undefined;
          const groupLiveView = liveGroupViews?.get(group.messageId);
          const assistantView = groupLiveView
            ? {
                ...groupLiveView,
                messageId: group.messageId,
                ...(group.turnId ? { turnId: group.turnId } : {}),
                // Only the trailing live assistant group is still in flight; the
                // ones before it rendered their row as done so the activity
                // pulse stays unique.
                ...(group.messageId === liveActivityGroupId
                  ? {}
                  : { streaming: false }),
              }
            : {
                ...(historicalAssistantView ?? {
                  source: "historical" as const,
                  messageId: group.messageId,
                  role: "assistant" as const,
                  sessionId,
                }),
                source: "historical" as const,
                messageId: group.messageId,
                role: "assistant" as const,
                sessionId,
                ...(group.turnId ? { turnId: group.turnId } : {}),
                ...(group.forceExpanded ? { processForceExpanded: true } : {}),
                userText: undefined,
                thinking: thinkingItems.length > 0
                  ? thinkingItems.map((item) => item.text).join("\n\n")
                  : undefined,
                thinkingDurationMs: thinkingItems[0]?.durationMs,
                tools: tools.length > 0 ? tools : undefined,
                answers: answers.map((item) => item.text),
                timestamp: undefined,
                isGoal: undefined,
                totalRequestDurationMs: group.totalRequestDurationMs,
                totalOutputTokens: group.totalOutputTokens,
                actions,
                initialDiff,
                attachments: answers[0]?.attachments,
                processSegments: projectWebuiProcessSegments(group.items),
              };
          return (
            <Fragment key={group.messageId}>
              <MessageItem
                view={assistantView}
                wallClockDurationMs={group.wallClockDurationMs}
                getTurnDiff={getTurnDiff}
                revertTurnDiff={revertTurnDiff}
                reapplyTurnDiff={reapplyTurnDiff}
                getSessionForkOptions={getSessionForkOptions}
                forkSession={forkSession}
                getSessionRewindPreview={getSessionRewindPreview}
                rewindSession={rewindSession}
              editSessionMessage={editSessionMessage}
              workspaceDir={workspaceDir}
              onOpenFile={onOpenFile}
              onOpenTurnReview={onOpenTurnReview}
            />
              {planAnchorMessageId !== undefined &&
              group.items.some((item) => item.messageId === planAnchorMessageId) ? (
                <div
                  key={`${group.messageId}-plan`}
                  className="webui-plan-inline"
                  data-testid="plan-inline-anchor"
                >
                  {planReview ? (
                    <WebuiPlanDeliveryCard
                      request={planReview}
                      onBuild={submitPlanBuild}
                      onViewPlan={() => openPlanFile(planReview)}
                      chrome={{ busy: planSubmitting, error: planError }}
                    />
                  ) : null}
                </div>
              ) : null}
            </Fragment>
          );
        })}
        {streamPhase === "reconnecting" ? (
          <MessagePassiveLoadingPlaceholder label="重连中…" />
        ) : null}
        {turnLive && !liveAssistantMessages.length &&
        (streamPhase === "streaming" || streamPhase === "waiting") ? (
          stream.messages.some((message) => message.role === "user") && streamPhase === "waiting" ? (
            <>
              <MessageAfterQueryStreamingPlaceholder />
              <div className="webui-session-stream-status" data-webui-live-thinking="true">
                <ActivityIndicator showLabel labelOverride="思考中…" />
              </div>
            </>
          ) : (
            <div className="webui-session-stream-status" data-webui-live-thinking="true">
              <ActivityIndicator showLabel labelOverride="思考中…" />
            </div>
          )
        ) : null}
        {turnLive && liveAssistantView &&
        (streamPhase === "streaming" || streamPhase === "waiting") &&
        (!liveAssistantView.thinking?.trim() || liveActivityAtTranscriptLevel) ? (
          <div className="webui-session-stream-status" data-webui-live-thinking="true">
            <ActivityIndicator showLabel labelOverride="思考中…" />
          </div>
        ) : null}
      </div>
      <TurnNavigator turns={turns} />
    </section>
  );
}
