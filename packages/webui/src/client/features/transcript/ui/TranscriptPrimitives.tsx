// Pure-presentation transcript primitives — leaves of the component tree.
//
// W3 tier 1 lift: these components were moved out of `app.tsx` in W3. The
// transcript structure and data attributes remain stable; the live thinking
// marker is intentionally shared with ActivityIndicator so streaming never
// renders a second, static animation implementation.
//
// Re-exported from `app.tsx` so existing consumers (tests, importers)
// keep their current import path during the W3 wave. `WebuiToolRow`
// stays private — it was a non-exported helper in `app.tsx`, used only
// by `WebuiToolResults`.

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator } from "./ActivityIndicator.js";
import {
  WebuiIconChevronDown,
  WebuiIconDiffFile,
  WebuiIconDiffSummary,
} from "../../../shell/icons.js";
import { WebuiMarkdown } from "./markdown.js";
import {
  isWebuiEditTool,
  toolCallInputText,
  toolCallName,
  toolCallIconCategory,
  toolCallLabel,
  toolCallResultText,
  toolCallErrorText,
  toolCallStatus,
  toolCallStatusLabel,
  toolCallResourcePath,
  webuiActivitySummary,
  webuiEditFileStat,
} from "../projection/tool-projection.js";

function WebuiToolRow({
  tool,
  index,
}: {
  readonly tool: Record<string, unknown>;
  readonly index: number;
}): ReactElement {
  const input = toolCallInputText(tool);
  const result = toolCallResultText(tool);
  const error = toolCallErrorText(tool);
  const status = toolCallStatus(tool);
  const statusLabel = status === "completed" ? undefined : toolCallStatusLabel(status);
  const resourcePath = toolCallResourcePath(tool);
  const pathSegments = resourcePath?.replaceAll("\\", "/").split("/").filter(Boolean) ?? [];
  const resourceLabel = pathSegments[pathSegments.length - 1] ?? resourcePath;
  return (
    <details
      key={`tool-call-${toolCallName(tool)}-${index}`}
      className="webui-tool-row"
      data-webui-tool-call={toolCallName(tool)}
      data-webui-tool-status={status}
    >
      <summary className="webui-tool-row-summary">
        <span className={`webui-tool-icon webui-tool-icon--${toolCallIconCategory(tool)}`} aria-hidden="true">
          <WebuiToolIcon category={toolCallIconCategory(tool)} />
        </span>
        <span className="webui-tool-label">
          {toolCallLabel(tool)}
          {statusLabel ? ` · ${statusLabel}` : ""}
        </span>
        {resourcePath ? <span className="webui-tool-resource-path" title={resourcePath}>{resourceLabel}</span> : null}
        {!resourcePath ? <WebuiIconChevronDown className="webui-tool-chevron" /> : null}
      </summary>
      {status === "running" && !input && !result && !error ? (
        <WebuiToolDetailShell title={toolCallLabel(tool)}>
          <div className="webui-tool-detail-running">运行中…</div>
        </WebuiToolDetailShell>
      ) : input || result || error ? (
        <WebuiToolDetailShell title={toolCallLabel(tool)}>
          {input !== undefined ? <WebuiToolDetailSection label="输入" value={formatToolInputForDisplay(input)} /> : null}
          {result !== undefined ? <WebuiToolDetailSection label="结果" value={result} /> : null}
          {error !== undefined ? <WebuiToolDetailSection label="错误" value={error} error /> : status === "error" ? <WebuiToolDetailSection label="错误" value="执行失败" error /> : null}
        </WebuiToolDetailShell>
      ) : null}
    </details>
  );
}

function WebuiToolDetailShell({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="webui-tool-detail" data-webui-tool-result="true">
      <div className="webui-tool-detail-surface">
        <div className="webui-tool-detail-body">
          <div className="webui-tool-detail-title">{title}</div>
          <div className="webui-tool-detail-divider" aria-hidden="true" />
          <div className="webui-tool-detail-content">{children}</div>
        </div>
      </div>
    </div>
  );
}

function formatToolInputForDisplay(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === "object") {
      return JSON.stringify(parsed, null, 2) ?? value;
    }
  } catch {
    // Non-JSON inputs such as shell commands remain unchanged.
  }
  return value;
}

