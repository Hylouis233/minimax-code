// The workspace panel owner (T11; produced target `workspace-panel-state`).
//
// Which panel is open, which tab is active, which project is expanded and which
// search box holds what: the panel's own state, keyed by session and kept for the
// life of the application so switching sessions does not lose where the user was.
// It lived in the shell's component state, which made the shell the owner of a
// business's state and made the panel's behaviour depend on where it was mounted.
//
// The transition rules stay where they were — the pure reducers in
// `projection/workspace/workspace-panel-state.ts` — and this owner holds the map and
// notifies. The shell reads a session's slice and dispatches; it owns neither.

import {
  getWorkspacePanelSessionState,
  initialWorkspacePanelSessionState,
  reduceWorkspacePanelSessionState,
  setWorkspaceSessionProgressPanelOpen,
  type WorkspacePanelCommand,
  type WorkspacePanelSessionState,
  type WorkspacePanelSessionStates,
} from "../projection/workspace-panel-state.js";

export interface WebuiWorkspacePanelOwner {
  /** One session's slice. Returns the same object while that session is unchanged,
   *  which is what `useSyncExternalStore` compares. */
  readonly stateFor: (sessionId: string) => WorkspacePanelSessionState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (sessionId: string, command: WorkspacePanelCommand) => void;
  readonly setProgressPanelOpen: (sessionId: string, open: boolean) => void;
  readonly dispose: () => void;
}

export function createWebuiWorkspacePanelOwner(): WebuiWorkspacePanelOwner {
  let states: WorkspacePanelSessionStates = new Map();
  const listeners = new Set<() => void>();

  const commit = (next: WorkspacePanelSessionStates): void => {
    if (next === states) return;
    states = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    stateFor: (sessionId) =>
      sessionId
        ? getWorkspacePanelSessionState(states, sessionId)
        : initialWorkspacePanelSessionState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: (sessionId, command) => {
      if (!sessionId) return;
      commit(reduceWorkspacePanelSessionState(states, sessionId, command));
    },
    setProgressPanelOpen: (sessionId, open) => {
      if (!sessionId) return;
      commit(setWorkspaceSessionProgressPanelOpen(states, sessionId, open));
    },
    dispose: () => {
      listeners.clear();
      states = new Map();
    },
  };
}
