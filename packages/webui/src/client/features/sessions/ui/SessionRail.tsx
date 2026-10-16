// SessionRail — the rail listing projects + recent sessions.
//
// The grouping/labelling/search rules live in
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
  WebuiIconSessionStar,
} from "../../../shell/icons.js";
import { type WebuiContextMenuItem } from "../../../ui/ContextMenu.js";
import type {
  WebuiClientSession,
  WebuiClientSessionPage,
  WebuiClientSessionTreePage,
  WebuiClientProject,
} from "../contracts/session-view.js";
import { formatWebuiUnreadBadge } from "../../../projection/common/unread-badge.js";
import { workspaceProjectName } from "../../workspace/projection/workspace-name.js";
import { ProjectList } from "./ProjectList.js";
import { RailContextMenu } from "./rail-context-menu.js";
import { RailViewTabs } from "./rail-view-tabs.js";
import { RailRow } from "./RailRow.js";
import { WebuiSessionList } from "./SessionList.js";
export { WebuiSessionList } from "./SessionList.js";
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
  type WebuiProjectGroup,
} from "../projection/rail-groups.js";
import {
  webuiRailMenuFor,
  type WebuiRailMenuEntry,
  type WebuiRailMenuSubject,
} from "../projection/rail-menu.js";
import { type WebuiSessionActivityMap } from "../projection/session-activity.js";
import { useRailContextMenu } from "../bindings/use-rail-context-menu.js";

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
  readonly onForkSession?: (
    session: WebuiClientSession,
    worktree: boolean,
  ) => void;
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
  projectLoadError,
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
  readonly projectLoadError?: string;
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
  readonly onForkSession?: (
    session: WebuiClientSession,
    createIsolatedWorktree: boolean,
  ) => void;
  readonly onCopySession?: (
    session: WebuiClientSession,
    value: "workspaceDir" | "sessionId",
  ) => void;
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
   * not read the platform adapter that holds the team-mode choice, so whoever
   * renders the rail passes the label in.
   */
  readonly teamModeLabel?: string;
}): ReactElement {
  // Build a lookup from parent session id to its child sessions. When
  // `treePage` is provided, this lets the rail render child sessions under
  // each root.
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
  const projects = useMemo(() => {
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
          return projectRecords
            .filter((project) => !project.hidden)
            .map((project) => {
              const key =
                project.workspaceDir ?? "__webui_unassigned_project__";
              const sessions = sessionsByWorkspace.get(key) ?? [];
              return {
                key,
                name: workspaceProjectName(project.workspaceDir ?? undefined),
                ...(project.workspaceDir
                  ? { workspaceDir: project.workspaceDir }
                  : {}),
                latestSessionId: sessions[0]?.sessionId ?? "",
                sessionIds: sessions.map(({ sessionId }) => sessionId),
                updatedAt: project.recentAtMs ?? project.latestActivityAtMs,
                pinned: project.pinned,
              };
            });
        })()
      : groupWebuiSessionsByWorkspace(page.sessions);
    return [...filterWebuiProjectsByQuery(grouped, query ?? "")].sort(
      (left, right) => {
        const pinDelta =
          Number(Boolean(pinnedProjects?.[right.key] ?? right.pinned)) -
          Number(Boolean(pinnedProjects?.[left.key] ?? left.pinned));
        return pinDelta || right.updatedAt - left.updatedAt;
      },
    );
  }, [page.sessions, pinnedProjects, projectRecords, query]);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 用户手动折叠过项目后，不再自动展开首个项目。
  const projectExpansionTouched = useRef(false);
  const [expandedSessions, setExpandedSessions] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [visibleProjectSessionCounts, setVisibleProjectSessionCounts] =
    useState<Readonly<Record<string, number>>>({});
  const menuAttachment = useRailContextMenu();
  const sessionsById = useMemo(
    () => new Map(page.sessions.map((session) => [session.sessionId, session])),
    [page.sessions],
  );

  const contextMenu = menuAttachment.menu;

  /**
   * The host render branch for the rail's context menu. What the menu *is* lives
   * in `projection/rail-menu.ts`; what each declared key *does* — its icon,
   * whether it is enabled, and what it calls — is this one table. A second place
   * that enumerates the items is forbidden, so the two builders below read the
   * registry and nothing here lists a label.
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
      select: (h) => () =>
        h.onToggleSessionPin?.(h.session as WebuiClientSession),
    },
    star: {
      icon: (h) => <WebuiIconSessionStar starred={h.starred} />,
      enabled: (h) => Boolean(h.onToggleSessionStar),
      select: (h) => () =>
        h.onToggleSessionStar?.(h.session as WebuiClientSession),
    },
    rename: {
      icon: () => <WebuiIconContextRename />,
      enabled: (h) => Boolean(h.onRenameSession),
      select: (h) => () => h.onRenameSession?.(h.session as WebuiClientSession),
    },
    archive: {
      icon: () => <WebuiIconContextArchive />,
      enabled: (h) => Boolean(h.onArchiveSession),
      select: (h) => () =>
        h.onArchiveSession?.(h.session as WebuiClientSession),
    },
    "fork-current": {
      icon: () => <WebuiIconContextFork />,
      enabled: (h) => Boolean(h.onForkSession),
      select: (h) => () =>
        h.onForkSession?.(h.session as WebuiClientSession, false),
    },
    "fork-worktree": {
      icon: () => <WebuiIconContextFork />,
      enabled: (h) => Boolean(h.onForkSession),
      select: (h) => () =>
        h.onForkSession?.(h.session as WebuiClientSession, true),
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
    feedback: {
      icon: () => <WebuiIconContextFeedback />,
      enabled: () => false,
    },
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
      select: (h) => () =>
        h.onToggleProjectPin?.(h.project as WebuiProjectGroup),
    },
    "show-project-in-folder": {
      icon: () => <WebuiIconFolder />,
      enabled: () => false,
    },
    "archive-project-sessions": {
      icon: () => <WebuiIconContextArchive />,
      enabled: (h) => Boolean(h.onArchiveProject),
      select: (h) => () => h.onArchiveProject?.(h.project as WebuiProjectGroup),
    },
    "remove-project": {
      icon: () => <WebuiIconContextTrash />,
      enabled: () => false,
    },
  };

  const buildRailMenu = (
    subject: WebuiRailMenuSubject,
    handlers: RailMenuHandlers,
  ): readonly WebuiContextMenuItem[] => {
    const render = (entry: WebuiRailMenuEntry): WebuiContextMenuItem => {
      if (entry.kind === "divider") return { kind: "divider", key: entry.key };
      const wiring = railMenuWiring[entry.key];
      const enabled =
        entry.unwired !== true &&
        wiring !== undefined &&
        wiring.enabled(handlers);
      return {
        kind: "item",
        key: entry.key,
        label:
          typeof entry.label === "string"
            ? entry.label
            : (entry.label?.({
                pinned: handlers.pinned,
                starred: handlers.starred,
                archived: handlers.archived,
              }) ?? entry.key),
        ...(wiring ? { icon: wiring.icon(handlers) } : {}),
        ...(entry.danger ? { danger: true } : {}),
        ...(enabled ? {} : { disabled: true }),
        ...(enabled && wiring?.select
          ? { onSelect: wiring.select(handlers) }
          : {}),
        ...(entry.submenu ? { submenu: entry.submenu.map(render) } : {}),
      };
    };
    return webuiRailMenuFor(subject, {
      pinned: handlers.pinned,
      starred: handlers.starred,
      archived: handlers.archived,
    }).map(render);
  };

  const openSessionMenu = (
    event: MouseEvent<HTMLElement>,
    session: WebuiClientSession,
    isChild = false,
  ) => {
    menuAttachment.open(
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

  const openProjectMenu = (
    event: MouseEvent<HTMLElement>,
    project: WebuiProjectGroup,
  ) => {
    if (!project.workspaceDir) return;
    menuAttachment.open(
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
    () =>
      filterWebuiRailViewSessions(
        page.sessions,
        activity,
        activeView,
        starredSessions,
      ),
    [activeView, activity, page.sessions, starredSessions],
  );
  const activeTab = railTabs.find((entry) => entry.view === activeView);
  const activeTabLabel = activeTab?.label ?? "项目";

  // Not a header the user can dismiss: the count is the point. The rail keeps
  // the session the reader is on in the main column whatever the tab says, so
  // an empty tab means "nothing is running", not "you lost your conversation".
  if (activeView !== "projects") {
    return (
      <section
        data-webui-project-list="true"
        data-webui-rail-view-active={activeView}
      >
        <RailViewTabs
          tabs={railTabs}
          activeView={activeView}
          onSelect={setActiveView}
        />
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
          <RailContextMenu menu={contextMenu} onClose={menuAttachment.close} />
        ) : null}
      </section>
    );
  }

  return (
    <section data-webui-project-list="true">
      <RailViewTabs
        tabs={railTabs}
        activeView={activeView}
        onSelect={setActiveView}
      />
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
      {projectLoadError ? (
        <p role="alert" className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16">
          Unable to load project list: {projectLoadError}
        </p>
      ) : null}
      {!error && projects.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          暂无项目
        </p>
      ) : (
        <ProjectList
          projects={projects}
          page={page}
          sessionsById={sessionsById}
          childrenByParentId={childrenByParentId}
          selectedSessionId={selectedSessionId}
          projectNames={projectNames}
          pinnedProjects={pinnedProjects}
          pinnedSessions={pinnedSessions}
          starredSessions={starredSessions}
          activity={activity}
          now={now}
          expandedProjects={expandedProjects}
          expandedSessions={expandedSessions}
          visibleProjectSessionCounts={visibleProjectSessionCounts}
          onProjectSelect={onProjectSelect}
          onToggleProject={(projectKey) => {
            projectExpansionTouched.current = true;
            setExpandedProjects((current) => {
              const next = new Set(current);
              if (next.has(projectKey)) next.delete(projectKey);
              else next.add(projectKey);
              return next;
            });
          }}
          onOpenProjectMenu={openProjectMenu}
          onCreateTaskInProject={onCreateTaskInProject}
          onToggleChildren={(sessionId) => {
            setExpandedSessions((current) => {
              const next = new Set(current);
              if (next.has(sessionId)) next.delete(sessionId);
              else next.add(sessionId);
              return next;
            });
          }}
          onShowMore={(projectKey) => {
            setVisibleProjectSessionCounts((current) => ({
              ...current,
              [projectKey]:
                (current[projectKey] ?? PROJECT_SESSION_BATCH_SIZE) +
                PROJECT_SESSION_BATCH_SIZE,
            }));
          }}
          onToggleSessionPin={onToggleSessionPin}
          onToggleSessionStar={onToggleSessionStar}
          onArchiveSession={onArchiveSession}
          onSessionContextMenu={openSessionMenu}
          onRenameProject={onRenameProject}
          onToggleProjectPin={onToggleProjectPin}
          onArchiveProject={onArchiveProject}
        />
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
        <RailContextMenu menu={contextMenu} onClose={menuAttachment.close} />
      ) : null}
    </section>
  );
}