function WebuiToolDetailSection({
  label,
  value,
  error = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly error?: boolean;
}): ReactElement {
  return (
    <section className="webui-tool-detail-section">
      <div className={error ? "webui-tool-detail-label is-error" : "webui-tool-detail-label"}>{label}</div>
      <pre>{value.length > 2000 ? `${value.slice(0, 2000)}...` : value}</pre>
    </section>
  );
}

function WebuiToolIcon({ category }: { readonly category: ReturnType<typeof toolCallIconCategory> | "combine" }): ReactElement {
  const paths: Readonly<Record<typeof category, ReactElement>> = {
    command: <><rect x="2.25" y="3" width="15.5" height="14" rx="2.5" /><path d="m6 7 2.5 2.5L6 12M10.5 12H14" /></>,
    file: <><path d="M5 2.75h6l4 4v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" /><path d="M11 3v4h4M7 11h6M7 14h6" /></>,
    code: <><path d="m7 7-3 3 3 3M13 7l3 3-3 3M11.5 5.5l-3 9" /></>,
    search: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></>,
    web: <><circle cx="10" cy="10" r="7.25" /><path d="M2.9 10h14.2M10 2.75c2.1 2.05 3.2 4.47 3.2 7.25s-1.1 5.2-3.2 7.25C7.9 15.2 6.8 12.78 6.8 10s1.1-5.2 3.2-7.25Z" /></>,
    browser: <><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M2.5 7.5h15M5 5.5h.01M7.5 5.5h.01" /></>,
    logo: <><path d="M10 2 17.25 6v8L10 18l-7.25-4V6L10 2Z" /><path d="m6.75 10 2.1 2.1 4.4-4.4" /></>,
    memory: <><path d="M10 3.5a3.1 3.1 0 0 0-5.9 1.2 3.5 3.5 0 0 0-.7 6.3A3.2 3.2 0 0 0 10 14.5M10 3.5a3.1 3.1 0 0 1 5.9 1.2 3.5 3.5 0 0 1 .7 6.3 3.2 3.2 0 0 1-6.6 3.5M10 3.5v12" /><path d="M6.5 7.5h1M6 11h1.5M12.5 7.5h1M12.5 11H14" /></>,
    image: <><rect x="2.5" y="3" width="15" height="14" rx="2" /><circle cx="7" cy="7.5" r="1.25" /><path d="m3.5 14 4-4 3 3 2.5-2.5 3.5 3.5" /></>,
    video: <><rect x="2.5" y="3.5" width="10" height="13" rx="2" /><path d="m12.5 8 5-3v10l-5-3M6.5 8.25l3.25 1.75-3.25 1.75z" /></>,
    music: <><path d="M11 14V4l6-1v9" /><circle cx="7.5" cy="14.5" r="2.5" /><circle cx="14.5" cy="12.5" r="2.5" /></>,
    tool: <><path d="M14.3 5.7a4.5 4.5 0 0 0-5.9 5.9l-4.8 4.8a1.6 1.6 0 0 1-2.3-2.3l4.8-4.8a4.5 4.5 0 0 1 5.9-5.9l-2.6 2.6 2.6 2.6 2.6-2.9Z" /></>,
    task: <><rect x="3" y="3" width="14" height="14" rx="2" /><path d="m5.75 7.5 1.25 1.25 2-2M11.5 7.75h3M5.75 12.5 7 13.75l2-2M11.5 12.75h3" /></>,
    bot: <><rect x="3" y="5" width="14" height="11" rx="3" /><path d="M10 2v3M2 9h1M17 9h1M7 10h.01M13 10h.01M7 13h6" /></>,
    goal: <><circle cx="10" cy="10" r="7.25" /><circle cx="10" cy="10" r="4.25" /><circle cx="10" cy="10" r="1.25" /></>,
    thinking: <><path d="m10 2.75 1.75 5.5 5.5 1.75-5.5 1.75-1.75 5.5-1.75-5.5-5.5-1.75 5.5-1.75L10 2.75Z" /><path d="m16 2 .55 1.45L18 4l-1.45.55L16 6l-.55-1.45L14 4l1.45-.55L16 2Z" /></>,
    combine: <><rect x="2.75" y="2.75" width="6" height="6" rx="1.5" /><rect x="11.25" y="2.75" width="6" height="6" rx="1.5" /><rect x="2.75" y="11.25" width="6" height="6" rx="1.5" /><rect x="11.25" y="11.25" width="6" height="6" rx="1.5" /></>,
  };
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[category]}</svg>;
}

