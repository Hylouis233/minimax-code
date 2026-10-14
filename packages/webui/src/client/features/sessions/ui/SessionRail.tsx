// SessionRail — the desktop-faithful rail listing projects + recent sessions.
//
// T07's responsibility cut: the grouping/labelling/search rules now live in
// `features/sessions/projection/rail-groups.ts`, and the four cohesive units this
// file used to hold in one piece are their own modules beside it — the view
// strip (`rail-view-tabs.tsx`), a project's expansion (`project-expansion.tsx`),
// the row context menu (`rail-context-menu.tsx`) and the activity meta line
// (`session-activity-meta.tsx`). What stays here is the two list surfaces and
// the state they own.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  WebuiIconContextArchive,
  WebuiIconContextCopy,
  WebuiIconContextExport,
  WebuiIconContextFeedback,
  WebuiIconContextFork,
  WebuiIconContextPin,
  WebuiIconContextRename,
  WebuiIconContextTrash,
  WebuiIconFolder,
  WebuiIconMore,
  WebuiIconProjectAdd,
  WebuiIconSessionPinMark,
  WebuiIconSessionStar,
} from "../../../components/shell/icons.js";
import { type WebuiContextMenuItem } from "../../../components/shared/ContextMenu.js";
import type { WebuiClientSession, WebuiClientSessionPage, WebuiClientSessionTreePage, WebuiClientProject } from "../../../contracts/sessions/session-view.js";
import { formatWebuiUnreadBadge } from "../../../projection/common/unread-badge.js";
import { sessionHash } from "../../../projection/common/router.js";
import { workspaceProjectName } from "../../workspace/projection/workspace-name.js";
import { ProjectExpansion } from "./project-expansion.js";
import { RailContextMenu } from "./rail-context-menu.js";
import { RailViewTabs } from "./rail-view-tabs.js";
import { RailRow } from "./RailRow.js";
import { SessionActivityMeta } from "./session-activity-meta.js";
import {
  filterWebuiRailViewSessions,
  selectWebuiRailViewTabs,
  type WebuiRailView,
} from "../projection/rail-buckets.js";
import {
  PROJECT_SESSION_BATCH_SIZE,
  filterWebuiSessionsByQuery,
  filterWebuiProjectsByQuery,
  groupWebuiSessionsByWorkspace,
  resolveDefaultExpandedProjectKey,
  sessionLabel,
  sortWebuiProjectSessionIds,
  type WebuiProjectGroup,
} from "../projection/rail-groups.js";
import {
  webuiRailMenuFor,
  type WebuiRailMenuEntry,
  type WebuiRailMenuSubject,
} from "../projection/rail-menu.js";
import { type WebuiSessionActivityMap } from "../projection/session-activity.js";

/**
 * What the rail-menu wiring needs, gathered from the component's props and the
 * subject being opened for. `session` and `project` are optional because the two
 * menus use disjoint halves of it; each wiring entry reads the one its subject
 * supplies.
 */
interface RailMenuHandlers {
  readonly session?: WebuiClientSession;
  readonly project?: WebuiProjectGroup;
  readonly pinned: boolean;
  readonly starred: boolean;
  readonly archived: boolean;
  readonly hasWorkspaceDir: boolean;
  readonly onToggleSessionPin?: (session: WebuiClientSession) => void;
  readonly onToggleSessionStar?: (session: WebuiClientSession) => void;
  readonly onRenameSession?: (session: WebuiClientSession) => void;
  readonly onArchiveSession?: (session: WebuiClientSession) => void;
  readonly onForkSession?: (session: WebuiClientSession, worktree: boolean) => void;
  readonly onCopySession?: (
    session: WebuiClientSession,
    kind: "sessionId" | "workspaceDir",
  ) => void;
  readonly onExportSession?: (session: WebuiClientSession) => void;
  readonly onDeleteSession?: (session: WebuiClientSession) => void;
  readonly onRenameProject?: (project: WebuiProjectGroup) => void;
  readonly onToggleProjectPin?: (project: WebuiProjectGroup) => void;
  readonly onArchiveProject?: (project: WebuiProjectGroup) => void;
}

