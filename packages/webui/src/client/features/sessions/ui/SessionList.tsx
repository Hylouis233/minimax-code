import { useMemo, type MouseEvent, type ReactElement } from "react";
import type {
  WebuiClientSession,
  WebuiClientSessionPage,
} from "../../../contracts/sessions/session-view.js";
import { sessionHash } from "../../../projection/common/router.js";
import { sessionLabel } from "../projection/rail-groups.js";
import { SessionActivityMeta } from "./session-activity-meta.js";
import { type WebuiSessionActivityMap } from "../projection/session-activity.js";

export function WebuiSessionList({
  page,
  loading,
  onLoadMore,
  selectedSessionId,
  error,
  activity,
  now,
  pinnedSessions,
  starredSessions,
  heading,
  emptyLabel,
  preserveOrder,
  onSessionContextMenu,
  teamModeLabel,
}: {
  readonly page: WebuiClientSessionPage;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly error?: string;
  readonly activity?: WebuiSessionActivityMap;
  /** Injected so the age labels re-render on a tick instead of on every event. */
  readonly now?: number;
  /**
   * Which rows carry the standing pin mark. The running and unread views are
   * exactly where a user needs it -- those rows are ordered by activity, so
   * sort position says nothing about which one the user chose to keep.
   */
  readonly pinnedSessions?: Readonly<Record<string, boolean>>;
  /**
   * Which rows carry the standing star mark. 收藏 is a flat list, so a starred
   * row has no project furniture to be recognised by and the mark is the only
   * thing distinguishing it from an ordinary one.
   */
  readonly starredSessions?: Readonly<Record<string, boolean>>;
  /**
   * Overrides the section label. The rail reuses this list for its running and
   * unread views, where "recent tasks" would be a lie -- the list is filtered,
   * and by what depends on the view.
   */
  readonly heading?: string;
  /** Shown when the list is empty. Defaults to the neutral "no sessions". */
  readonly emptyLabel?: string;
  /**
   * Keeps the order the caller handed in. The running and unread views sort by
   * last observed activity, which is not the session record's `updatedAt` and
   * would be undone by the default sort below.
   */
  readonly preserveOrder?: boolean;
  /**
   * The Agent Team badge's tooltip, injected by the composition root. A view may
   * not read the platform adapter that holds the team-mode choice (plan §5.3), so
   * whoever renders the rail passes the label in.
   */
  readonly teamModeLabel?: string;

  /**
   * Opens the session context menu on a right-click. The flat views (收藏 /
   * 运行中 / 未读) list the same root sessions the projects view groups under
   * their project, so they offer the same menu: a row that only responds in
   * one tab reads as broken in the other three. Optional because this list is
   * also rendered outside the app (SSR fixtures, un-wired hosts) — a host that
   * passes nothing keeps the native context menu these rows always had.
   */
  readonly onSessionContextMenu?: (
    event: MouseEvent<HTMLElement>,
    session: WebuiClientSession,
  ) => void;
}): ReactElement {
  const sessions = useMemo(
    () =>
      preserveOrder
        ? page.sessions
        : [...page.sessions].sort(
            (left, right) => right.updatedAt - left.updatedAt,
          ),
    [page.sessions, preserveOrder],
  );
  return (
    <div
      className="transition-colors group/project-list"
      data-webui-rail-sessions="true"
    >
      <div
        className="group/section flex h-[30px] items-center gap-1 pl-2 pr-0.5"
        data-webui-rail-section-header="true"
      >
        <span className="truncate text-sm font-normal leading-5 text-text_default_tertiary">
          {heading ?? "最近任务"}
        </span>
        <span className="ml-auto flex-shrink-0 text-sm font-normal leading-5 text-text_default_tertiary">
          {sessions.length}
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16"
        >
          会话加载失败：{error}
        </p>
      ) : null}
      {!error && sessions.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          {emptyLabel ?? "暂无会话"}
        </p>
      ) : (
        <ul className="pt-px space-y-px" data-webui-session-list="true">
          {sessions.map((session) => (
            <li key={session.sessionId} data-webui-session-card="true">
              <a
                href={sessionHash(session.sessionId)}
                data-webui-session-link={session.sessionId}
                data-webui-session-active={
                  selectedSessionId === session.sessionId ? "true" : "false"
                }
                title={session.workspaceDir ?? undefined}
                onContextMenu={(event) =>
                  onSessionContextMenu?.(event, session)
                }
                className="webui-session-card text-text_default_primary"
              >
                <span className="flex h-[31px] w-[18px] flex-shrink-0 items-center justify-center">
                  <span className="block h-[31px] w-0 border-l-[0.5px] border-border_default" />
                </span>
                <span className="w-0 flex-1 truncate text-sm">
                  {sessionLabel(session)}
                </span>
                {sessions.some(
                  (child) => child.parentSessionId === session.sessionId,
                ) ? (
                  <span
                    className="webui-pill flex-shrink-0 bg-bg_interaction_primary_default text-text_default_primary text-[11px]"
                    data-webui-team-badge="true"
                    title={teamModeLabel}
                  >
                    Agent Team
                  </span>
                ) : null}
                <SessionActivityMeta
                  session={session}
                  activity={activity}
                  now={now}
                  pinned={Boolean(pinnedSessions?.[session.sessionId])}
                  starred={Boolean(starredSessions?.[session.sessionId])}
                />
              </a>
              {session.workspaceDir ? (
                <div
                  data-webui-workspace-dir={session.workspaceDir}
                  className="truncate pl-[28px] pr-1 text-xs leading-4 text-text_default_tertiary"
                >
                  {session.workspaceDir}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page.hasMore && onLoadMore ? (
        <div className="px-1 pt-px">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="webui-rail-more text-text_default_secondary"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
