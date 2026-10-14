/**
 * The new-task workspace: which directory the next session starts in, and the
 * three ways that choice changes.
 *
 * The rule the effect encodes is the part worth keeping in one place: an explicit
 * "no project" choice (this session's, or the persisted one) wins over the
 * auto-fill, so picking a project and then hitting 「新建任务」 does not pull a
 * workspace back. `startNewTask` clears the draft and the selection, and
 * `handleSessionCreated` adopts the home session onto the created one.
 *
 * Extracted from `WebuiClientFoundationApp.tsx` (A-005): the frame keeps layout
 * and public business composition, and this is one behaviour with its own
 * change driver.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { deriveRecentWorkspaceDirs } from "../../features/composer/projection/composer-state.js";
import { sessionHash } from "../../projection/common/router.js";
import type { WebuiClientSession } from "../../contracts/sessions/session-view.js";
import type { WebuiShellSurfaceCommand } from "../../projection/shell/shell-surface.js";

/** The browser storage surface this behaviour reads and writes. */
export interface NewTaskWorkspaceStorage {
  readonly readNoProjectFlag: () => boolean;
  readonly writeNoProjectFlag: (value: boolean) => void;
  readonly writeTeamModeSessionChoice: (sessionId: string, off: boolean) => void;
}

/** The session commands the rail refresh needs, as the shell holds them. */
export interface NewTaskWorkspaceWorkflows {
  readonly canLoadFlat: boolean;
  readonly canLoadTree: boolean;
  readonly loadFlat: () => Promise<void>;
  readonly loadTree: () => Promise<void>;
}

export interface UseNewTaskWorkspaceOptions {
  readonly storage: NewTaskWorkspaceStorage;
  readonly workflows: NewTaskWorkspaceWorkflows;
  /** The session the shell currently shows, if any. */
  readonly selectedSession: WebuiClientSession | undefined;
  /** Every session visible to lookups (flat page plus tree children). */
  readonly flatSessionsWithChildren: readonly WebuiClientSession[];
  readonly setDraft: (draft: string) => void;
  readonly dispatchShellSurface: (command: WebuiShellSurfaceCommand) => void;
  readonly setSelectedSessionId: (id: string | undefined) => void;
  /** Carries the home turn's live record onto the session a first message created. */
  readonly adoptHomeSession: (id: string) => void;
  readonly teamModeOff: boolean;
  readonly setTeamModeChoice: (id: string, off: boolean) => void;
}

export interface NewTaskWorkspace {
  readonly newTaskWorkspaceDir: string | undefined;
  readonly workspaceMenuOpen: boolean;
  readonly setWorkspaceMenuOpen: (open: boolean) => void;
  readonly recentWorkspaceDirs: readonly string[];
  readonly handleWorkspaceChange: (workspaceDir?: string) => void;
  readonly handleSessionCreated: (id: string) => void;
  readonly startNewTask: (workspaceDir?: string) => void;
}

export function useNewTaskWorkspace(options: UseNewTaskWorkspaceOptions): NewTaskWorkspace {
  const {
    storage,
    workflows,
    selectedSession,
    flatSessionsWithChildren,
    setDraft,
    dispatchShellSurface,
    setSelectedSessionId,
    adoptHomeSession,
    teamModeOff,
    setTeamModeChoice,
  } = options;

  const [newTaskWorkspaceDir, setNewTaskWorkspaceDir] = useState<string | undefined>(
    () => {
      // Honour an explicit "no project" choice from localStorage so the
      // auto-fill below doesn't immediately pull a workspace back.
      if (storage.readNoProjectFlag()) return undefined;
      return (
        selectedSession?.workspaceDir ??
        flatSessionsWithChildren.find((session) => session.workspaceDir)?.workspaceDir
      );
    },
  );
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  // The `最近` group in the workspace picker. Derived from the sessions the
  // client already holds rather than a new operation — see
  // `deriveRecentWorkspaceDirs` for why there is nothing to call instead.
  const recentWorkspaceDirs = useMemo(
    () => deriveRecentWorkspaceDirs(flatSessionsWithChildren),
    [flatSessionsWithChildren],
  );
  // Tracks whether the user has explicitly cleared the workspace in *this*
  // session; the effect below checks both this and the persisted flag.
  const userClearedWorkspaceRef = useRef(storage.readNoProjectFlag());
  useEffect(() => {
    if (userClearedWorkspaceRef.current) return;
    if (selectedSession?.workspaceDir) {
      setNewTaskWorkspaceDir(selectedSession.workspaceDir);
    } else if (!newTaskWorkspaceDir) {
      const workspaceDir = flatSessionsWithChildren.find(
        (session) => session.workspaceDir,
      )?.workspaceDir;
      if (workspaceDir) setNewTaskWorkspaceDir(workspaceDir);
    }
  }, [newTaskWorkspaceDir, flatSessionsWithChildren, selectedSession?.workspaceDir]);
  // Single workspace-change entry point the composer calls. It records the
  // user's intent (cleared vs picked) so the auto-fill effect above stops
  // fighting us, and folds the no-project flag into localStorage.
  const handleWorkspaceChange = useCallback(
    (workspaceDir?: string) => {
      if (workspaceDir === undefined) {
        userClearedWorkspaceRef.current = true;
        storage.writeNoProjectFlag(true);
      } else {
        userClearedWorkspaceRef.current = false;
        storage.writeNoProjectFlag(false);
      }
      setNewTaskWorkspaceDir(workspaceDir);
      setWorkspaceMenuOpen(false);
    },
    [],
  );
  const handleSessionCreated = (id: string) => {
    // Home→session adoption is one committed transition (ticket #49 criterion
    // 5): the application carries the home turn's live record onto the created
    // session, moves the composer's home slot onto it and selects it — no
    // separate migration + composer migration + selection.
    adoptHomeSession(id);
    setSelectedSessionId(id);
    storage.writeTeamModeSessionChoice(id, teamModeOff);
    setTeamModeChoice(id, teamModeOff);
    // Refresh the rail projection after the first message creates a session —
    // the flat list (its failure is reported) and the tree (best effort),
    // matching the shell's original two independent loads.
    if (workflows.canLoadFlat) void workflows.loadFlat();
    if (workflows.canLoadTree) void workflows.loadTree();
    if (typeof window !== "undefined")
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${sessionHash(id)}`,
      );
  };
  const startNewTask = (workspaceDir?: string) => {
    // A project row's plus action opens a fresh home composer preselected to
    // that workspace; the global new-task action still clears the workspace.
    const clearedWorkspace = workspaceDir === undefined;
    userClearedWorkspaceRef.current = clearedWorkspace;
    storage.writeNoProjectFlag(clearedWorkspace);
    setNewTaskWorkspaceDir(workspaceDir);
    setWorkspaceMenuOpen(false);
    setDraft("");
    // 「新建任务」 is the one navigation that does not change the selected
    // session when the shell is already on the home surface, so the effect that
    // watches the session id cannot see it. Close the marketplace here too, or
    // the row looks dead exactly as it did before.
    dispatchShellSurface({ type: "show-conversation" });
    setSelectedSessionId(undefined);
    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  };

  return {
    newTaskWorkspaceDir,
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    recentWorkspaceDirs,
    handleWorkspaceChange,
    handleSessionCreated,
    startNewTask,
  };
}