/** Tool rows remain the fallback only when the runtime diff facade is absent. */
export function WebuiToolResults({
  tools,
  authoritativeDiffAvailable = false,
  showEditToolRows = false,
}: {
  readonly tools: readonly Record<string, unknown>[];
  readonly authoritativeDiffAvailable?: boolean;
  /** Activity disclosures list each tool call even when the turn diff card is available. */
  readonly showEditToolRows?: boolean;
}): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const edits = tools.filter(isWebuiEditTool);
  const others = tools.filter((tool) => !isWebuiEditTool(tool));
  const renderRows = (rows: readonly Record<string, unknown>[]) =>
    rows.map((tool, index) => (
      <WebuiToolRow
        key={`tool-call-${toolCallName(tool)}-${index}`}
        tool={tool}
        index={index}
      />
    ));
  if (edits.length === 0) {
    return (
      <div className="webui-tool-list" data-webui-tool-list="true">
        {renderRows(tools)}
      </div>
    );
  }
  if (authoritativeDiffAvailable) {
    return (
      <div className="webui-tool-list" data-webui-tool-list="true">
        {renderRows(showEditToolRows ? tools : others)}
      </div>
    );
  }
  const stats = edits.map(webuiEditFileStat);
  const totalAdded = stats.reduce((sum, stat) => sum + stat.added, 0);
  const totalDeleted = stats.reduce((sum, stat) => sum + stat.deleted, 0);
  const shown = expanded ? stats : stats.slice(0, 3);
  return (
    <div className="webui-diff-card" data-webui-diff-card="true">
      <div className="webui-diff-header">
        <div className="webui-diff-summary">
          <span className="webui-diff-icon" aria-hidden="true"><WebuiIconDiffSummary /></span>
          <span className="webui-diff-header-content">
            <span className="webui-diff-header-title" data-webui-diff-title="true">
              {`已编辑 ${edits.length} 个文件`}
            </span>
            {totalAdded > 0 || totalDeleted > 0 ? (
              <span className="webui-diff-header-stats">
                {totalAdded > 0 ? (
                  <span className="webui-diff-add">{`+${totalAdded}`}</span>
                ) : null}
                {totalDeleted > 0 ? (
                  <span className="webui-diff-del">{`-${totalDeleted}`}</span>
                ) : null}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <ul className="webui-diff-files">
        {shown.map((stat, index) => (
          <li
            className="webui-diff-file"
            key={`${stat.name ?? "file"}-${index}`}
          >
            <span className="webui-diff-file-icon" data-testid="turn-diff-file-icon"><WebuiIconDiffFile fileName={stat.name ?? undefined} /></span>
            <span className="webui-diff-file-name">{stat.name ?? "文件"}</span>
            {stat.added > 0 || stat.deleted > 0 ? (
              <span className="webui-diff-file-stats">
                {stat.added > 0 ? (
                  <span className="webui-diff-add">{`+${stat.added}`}</span>
                ) : null}
                {stat.deleted > 0 ? (
                  <span className="webui-diff-del">{`-${stat.deleted}`}</span>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {stats.length > 3 ? (
        <button
          type="button"
          className="webui-diff-expand"
          data-webui-diff-expand="true"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : `展开其余 ${stats.length - 3} 个`}
        </button>
      ) : null}
      {others.length > 0 ? (
        <div className="webui-tool-list" data-webui-tool-list="true">
          {renderRows(others)}
        </div>
      ) : null}
    </div>
  );
}

/** Desktop activity-group: a 16px activity header and a timeline body. */
export function WebuiActivityGroup({
  tools,
  authoritativeDiffAvailable = false,
  activityItems,
  initiallyExpanded = false,
  showStreamingStatus = true,
}: {
  readonly tools: readonly Record<string, unknown>[];
  readonly authoritativeDiffAvailable?: boolean;
  readonly activityItems?: readonly WebuiActivityGroupItem[];
  readonly initiallyExpanded?: boolean;
  readonly showStreamingStatus?: boolean;
}): ReactElement | null {
  const active = tools.some((tool) => {
    const status = toolCallStatus(tool);
    return status === "pending" || status === "running";
  });
  const [expanded, setExpanded] = useState(initiallyExpanded);
  if (tools.length === 0) return null;
  const thinkingCount = activityItems?.filter((item) => item.type === "thinking").length ?? 0;
  const summary = [
    ...(thinkingCount > 0 ? [`思考 ${thinkingCount} 次`] : []),
    webuiActivitySummary(tools),
  ].join("，");
  const categories = [...new Set(tools.map(toolCallIconCategory))];
  const iconCategory = categories.length > 1 ? "combine" : categories[0] ?? "tool";
  const detailItems: ReactElement[] = [];
  if (activityItems) {
    for (let index = 0; index < activityItems.length; index += 1) {
      const item = activityItems[index];
      if (!item) continue;
      if (item.type === "thinking") {
        detailItems.push(<WebuiThinkingBlock key={`thinking-${index}`} text={item.text} durationMs={item.durationMs} streaming={item.streaming} showStreamingStatus={showStreamingStatus} summaryLabel="思考过程" />);
        continue;
      }
      const groupedTools: Record<string, unknown>[] = [item.tool];
      while (activityItems[index + 1]?.type === "tool") {
        index += 1;
        const next = activityItems[index];
        if (next?.type === "tool") groupedTools.push(next.tool);
      }
      detailItems.push(<WebuiToolResults key={`tools-${index}`} tools={groupedTools} authoritativeDiffAvailable={authoritativeDiffAvailable} showEditToolRows />);
    }
  }
  return (
    <details
      className="activity-group"
      data-testid="activity-group"
      data-active={active ? "true" : undefined}
      open={active || expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="activity-group-header">
        <span className="activity-group-icon" data-webui-activity-icon-category={iconCategory} aria-hidden="true"><WebuiToolIcon category={iconCategory} /></span>
        <span className="activity-group-summary">{summary}</span>
        <WebuiIconChevronDown className="activity-group-chevron" />
      </summary>
      <div className="activity-group-body">
        <span className="timeline-spine" aria-hidden="true" />
        <div className="activity-group-items">
          {activityItems ? detailItems : <WebuiToolResults tools={tools} authoritativeDiffAvailable={authoritativeDiffAvailable} showEditToolRows />}
        </div>
      </div>
    </details>
  );
}

export type WebuiActivityGroupItem =
  | { readonly type: "thinking"; readonly text: string; readonly durationMs?: number; readonly streaming?: boolean }
  | { readonly type: "tool"; readonly tool: Record<string, unknown> };

export function WebuiTurnProcess({
  active,
  startedAtMs,
  endedAtMs,
  tokenCount,
  requestDurationMs,
  wallClockDurationMs,
  children,
  collapsedContent,
  hasExpandableContent = true,
  forceExpanded = false,
  disabled = false,
  initiallyExpanded = false,
  summaryPrefix,
  showLiveActivity = false,
}: {
  readonly active: boolean;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
  /** Approximate token count streamed during the turn. Used to derive the
   *  Desktop-style "output rate" (`{N} token/s`) when the turn has finished. */
  readonly tokenCount?: number;
  /** Wall-clock duration of the turn measured by the runtime
   *  (`usage.request_duration_ms`). When this is present it wins over the
   *  wall-clock fallback for finished turns. */
  readonly requestDurationMs?: number;
  /** Wall-clock duration computed from message timestamps (oldest user →
   *  newest assistant inside the turn). Used when neither the runtime nor
   *  `startedAtMs` give us a number — this is the only honest signal the
   *  runtime hands us, so render its real value rather than guess. */
  readonly wallClockDurationMs?: number;
  readonly children: ReactElement | ((expanded: boolean) => ReactElement);
  /** Content that remains visible outside the collapsible details while the
   *  process is collapsed (for example, the final assistant reply). */
  readonly collapsedContent?: (expanded: boolean) => ReactNode;
  /** Desktop only renders an outer disclosure control when this turn has
   *  content that can actually be expanded. The duration summary can remain
   *  visible without the control. */
  readonly hasExpandableContent?: boolean;
  /** Mirrors Desktop turn-process modes: these states suppress the toggle
   *  and keep available details open. */
  readonly forceExpanded?: boolean;
  readonly disabled?: boolean;
  readonly initiallyExpanded?: boolean;
  readonly summaryPrefix?: string;
  /** Render one live thinking indicator after the complete turn content. */
  readonly showLiveActivity?: boolean;
}): ReactElement {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) setExpanded(false);
    wasActive.current = active;
  }, [active]);
  const canToggle = hasExpandableContent && !forceExpanded && !disabled;
  const contentExpanded = forceExpanded || disabled || active || expanded;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  // Priority for finished turns:
  //   1. `requestDurationMs` from the runtime usage block
  //   2. `wallClockDurationMs` from the message timestamp span
  //   3. fall back to "0 秒" so we never lie about elapsed time
  // Live turns tick from `startedAtMs` → now.
  const seconds =
    typeof startedAtMs === "number"
      ? Math.max(
          0,
          Math.floor(
            ((active
              ? Date.now()
              : typeof requestDurationMs === "number"
                ? startedAtMs + requestDurationMs
                : endedAtMs ?? Date.now()) -
              startedAtMs) /
              1000,
          ),
        )
      : typeof requestDurationMs === "number"
        ? Math.floor(requestDurationMs / 1000)
        : typeof wallClockDurationMs === "number"
          ? Math.floor(wallClockDurationMs / 1000)
          : undefined;
  // Desktop renders the wall-clock duration as "M 分 N 秒" / "N 秒".
  const durationLabel =
    typeof seconds === "number"
      ? seconds >= 60
        ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
        : `${seconds} 秒`
      : undefined;
  const outputRateLabel =
    !active &&
    typeof seconds === "number" &&
    seconds > 0 &&
    typeof tokenCount === "number" &&
    tokenCount > 0
      ? `${Math.round(tokenCount / seconds)} token/s`
      : undefined;
  const durationSummary = durationLabel
    ? active
      ? `已执行 ${durationLabel}`
      : `共执行 ${durationLabel}`
      : active
        ? "已执行 0 秒"
        : "共执行 0 秒";
  const summary = summaryPrefix ? `${summaryPrefix}，${durationSummary}` : durationSummary;
  return (
    <section className="pt-2" data-testid="turn-process-disclosure">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2" data-testid="turn-process-summary">
        {canToggle ? (
          <button
            type="button"
            className="group/turn-process text-activity-body-small flex items-center gap-1 py-1 text-center text-sm font-normal leading-5 tracking-normal text-text_label_tertiary_default transition-colors hover:text-text_label_tertiary_hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border_accent"
            aria-expanded={contentExpanded}
            data-testid="turn-process-trigger"
            data-summary-text={summary}
            onClick={() => setExpanded((value) => !value)}
          >
            <span data-testid="turn-process-summary-text">{summary}</span>
            <span
              data-testid="turn-process-chevron"
              className={`-ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-icon_interaction_tertiary_default transition-transform duration-200 ease-out motion-reduce:transition-none group-hover/turn-process:text-icon_interaction_tertiary_hover ${contentExpanded ? "rotate-90" : ""}`}
            >
              <WebuiIconChevronDown className="size-4" />
            </span>
          </button>
        ) : (
          <span
            className="text-activity-body-small flex items-center gap-2 py-1 text-center text-sm font-normal leading-5 tracking-normal text-text_label_tertiary_default"
            data-testid="turn-process-summary-text"
            data-summary-text={summary}
          >
            {summary}
          </span>
        )}
        {!active && outputRateLabel ? (
          <span
            className="ml-auto text-text_default_tertiary text-size_12"
            data-testid="turn-output-rate"
          >
            <span className="sr-only">输出速度：</span>
            {outputRateLabel}
          </span>
        ) : null}
      </div>
      <div className="mt-2 border-b-[0.5px] border-border_default" data-testid="turn-process-separator" aria-hidden="true" />
      {hasExpandableContent ? (
        <div className="mt-2 space-y-4" data-testid="turn-process-detail" hidden={!contentExpanded}>
          {typeof children === "function" ? children(contentExpanded) : contentExpanded ? children : null}
        </div>
      ) : null}
      {collapsedContent?.(contentExpanded)}
      {active && showLiveActivity ? (
        <div className="webui-thinking-live-status" data-webui-thinking-live-status="true">
          <ActivityIndicator aria-hidden="true" />
          <span>推理中...</span>
          {typeof seconds === "number" && seconds >= 1 ? (
            <span className="webui-thinking-elapsed">{seconds}s</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function WebuiThinkingBlock({
  text,
  durationMs,
  streaming = false,
  processingStartedAtMs,
  summaryLabel,
  showDetailHeading = false,
  showStreamingStatus = true,
  initiallyExpanded = false,
}: {
  readonly text: string;
  readonly durationMs?: number;
  readonly streaming?: boolean;
  readonly processingStartedAtMs?: number;
  readonly summaryLabel?: string;
  readonly showDetailHeading?: boolean;
  readonly showStreamingStatus?: boolean;
  readonly initiallyExpanded?: boolean;
}): ReactElement | null {
  const [, forceTick] = useState(0);
  const [detailOpen, setDetailOpen] = useState(initiallyExpanded);
  const [contentExpanded, setContentExpanded] = useState(false);
  const [contentOverflows, setContentOverflows] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!streaming || !showStreamingStatus) return undefined;
    const timer = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [streaming, showStreamingStatus]);
  useEffect(() => {
    const content = contentRef.current;
    if (!detailOpen || !content) return undefined;
    const measure = () => setContentOverflows(content.scrollHeight > 224);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [detailOpen, text]);
  if (!text.trim()) return null;
  // Desktop `think-container`: a pulse dot + 推理中... with a live-second
  // counter while streaming, collapsing to 已完成推理 + total seconds.
  const elapsed = streaming
    ? typeof processingStartedAtMs === "number"
      ? Math.max(0, Math.floor((Date.now() - processingStartedAtMs) / 1000))
      : undefined
    : typeof durationMs === "number" && durationMs > 0
      ? Math.max(1, Math.floor(durationMs / 1000))
      : undefined;
  return (
    <details className="webui-thinking-block" data-webui-thinking-block="true" open={streaming || detailOpen} onToggle={(event) => setDetailOpen(event.currentTarget.open)}>
      <summary className="webui-thinking-summary" data-webui-thinking="true">
        {summaryLabel === "思考过程" ? (
          <span className="webui-tool-icon webui-tool-icon--thinking" aria-hidden="true"><WebuiToolIcon category="thinking" /></span>
        ) : null}
        <span>{summaryLabel ?? (streaming ? "推理中..." : "已完成推理")}</span>
        {!streaming && typeof elapsed === "number" && elapsed >= 1 ? (
          <span className="webui-thinking-elapsed">{elapsed}s</span>
        ) : null}
        <WebuiIconChevronDown className="webui-thinking-chevron" />
      </summary>
      <div className="webui-thinking-detail">
        {showDetailHeading ? (
          <div className="webui-thinking-detail-heading">
            <span className="webui-tool-icon webui-tool-icon--thinking" aria-hidden="true"><WebuiToolIcon category="thinking" /></span>
            <span>思考过程</span>
          </div>
        ) : null}
        <div className={`webui-thinking-detail-content${contentOverflows && !contentExpanded ? " is-clamped" : ""}`} ref={contentRef}>
          <WebuiMarkdown source={text} />
        </div>
        {contentOverflows ? (
          <button type="button" className="webui-thinking-expand" onClick={() => setContentExpanded((expanded) => !expanded)}>
            {contentExpanded ? "收起" : "展开"}
          </button>
        ) : null}
      </div>
      {streaming && showStreamingStatus ? (
        <div className="webui-thinking-live-status" data-webui-thinking-live-status="true">
          <ActivityIndicator aria-hidden="true" />
          <span>推理中...</span>
          {typeof elapsed === "number" && elapsed >= 1 ? (
            <span className="webui-thinking-elapsed">{elapsed}s</span>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

/** Desktop `turn_process` row: 已执行 N 秒, ticking once per second. */
export function TurnElapsedRow({
  startedAtMs,
  running,
}: {
  readonly startedAtMs: number;
  readonly running: boolean;
}): ReactElement | null {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const seconds = Math.floor((Date.now() - startedAtMs) / 1000);
  if (seconds < 1) return null;
  return (
    <p className="webui-turn-elapsed" data-webui-turn-elapsed="true">
      {running ? `已执行 ${seconds} 秒` : `共执行 ${seconds} 秒`}
    </p>
  );
}