export function WebuiProjectList({
  page,
  treePage,
  projectRecords,
  query,
  loading,
  onLoadMore,
  selectedSessionId,
  onProjectSelect,
  onCreateTaskInProject,
  error,
  pinnedSessions,
  starredSessions,
  pinnedProjects,
  projectNames,
  teamModeLabel,
  onRenameProject,
  onToggleProjectPin,
  onArchiveProject,
  onRenameSession,
  onToggleSessionPin,
  onToggleSessionStar,
  onArchiveSession,
  onForkSession,
  onCopySession,
  onExportSession,
  onDeleteSession,
  activity,
  now,
  view: viewProp,
  onViewChange,
}: {
  readonly page: WebuiClientSessionPage;
  readonly treePage?: WebuiClientSessionTreePage;
  readonly projectRecords?: readonly WebuiClientProject[];
  readonly query?: string;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly onProjectSelect?: (workspaceDir?: string) => void;
  readonly onCreateTaskInProject?: (project: WebuiProjectGroup) => void;
  readonly error?: string;
  readonly pinnedSessions?: Readonly<Record<string, boolean>>;
  /** Which rows the 收藏 view collects, and which carry the standing star. */
  readonly starredSessions?: Readonly<Record<string, boolean>>;
  readonly pinnedProjects?: Readonly<Record<string, boolean>>;
  readonly projectNames?: Readonly<Record<string, string>>;
  readonly onRenameProject?: (project: WebuiProjectGroup) => void;
  readonly onToggleProjectPin?: (project: WebuiProjectGroup) => void;
  readonly onArchiveProject?: (project: WebuiProjectGroup) => void;
  readonly onRenameSession?: (session: WebuiClientSession) => void;
  readonly onToggleSessionPin?: (session: WebuiClientSession) => void;
  readonly onToggleSessionStar?: (session: WebuiClientSession) => void;
  readonly onArchiveSession?: (session: WebuiClientSession) => void;
  readonly onForkSession?: (session: WebuiClientSession, createIsolatedWorktree: boolean) => void;
  readonly onCopySession?: (session: WebuiClientSession, value: "workspaceDir" | "sessionId") => void;
  readonly onExportSession?: (session: WebuiClientSession) => void;
  readonly onDeleteSession?: (session: WebuiClientSession) => void;
  /** Per-session running state and last-activity, for the row's right-hand end. */
  readonly activity?: WebuiSessionActivityMap;
  readonly now?: number;
  /** Which slice of the list to show. Falls back to internal state. */
  readonly view?: WebuiRailView;
  readonly onViewChange?: (view: WebuiRailView) => void;
  /**
   * The Agent Team badge's tooltip, injected by the composition root. A view may
   * not read the platform adapter that holds the team-mode choice (plan §5.3), so
   * whoever renders the rail passes the label in.
   */
  readonly teamModeLabel?: string;

}): ReactElement {
  // Build a lookup from parent session id to its child sessions. When
  // `treePage` is provided, this lets the rail render child sessions under
  // each root — mirroring the desktop sidebar's parent/child grouping.
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, readonly WebuiClientSession[]>();
    if (!treePage) return map;
    for (const node of treePage.sessions) {
      if (node.childSessions.length > 0) {
        map.set(node.session.sessionId, node.childSessions);
      }
    }
    return map;
  }, [treePage]);
  const projects = useMemo(
    () => {
      const grouped = projectRecords
        ? (() => {
            const sessionsByWorkspace = new Map<string, WebuiClientSession[]>();
            for (const session of page.sessions) {
              const key = session.isDefaultWorkspace
                ? "__webui_unassigned_project__"
                : session.workspaceDir?.trim() || "__webui_unassigned_project__";
              const values = sessionsByWorkspace.get(key) ?? [];
              values.push(session);
              sessionsByWorkspace.set(key, values);
            }
            return projectRecords.filter((project) => !project.hidden).map((project) => {
              const key = project.workspaceDir ?? "__webui_unassigned_project__";
              const sessions = sessionsByWorkspace.get(key) ?? [];
              return {
                key,
                name: workspaceProjectName(project.workspaceDir ?? undefined),
                ...(project.workspaceDir ? { workspaceDir: project.workspaceDir } : {}),
                latestSessionId: sessions[0]?.sessionId ?? "",
                sessionIds: sessions.map(({ sessionId }) => sessionId),
                updatedAt: project.recentAtMs ?? project.latestActivityAtMs,
                pinned: project.pinned,
              };
            });
          })()
        : groupWebuiSessionsByWorkspace(page.sessions);
      return [...filterWebuiProjectsByQuery(grouped, query ?? "")].sort((left, right) => {
        const pinDelta = Number(Boolean(pinnedProjects?.[right.key] ?? right.pinned)) - Number(Boolean(pinnedProjects?.[left.key] ?? left.pinned));
        return pinDelta || right.updatedAt - left.updatedAt;
      });
    },
    [page.sessions, pinnedProjects, projectRecords, query],
  );
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 用户手动折叠过项目后，不再自动展开首个项目。
  const projectExpansionTouched = useRef(false);
  const [expandedSessions, setExpandedSessions] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [visibleProjectSessionCounts, setVisibleProjectSessionCounts] = useState<
    Readonly<Record<string, number>>
  >({});
  const [contextMenu, setContextMenu] = useState<
    | { readonly x: number; readonly y: number; readonly items: readonly WebuiContextMenuItem[] }
    | undefined
  >();
  const sessionsById = useMemo(
    () => new Map(page.sessions.map((session) => [session.sessionId, session])),
    [page.sessions],
  );

  const showContextMenu = (event: MouseEvent<HTMLElement>, items: readonly WebuiContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const fromContextMenu = event.type === "contextmenu";
    setContextMenu({
      x: fromContextMenu ? event.clientX : bounds.right - 220,
      y: fromContextMenu ? event.clientY : bounds.bottom,
      items,
    });
  };

  /**
   * The host render branch for the rail's context menu (plan §10 S1, S4). What the
   * menu *is* lives in `projection/rail-menu.ts`; what each declared key *does* —
   * its icon, whether it is enabled, and what it calls — is this one table. A
   * second place that enumerates the items is what S1's acceptance forbids, so the
   * two builders below read the registry and nothing here lists a label.
   */
  const railMenuWiring: Readonly<
    Record<
      string,
      {
        readonly icon: (handlers: RailMenuHandlers) => ReactElement;
        readonly enabled: (handlers: RailMenuHandlers) => boolean;
        readonly select?: (handlers: RailMenuHandlers) => () => void;
      }
    >
  > = {
    pin: {
      icon: (h) => <WebuiIconContextPin pinned={h.pinned} />,
      enabled: (h) => Boolean(h.onToggleSessionPin),
      select: (h) => () => h.onToggleSessionPin?.(h.session as WebuiClientSession),
    },
    star: {
      icon: (h) => <WebuiIconSessionStar starred={h.starred} />,
      enabled: (h) => Boolean(h.onToggleSessionStar),
      select: (h) => () => h.onToggleSessionStar?.(h.session as WebuiClientSession),
    },
    rename: {
      icon: () => <WebuiIconContextRename />,
      enabled: (h) => Boolean(h.onRenameSession),
      select: (h) => () => h.onRenameSession?.(h.session as WebuiClientSession),
    },
    archive: {
      icon: () => <WebuiIconContextArchive />,
      enabled: (h) => Boolean(h.onArchiveSession),
      select: (h) => () => h.onArchiveSession?.(h.session as WebuiClientSession),
    },
    "fork-current": {
      icon: () => <WebuiIconContextFork />,
      enabled: (h) => Boolean(h.onForkSession),
      select: (h) => () => h.onForkSession?.(h.session as WebuiClientSession, false),
    },
    "fork-worktree": {
      icon: () => <WebuiIconContextFork />,
      enabled: (h) => Boolean(h.onForkSession),
      select: (h) => () => h.onForkSession?.(h.session as WebuiClientSession, true),
    },
    "show-folder": { icon: () => <WebuiIconFolder />, enabled: () => false },
    copy: { icon: () => <WebuiIconContextCopy />, enabled: () => true },
    "copy-workspace-dir": {
      icon: () => <WebuiIconContextCopy />,
      enabled: (h) => h.hasWorkspaceDir && Boolean(h.onCopySession),
      select: (h) => () =>
        h.onCopySession?.(h.session as WebuiClientSession, "workspaceDir"),
    },
    "copy-session-id": {
      icon: () => <WebuiIconContextCopy />,
      enabled: (h) => Boolean(h.onCopySession),
      select: (h) => () =>
        h.onCopySession?.(h.session as WebuiClientSession, "sessionId"),
    },
    export: {
      icon: () => <WebuiIconContextExport />,
      enabled: (h) => Boolean(h.onExportSession),
      select: (h) => () => h.onExportSession?.(h.session as WebuiClientSession),
    },
    feedback: { icon: () => <WebuiIconContextFeedback />, enabled: () => false },
    delete: {
      icon: () => <WebuiIconContextTrash />,
      enabled: (h) => Boolean(h.onDeleteSession),
      select: (h) => () => h.onDeleteSession?.(h.session as WebuiClientSession),
    },
    "rename-project": {
      icon: () => <WebuiIconContextRename />,
      enabled: (h) => Boolean(h.onRenameProject),
      select: (h) => () => h.onRenameProject?.(h.project as WebuiProjectGroup),
    },
    "toggle-pin-project": {
      icon: (h) => <WebuiIconContextPin pinned={h.pinned} />,
      enabled: (h) => Boolean(h.onToggleProjectPin),
      select: (h) => () => h.onToggleProjectPin?.(h.project as WebuiProjectGroup),
    },
    "show-project-in-folder": { icon: () => <WebuiIconFolder />, enabled: () => false },
    "archive-project-sessions": {
      icon: () => <WebuiIconContextArchive />,
      enabled: (h) => Boolean(h.onArchiveProject),
      select: (h) => () => h.onArchiveProject?.(h.project as WebuiProjectGroup),
    },
    "remove-project": { icon: () => <WebuiIconContextTrash />, enabled: () => false },
  };

  const buildRailMenu = (
    subject: WebuiRailMenuSubject,
    handlers: RailMenuHandlers,
  ): readonly WebuiContextMenuItem[] => {
    const render = (entry: WebuiRailMenuEntry): WebuiContextMenuItem => {
      if (entry.kind === "divider") return { kind: "divider", key: entry.key };
      const wiring = railMenuWiring[entry.key];
      const enabled =
        entry.unwired !== true && wiring !== undefined && wiring.enabled(handlers);
      return {
        kind: "item",
        key: entry.key,
        label: typeof entry.label === "string" ? entry.label : (entry.label?.({
          pinned: handlers.pinned,
          starred: handlers.starred,
          archived: handlers.archived,
        }) ?? entry.key),
        ...(wiring ? { icon: wiring.icon(handlers) } : {}),
        ...(entry.danger ? { danger: true } : {}),
        ...(enabled ? {} : { disabled: true }),
        ...(enabled && wiring?.select ? { onSelect: wiring.select(handlers) } : {}),
        ...(entry.submenu ? { submenu: entry.submenu.map(render) } : {}),
      };
    };
    return webuiRailMenuFor(subject, {
      pinned: handlers.pinned,
      starred: handlers.starred,
      archived: handlers.archived,
    }).map(render);
  };

  const openSessionMenu = (event: MouseEvent<HTMLElement>, session: WebuiClientSession, isChild = false) => {
    showContextMenu(
      event,
      buildRailMenu(isChild ? "child-session" : "session", {
        session,
        pinned: Boolean(pinnedSessions?.[session.sessionId]),
        starred: Boolean(starredSessions?.[session.sessionId]),
        archived: Boolean(session.archived),
        hasWorkspaceDir: Boolean(session.workspaceDir),
        onToggleSessionPin,
        onToggleSessionStar,
        onRenameSession,
        onArchiveSession,
        onForkSession,
        onCopySession,
        onExportSession,
        onDeleteSession,
      }),
    );
  };

  const openProjectMenu = (event: MouseEvent<HTMLElement>, project: WebuiProjectGroup) => {
    if (!project.workspaceDir) return;
    showContextMenu(
      event,
      buildRailMenu("project", {
        project,
        pinned: Boolean(pinnedProjects?.[project.key]),
        starred: false,
        archived: false,
        hasWorkspaceDir: true,
        onRenameProject,
        onToggleProjectPin,
        onArchiveProject,
      }),
    );
  };

  useEffect(() => {
    const key = resolveDefaultExpandedProjectKey(
      projects,
      selectedSessionId,
      projectExpansionTouched.current,
    );
    if (!key) return;
    setExpandedProjects((current) => {
      if (current.has(key)) return current;
      return new Set(current).add(key);
    });
  }, [projects, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const activeProject = projects.find((project) =>
      project.sessionIds.includes(selectedSessionId),
    );
    if (!activeProject) return;
    setExpandedProjects((current) => {
      if (current.has(activeProject.key)) return current;
      return new Set(current).add(activeProject.key);
    });
  }, [projects, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || !treePage) return;
    const parent = treePage.sessions.find((node) =>
      node.childSessions.some((child) => child.sessionId === selectedSessionId),
    );
    if (!parent) return;
    setExpandedSessions((current) =>
      current.has(parent.session.sessionId)
        ? current
        : new Set(current).add(parent.session.sessionId),
    );
  }, [selectedSessionId, treePage]);

  // The rail has one view per tab rather than one stacked list. Uncontrolled
  // by default so the app does not have to own it; `view` exists so a caller
  // (or a test) can drive it.
  const [internalView, setInternalView] = useState<WebuiRailView>("projects");
  const activeView = viewProp ?? internalView;
  const setActiveView = onViewChange ?? setInternalView;
  const railTabs = useMemo(
    () => selectWebuiRailViewTabs(page.sessions, activity, starredSessions),
    [activity, page.sessions, starredSessions],
  );
  const viewSessions = useMemo(
    () => filterWebuiRailViewSessions(page.sessions, activity, activeView, starredSessions),
    [activeView, activity, page.sessions, starredSessions],
  );
  const activeTab = railTabs.find((entry) => entry.view === activeView);
  const activeTabLabel = activeTab?.label ?? "项目";

  // Not a header the user can dismiss: the count is the point. The rail keeps
  // the session the reader is on in the main column whatever the tab says, so
  // an empty tab means "nothing is running", not "you lost your conversation".
  if (activeView !== "projects") {
    return (
      <section data-webui-project-list="true" data-webui-rail-view-active={activeView}>
        <RailViewTabs tabs={railTabs} activeView={activeView} onSelect={setActiveView} />
        <WebuiSessionList
          page={{ sessions: viewSessions, hasMore: false }}
          loading={loading}
          selectedSessionId={selectedSessionId}
          error={error}
          activity={activity}
          now={now}
          pinnedSessions={pinnedSessions}
          starredSessions={starredSessions}
          heading={activeTabLabel}
          emptyLabel={activeTab?.emptyLabel}
          preserveOrder
          onSessionContextMenu={openSessionMenu}
          teamModeLabel={teamModeLabel}
        />
        {/* The menu render exists in BOTH return branches on purpose. The flat
         * views open the same `contextMenu` state the projects view does, but
         * this early return predates the menu: rendering the portal from the
         * projects branch alone left a right-click here setting state that no
         * subtree ever painted — the row appeared to do nothing. */}
        {contextMenu ? (
          <RailContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
        ) : null}
      </section>
    );
  }

  return (
    <section data-webui-project-list="true">
      <RailViewTabs tabs={railTabs} activeView={activeView} onSelect={setActiveView} />
      <div
        className="flex h-7 items-center px-2 text-sm font-normal leading-5 text-text_default_tertiary"
        data-webui-rail-section-header="true"
      >
        项目
      </div>
      {error ? (
        <p
          role="alert"
          className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16"
        >
          Unable to load projects: {error}
        </p>
      ) : null}
      {!error && projects.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          暂无项目
        </p>
      ) : (
        <ul className="space-y-px" data-webui-project-list-items="true">
          {projects.map((project) => {
            const expanded = expandedProjects.has(project.key);
            const projectName = projectNames?.[project.key] ?? project.name;
            const orderedSessionIds = sortWebuiProjectSessionIds(
              page.sessions,
              pinnedSessions ?? {},
              project.sessionIds,
            );
            const visibleSessionCount =
              visibleProjectSessionCounts[project.key] ?? PROJECT_SESSION_BATCH_SIZE;
            const visibleSessionIds = orderedSessionIds.slice(0, visibleSessionCount);
            return (
              <li key={project.key}>
                <div className="webui-project-row group/project">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => {
                      onProjectSelect?.(project.workspaceDir);
                      projectExpansionTouched.current = true;
                      setExpandedProjects((current) => {
                        const next = new Set(current);
                        if (next.has(project.key)) next.delete(project.key);
                        else next.add(project.key);
                        return next;
                      });
                    }}
                    onContextMenu={(event) => openProjectMenu(event, project)}
                    data-webui-project-link={project.key}
                    title={project.workspaceDir}
                    className="webui-project-card text-left text-text_default_secondary"
                  >
                    <WebuiIconFolder className="flex-shrink-0" />
                    {pinnedProjects?.[project.key] ?? project.pinned ? (
                      /* Leading edge, not the trailing one: `.webui-project-row-actions`
                       * is pinned to the row's right and only appears on hover, so a
                       * mark on that side would be standing proof of nothing. */
                      <span
                        className="webui-project-pin-mark"
                        data-webui-project-pin-mark="true"
                        title="已置顶"
                        aria-label="已置顶"
                        role="img"
                      >
                        <WebuiIconSessionPinMark />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm leading-5">
                      {projectName}
                    </span>
                  </button>
                  <div className="webui-project-row-actions" aria-hidden="false">
                    {project.workspaceDir && (onRenameProject || onToggleProjectPin || onArchiveProject) ? (
                      <button
                        type="button"
                        aria-label={`${projectName} 项目操作`}
                        title="项目操作"
                        className="webui-rail-action"
                        onClick={(event) => openProjectMenu(event, project)}
                      >
                        <WebuiIconMore />
                      </button>
                    ) : null}
                    {onCreateTaskInProject ? (
                      <button
                        type="button"
                        aria-label={`在 ${projectName} 中新建任务`}
                        title="新建任务"
                        className="webui-rail-action"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onCreateTaskInProject(project);
                        }}
                      >
                        <WebuiIconProjectAdd />
                      </button>
                    ) : null}
                  </div>
                </div>
                <ProjectExpansion
                  projectKey={project.key}
                  expanded={expanded}
                  sessionsById={sessionsById}
                  childrenByParentId={childrenByParentId}
                  visibleSessionIds={visibleSessionIds}
                  hasMore={orderedSessionIds.length > visibleSessionCount}
                  expandedSessionIds={expandedSessions}
                  selectedSessionId={selectedSessionId}
                  activity={activity}
                  now={now}
                  pinnedSessions={pinnedSessions}
                  starredSessions={starredSessions}
                  onToggleChildren={(sessionId) =>
                    setExpandedSessions((current) => {
                      const next = new Set(current);
                      if (next.has(sessionId)) next.delete(sessionId);
                      else next.add(sessionId);
                      return next;
                    })
                  }
                  onShowMore={() =>
                    setVisibleProjectSessionCounts((current) => ({
                      ...current,
                      [project.key]:
                        (current[project.key] ?? PROJECT_SESSION_BATCH_SIZE) +
                        PROJECT_SESSION_BATCH_SIZE,
                    }))
                  }
                  onToggleSessionPin={onToggleSessionPin}
                  onToggleSessionStar={onToggleSessionStar}
                  onArchiveSession={onArchiveSession}
                  onSessionContextMenu={openSessionMenu}
                />
              </li>
            );
          })}
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
      {contextMenu ? (
          <RailContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
      ) : null}
    </section>
  );
}

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
                onContextMenu={(event) => onSessionContextMenu?.(event, session)}
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
