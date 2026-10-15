import type { MouseEvent, ReactElement } from "react";

import {
  WebuiIconFolder,
  WebuiIconMore,
  WebuiIconProjectAdd,
  WebuiIconSessionPinMark,
} from "../../../components/shell/icons.js";
import type {
  WebuiClientSession,
  WebuiClientSessionPage,
} from "../contracts/session-view.js";
import type { WebuiSessionActivityMap } from "../projection/session-activity.js";
import type { WebuiProjectGroup } from "../projection/rail-groups.js";
import {
  PROJECT_SESSION_BATCH_SIZE,
  sortWebuiProjectSessionIds,
} from "../projection/rail-groups.js";
import { ProjectExpansion } from "./project-expansion.js";

/** Project rows consume rail-owned display state and return named view actions. */
export function ProjectList({
  projects,
  page,
  sessionsById,
  childrenByParentId,
  selectedSessionId,
  projectNames,
  pinnedProjects,
  pinnedSessions,
  starredSessions,
  activity,
  now,
  expandedProjects,
  expandedSessions,
  visibleProjectSessionCounts,
  onProjectSelect,
  onToggleProject,
  onOpenProjectMenu,
  onCreateTaskInProject,
  onToggleChildren,
  onShowMore,
  onToggleSessionPin,
  onToggleSessionStar,
  onArchiveSession,
  onSessionContextMenu,
  onRenameProject,
  onToggleProjectPin,
  onArchiveProject,
}: {
  readonly projects: readonly WebuiProjectGroup[];
  readonly page: WebuiClientSessionPage;
  readonly sessionsById: ReadonlyMap<string, WebuiClientSession>;
  readonly childrenByParentId: ReadonlyMap<
    string,
    readonly WebuiClientSession[]
  >;
  readonly selectedSessionId?: string;
  readonly projectNames?: Readonly<Record<string, string>>;
  readonly pinnedProjects?: Readonly<Record<string, boolean>>;
  readonly pinnedSessions?: Readonly<Record<string, boolean>>;
  readonly starredSessions?: Readonly<Record<string, boolean>>;
  readonly activity?: WebuiSessionActivityMap;
  readonly now?: number;
  readonly expandedProjects: ReadonlySet<string>;
  readonly expandedSessions: ReadonlySet<string>;
  readonly visibleProjectSessionCounts: Readonly<Record<string, number>>;
  readonly onProjectSelect?: (workspaceDir?: string) => void;
  readonly onToggleProject: (projectKey: string) => void;
  readonly onOpenProjectMenu: (
    event: MouseEvent<HTMLElement>,
    project: WebuiProjectGroup,
  ) => void;
  readonly onCreateTaskInProject?: (project: WebuiProjectGroup) => void;
  readonly onToggleChildren: (sessionId: string) => void;
  readonly onShowMore: (projectKey: string) => void;
  readonly onToggleSessionPin?: (session: WebuiClientSession) => void;
  readonly onToggleSessionStar?: (session: WebuiClientSession) => void;
  readonly onArchiveSession?: (session: WebuiClientSession) => void;
  readonly onSessionContextMenu: (
    event: MouseEvent<HTMLElement>,
    session: WebuiClientSession,
    isChild?: boolean,
  ) => void;
  readonly onRenameProject?: (project: WebuiProjectGroup) => void;
  readonly onToggleProjectPin?: (project: WebuiProjectGroup) => void;
  readonly onArchiveProject?: (project: WebuiProjectGroup) => void;
}): ReactElement {
  return (
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
          visibleProjectSessionCounts[project.key] ??
          PROJECT_SESSION_BATCH_SIZE;
        const visibleSessionIds = orderedSessionIds.slice(
          0,
          visibleSessionCount,
        );
        return (
          <li key={project.key}>
            <div className="webui-project-row group/project">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  onProjectSelect?.(project.workspaceDir);
                  onToggleProject(project.key);
                }}
                onContextMenu={(event) => onOpenProjectMenu(event, project)}
                data-webui-project-link={project.key}
                title={project.workspaceDir}
                className="webui-project-card text-left text-text_default_secondary"
              >
                <WebuiIconFolder className="flex-shrink-0" />
                {(pinnedProjects?.[project.key] ?? project.pinned) ? (
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
                {project.workspaceDir &&
                (onRenameProject || onToggleProjectPin || onArchiveProject) ? (
                  <button
                    type="button"
                    aria-label={`${projectName} 项目操作`}
                    title="项目操作"
                    className="webui-rail-action"
                    onClick={(event) => onOpenProjectMenu(event, project)}
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
              onToggleChildren={onToggleChildren}
              onShowMore={() => onShowMore(project.key)}
              onToggleSessionPin={onToggleSessionPin}
              onToggleSessionStar={onToggleSessionStar}
              onArchiveSession={onArchiveSession}
              onSessionContextMenu={onSessionContextMenu}
            />
          </li>
        );
      })}
    </ul>
  );
}
