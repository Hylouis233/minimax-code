// ProjectExpansion — extracted from `SessionRail.tsx` (T07's responsibility cut of the rail).
// The declaration body is verbatim; the `export` keyword, this header and the
// import specifiers are the only differences.

import { type MouseEvent } from "react";
import {
  WebuiIconAgent,
  WebuiIconContextArchive,
  WebuiIconContextPin,
  WebuiIconMore,
  WebuiIconSessionDisclosure,
  WebuiIconSessionStar,
} from "../../../shell/icons.js";
import type { WebuiClientSession } from "../contracts/session-view.js";
import { sessionHash } from "../../../projection/common/router.js";
import { type WebuiSessionActivityMap } from "../projection/session-activity.js";
import { sessionLabel } from "../projection/rail-groups.js";
import { SessionActivityMeta } from "./session-activity-meta.js";

/**
 * One project's expansion (plan §16.10's three in-file regions: the project-list
 * expansion): the sessions under a project's row, each collapsible to its child
 * sessions, with the "更多" control that reveals the next batch.
 *
 * A cut, not a move: the state stays in `WebuiProjectList` and arrives as props and
 * callbacks, so the lifetimes are exactly what they were — which is what §16.10
 * requires of an in-file region. Nothing here is stateful.
 */
export function ProjectExpansion({
  projectKey,
  expanded,
  sessionsById,
  childrenByParentId,
  visibleSessionIds,
  hasMore,
  expandedSessionIds,
  selectedSessionId,
  activity,
  now,
  pinnedSessions,
  starredSessions,
  onToggleChildren,
  onShowMore,
  onToggleSessionPin,
  onToggleSessionStar,
  onArchiveSession,
  onSessionContextMenu,
}: {
  readonly projectKey: string;
  readonly expanded: boolean;
  readonly sessionsById: ReadonlyMap<string, WebuiClientSession>;
  readonly childrenByParentId: ReadonlyMap<string, readonly WebuiClientSession[]>;
  readonly visibleSessionIds: readonly string[];
  readonly hasMore: boolean;
  readonly expandedSessionIds: ReadonlySet<string>;
  readonly selectedSessionId?: string;
  readonly activity?: WebuiSessionActivityMap;
  readonly now?: number;
  readonly pinnedSessions?: Readonly<Record<string, boolean>>;
  readonly starredSessions?: Readonly<Record<string, boolean>>;
  readonly onToggleChildren: (sessionId: string) => void;
  readonly onShowMore: () => void;
  readonly onToggleSessionPin?: (session: WebuiClientSession) => void;
  readonly onToggleSessionStar?: (session: WebuiClientSession) => void;
  readonly onArchiveSession?: (session: WebuiClientSession) => void;
  readonly onSessionContextMenu: (
    event: MouseEvent<HTMLElement>,
    session: WebuiClientSession,
    isChild?: boolean,
  ) => void;
}) {
  return (
                <div
                  className={`webui-expandable-motion${expanded ? " is-open" : ""}`}
                  aria-hidden={!expanded}
                  ref={(element) => element?.toggleAttribute("inert", !expanded)}
                >
                  <ul
                    className="webui-project-session-list"
                    data-webui-project-sessions={projectKey}
                  >
                    {visibleSessionIds.map((sessionId) => {
                      const session = sessionsById.get(sessionId);
                      if (!session) return null;
                      const children = childrenByParentId.get(session.sessionId) ?? [];
                      const childrenExpanded = expandedSessionIds.has(session.sessionId);
                      const sessionActive = session.sessionId === selectedSessionId;
                      return (
                        <li key={session.sessionId}>
                          <div
                            className="webui-project-session-row group/session"
                            data-webui-session-active={sessionActive ? "true" : "false"}
                          >
                            <span className="webui-session-leading-marker">
                            {children.length > 0 ? (
                              <button
                                type="button"
                                className="webui-session-disclosure"
                                aria-label={`${childrenExpanded ? "收起" : "展开"}子会话：${sessionLabel(session)}`}
                                aria-expanded={childrenExpanded}
                                title={childrenExpanded ? "收起子会话" : "展开子会话"}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onToggleChildren(session.sessionId);
                                }}
                              >
                                <WebuiIconSessionDisclosure className={childrenExpanded ? "is-expanded" : undefined} />
                              </button>
                            ) : <span aria-hidden="true" className="webui-session-leading-line" />}
                            </span>
                            <a
                              href={sessionHash(session.sessionId)}
                              data-webui-session-link={session.sessionId}
                              data-webui-session-active={sessionActive ? "true" : "false"}
                              onContextMenu={(event) => onSessionContextMenu(event, session)}
                              className="webui-project-session-card text-text_default_primary"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {sessionLabel(session)}
                              </span>
                              <SessionActivityMeta
                                session={session}
                                activity={activity}
                                now={now}
                                pinned={Boolean(pinnedSessions?.[session.sessionId])}
                                starred={Boolean(starredSessions?.[session.sessionId])}
                              />
                            </a>
                            <div className="webui-session-row-actions">
                              {onToggleSessionPin ? (
                                <button
                                  type="button"
                                  aria-label={`${pinnedSessions?.[session.sessionId] ? "取消置顶" : "置顶"}：${sessionLabel(session)}`}
                                  title={pinnedSessions?.[session.sessionId] ? "取消置顶" : "置顶"}
                                  className="webui-rail-action"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onToggleSessionPin(session);
                                  }}
                                >
                                  {/* The glyph draws the ACTION, not the state: already
                                   *  pinned means the click unpins, so the button offers
                                   *  the slashed pin. Same component the context menu
                                   *  uses, so the two cannot drift apart. */}
                                  <WebuiIconContextPin pinned={Boolean(pinnedSessions?.[session.sessionId])} />
                                </button>
                              ) : null}
                              {onToggleSessionStar ? (
                                <button
                                  type="button"
                                  aria-label={`${starredSessions?.[session.sessionId] ? "取消收藏" : "收藏"}：${sessionLabel(session)}`}
                                  title={starredSessions?.[session.sessionId] ? "取消收藏" : "收藏"}
                                  className="webui-rail-action"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onToggleSessionStar(session);
                                  }}
                                >
                                  {/* Outline until starred, yellow fill after. Unlike the
                                   *  pin, this glyph shows the state rather than the
                                   *  action: a filled star is not read as "remove"
                                   *  anywhere in the world's icon vocabulary. */}
                                  <WebuiIconSessionStar starred={Boolean(starredSessions?.[session.sessionId])} />
                                </button>
                              ) : null}
                              {onArchiveSession ? (
                                <button
                                  type="button"
                                  aria-label={`${session.archived ? "取消归档" : "归档"}：${sessionLabel(session)}`}
                                  title={session.archived ? "取消归档" : "归档"}
                                  className="webui-rail-action"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onArchiveSession(session);
                                  }}
                                >
                                  <WebuiIconContextArchive />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                aria-label={`${sessionLabel(session)} 更多操作`}
                                title="更多操作"
                                className="webui-rail-action"
                                onClick={(event) => onSessionContextMenu(event, session)}
                              >
                                <WebuiIconMore />
                              </button>
                            </div>
                          </div>
                          {children.length > 0 && childrenExpanded ? (
                            <ul
                              className="webui-project-child-session-list"
                              data-webui-project-child-sessions={session.sessionId}
                            >
                              {children.map((child) => (
                                <li key={child.sessionId}>
                                  <div className="webui-project-child-session-row group/session">
                                    <a
                                      href={sessionHash(child.sessionId)}
                                      data-webui-session-link={child.sessionId}
                                      data-webui-session-child-of={session.sessionId}
                                      data-webui-session-active={
                                        child.sessionId === selectedSessionId
                                          ? "true"
                                          : "false"
                                      }
                                      onContextMenu={(event) => onSessionContextMenu(event, child, true)}
                                      className="webui-project-child-session-card text-text_default_primary"
                                    >
                                      <WebuiIconAgent className="size-4 shrink-0" />
                                      <span className="min-w-0 flex-1 truncate">
                                        {sessionLabel(child)}
                                      </span>
                                      <SessionActivityMeta
                                        session={child}
                                        activity={activity}
                                        now={now}
                                        pinned={Boolean(pinnedSessions?.[child.sessionId])}
                                        starred={Boolean(starredSessions?.[child.sessionId])}
                                      />
                                    </a>
                                    <div className="webui-session-row-actions">
                                      <button
                                        type="button"
                                        aria-label={`${sessionLabel(child)} 更多操作`}
                                        title="更多操作"
                                        className="webui-rail-action"
                                        onClick={(event) => onSessionContextMenu(event, child, true)}
                                      >
                                        <WebuiIconMore />
                                      </button>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                    {hasMore ? (
                      <li key={`${projectKey}-more`}>
                        <button
                          type="button"
                          className="webui-project-session-more text-text_default_tertiary"
                          onClick={() => {
                            onShowMore();
                          }}
                        >
                          更多
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </div>
  );
}
