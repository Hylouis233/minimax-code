import type { WebuiTurnDiffView } from "../../../../shared/contracts/session.js";
import { basenamePath } from "../../../projection/common/paths.js";

// ---------------------------------------------------------------------------
// The tab-kind registry. The kinds used to be enumerated in three places — the
// union here, the label map and the add menu in `WorkspacePanels.tsx` — so adding
// a kind meant finding all three, and the type system caught only two of them.
// They are declared once, below, and everything else derives: the union from the
// shapes' keys, the tab's label from the table, and the add menu from the table
// plus its order.
//
// The registry may carry a host render branch, which is why the *icons* and the
// dispatch calls stay in the component: this module has no React and no
// dispatcher. What it owns is the closed set and the words.
// ---------------------------------------------------------------------------

/**
 * One kind's tab shape. The keys are the closed set — a new kind is a new key
 * here, and nothing else spells the set out.
 *
 * `review` has two variants because one tab serves both the workspace's change
 * set and a turn's; the discriminant is `source`, not `kind`.
 */
export interface WebuiWorkspaceTabShapes {
  readonly files: {
    readonly sessionId?: string;
    readonly workspaceDir?: string;
  };
  readonly "file-preview": {
    readonly sessionId: string;
    readonly workspaceDir: string;
    readonly path: string;
    readonly lineStart?: number;
    readonly lineEnd?: number;
    readonly content?: string;
  };
  readonly review:
    | {
        readonly sessionId: string;
        readonly workspaceDir: string;
        readonly source: "workspace";
        readonly selectedPath?: string;
        readonly reviewSnapshotId?: string;
      }
    | {
        readonly sessionId: string;
        readonly workspaceDir: string;
        readonly source: "turn";
        readonly messageId: string;
        readonly assistantMessageId?: string;
        readonly turnId?: string;
        readonly changeSetId?: string;
        readonly files: WebuiTurnDiffView["fileChanges"];
        readonly selectedPath?: string;
      };
  readonly canvas: {
    readonly sessionId?: string;
  };
  readonly terminal: {
    readonly workspaceDir?: string;
  };
  /**
   * The browser panel's tab.
   *
   * It carries the optional instance fields every menu-opened tab carries and no
   * file path: a browser tab opens a browser's page, not a document in the
   * workspace. The instance fields are declared rather than refused because the
   * add menu sends them with every `open-tab` and the tab is built as one object
   * literal — a shape that would not accept them fails to compile the moment the
   * command names this kind, instead of carrying two words no view reads.
   */
  readonly browser: {
    readonly sessionId?: string;
    readonly workspaceDir?: string;
  };
}

export type WebuiWorkspaceTabKind = keyof WebuiWorkspaceTabShapes;

/** Every tab, derived: one member per declared kind, each carrying `kind` and its shape. */
export type WorkspacePanelTab = {
  [K in WebuiWorkspaceTabKind]: { readonly id: string; readonly kind: K } &
    WebuiWorkspaceTabShapes[K];
}[WebuiWorkspaceTabKind];

// Both unions describe the shape of a panel command, so they live with it in the
// workspace's contract (see `features/workspace/contracts/panel-command.ts`); they
// are re-exported here for the panel code that already read them from this module.
export type { WebuiWorkspaceAddMenuOpen, WebuiWorkspaceMenuTabKind };


export interface WebuiWorkspaceTabKindEntry {
  /** The tab's label, and the add-menu entry's when it has one. */
  readonly label: string;
  /**
   * The add-menu entry, or `null` for a kind opened only by an instance — a file
   * preview is opened by a path from the tree, never by the menu.
   */
  readonly addMenu: WebuiWorkspaceAddMenuOpen | null;
}

export const WEBUI_WORKSPACE_TAB_KINDS: Readonly<
  Record<WebuiWorkspaceTabKind, WebuiWorkspaceTabKindEntry>
> = {
  files: { label: "查看文件", addMenu: { type: "open-tab", kind: "files" } },
  "file-preview": { label: "文件", addMenu: null },
  review: { label: "变更", addMenu: { type: "open-workspace-review" } },
  canvas: { label: "画布", addMenu: { type: "open-tab", kind: "canvas" } },
  terminal: { label: "终端", addMenu: { type: "open-tab", kind: "terminal" } },
  /**
   * The browser panel.
   *
   * The command's `open-tab` names `browser` alongside the other kinds, so this
   * row has a menu entry of its own. The panel is mounted by the browser
   * business's published host, which owns the browser state — a workspace
   * component may not construct another business's state.
   */
  browser: { label: "浏览器", addMenu: { type: "open-tab", kind: "browser" } },
};

/**
 * The add menu's order. It is not the table's: 审查 leads and 查看文件 trails the
 * kinds that open a process. The browser panel leads the file views — it is
 * another thing to watch while the work runs — and contributes no entry while its
 * row above is `null`.
 */
export const WEBUI_WORKSPACE_ADD_MENU_ORDER: readonly WebuiWorkspaceTabKind[] = [
  "review",
  "terminal",
  "canvas",
  "browser",
  "files",
];

export interface WebuiWorkspaceAddMenuEntry {
  readonly kind: WebuiWorkspaceTabKind;
  readonly label: string;
  readonly opens: WebuiWorkspaceAddMenuOpen;
}

/** The add menu, derived from the table — entries and order both live there. */
export function webuiWorkspaceAddMenu(): readonly WebuiWorkspaceAddMenuEntry[] {
  return WEBUI_WORKSPACE_ADD_MENU_ORDER.flatMap((kind) => {
    const entry = WEBUI_WORKSPACE_TAB_KINDS[kind];
    return entry.addMenu ? [{ kind, label: entry.label, opens: entry.addMenu }] : [];
  });
}

/**
 * A tab's label, by one rule instead of two copies: a file preview shows its
 * file, a turn's review says "Review" (it is not the workspace's change set), and
 * every other kind shows the registry's word.
 */
export function webuiWorkspaceTabLabel(tab: WorkspacePanelTab): string {
  if (tab.kind === "file-preview") return basenamePath(tab.path);
  if (tab.kind === "review" && tab.source === "turn") return "Review";
  return WEBUI_WORKSPACE_TAB_KINDS[tab.kind].label;
}

export interface WorkspacePanelState {
  readonly open: boolean;
  readonly expanded: boolean;
  readonly tabs: readonly WorkspacePanelTab[];
  readonly activeTabId?: string;
  readonly addMenuOpen: boolean;
}

export interface WorkspacePanelSessionState {
  readonly workspacePanel: WorkspacePanelState;
  readonly progressPanelOpen: boolean;
}

/**
 * The coordinator-produced signal that a workspace's git state changed. It is
 * what replaces the panels' own `watchEvents` subscription: the application
 * event coordinator receives `workspace.git.changed` on the single channel and
 * hands the payload here, and the panels react to the signal rather than to a
 * raw process event. `revision` bumps on every signal so an effect keyed on it
 * re-runs even when two events name the same workspace.
 */
export interface WebuiWorkspaceGitChangedSignal {
  readonly revision: number;
  readonly workspace?: string;
  readonly aliases?: readonly string[];
}

export type WorkspacePanelSessionStates = ReadonlyMap<string, WorkspacePanelSessionState>;

export function getWorkspacePanelSessionState(
  states: WorkspacePanelSessionStates,
  sessionId: string,
): WorkspacePanelSessionState {
  return states.get(sessionId) ?? initialWorkspacePanelSessionState;
}

export function reduceWorkspacePanelSessionState(
  states: WorkspacePanelSessionStates,
  sessionId: string,
  command: WorkspacePanelCommand,
): WorkspacePanelSessionStates {
  const current = getWorkspacePanelSessionState(states, sessionId);
  const workspacePanel = reduceWorkspacePanelState(current.workspacePanel, command);
  const progressPanelOpen = workspacePanel.open ? false : current.progressPanelOpen;
  if (states.has(sessionId) && workspacePanel === current.workspacePanel && progressPanelOpen === current.progressPanelOpen) return states;
  const next: WorkspacePanelSessionState = {
    workspacePanel,
    // The two right-side panels occupy the same surface. Keep this invariant
    // in the state transition so session changes and batched React updates
    // cannot briefly render both panels together.
    progressPanelOpen,
  };
  const updated = new Map(states);
  updated.set(sessionId, next);
  return updated;
}

export function setWorkspaceSessionProgressPanelOpen(
  states: WorkspacePanelSessionStates,
  sessionId: string,
  open: boolean,
): WorkspacePanelSessionStates {
  const current = getWorkspacePanelSessionState(states, sessionId);
  const progressPanelOpen = open && !current.workspacePanel.open;
  if (current.progressPanelOpen === progressPanelOpen && states.has(sessionId)) return states;
  const updated = new Map(states);
  updated.set(sessionId, { ...current, progressPanelOpen });
  return updated;
}

import type {
  WebuiWorkspaceAddMenuOpen,
  WebuiWorkspaceMenuTabKind,
  WorkspacePanelCommand,
} from "../contracts/panel-command.js";

export type { WorkspacePanelCommand };


export const initialWorkspacePanelState: WorkspacePanelState = {
  open: false,
  expanded: false,
  tabs: [],
  addMenuOpen: false,
};

export const initialWorkspacePanelSessionState: WorkspacePanelSessionState = {
  workspacePanel: initialWorkspacePanelState,
  progressPanelOpen: true,
};

function tabId(kind: string, ...parts: string[]): string {
  return `${kind}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}

function activate(state: WorkspacePanelState, tab: WorkspacePanelTab): WorkspacePanelState {
  const existing = state.tabs.find((candidate) => candidate.id === tab.id);
  return {
    ...state,
    open: true,
    addMenuOpen: false,
    tabs: existing ? state.tabs.map((candidate) => candidate.id === tab.id ? tab : candidate) : [...state.tabs, tab],
    activeTabId: tab.id,
  };
}

export function reduceWorkspacePanelState(state: WorkspacePanelState, command: WorkspacePanelCommand): WorkspacePanelState {
  switch (command.type) {
    case "open-file": {
      const path = command.path.replace(/\\/gu, "/").replace(/^\.\//u, "");
      if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "")) return state;
      return activate(state, { id: tabId("file", command.sessionId, command.workspaceDir, path), kind: "file-preview", sessionId: command.sessionId, workspaceDir: command.workspaceDir, path, ...(command.lineStart !== undefined ? { lineStart: command.lineStart } : {}), ...(command.lineEnd !== undefined ? { lineEnd: command.lineEnd } : {}) });
    }
    case "open-plan-file": {
      const path = command.path.replace(/\\/gu, "/").replace(/^\.\//u, "");
      const id = tabId("file", command.sessionId, command.workspaceDir, path);
      return activate(state, { id, kind: "file-preview", sessionId: command.sessionId, workspaceDir: command.workspaceDir, path, content: command.content });
    }
    case "open-workspace-review": {
      const id = tabId("review", command.sessionId, command.workspaceDir);
      return activate(state, { id, kind: "review", source: "workspace", sessionId: command.sessionId, workspaceDir: command.workspaceDir, ...(command.selectedPath ? { selectedPath: command.selectedPath } : {}) });
    }
    case "open-turn-review": {
      const id = tabId("review", command.sessionId, command.workspaceDir);
      return activate(state, { id, kind: "review", source: "turn", sessionId: command.sessionId, workspaceDir: command.workspaceDir, messageId: command.messageId, assistantMessageId: command.assistantMessageId, turnId: command.turnId, changeSetId: command.changeSetId, files: command.files ?? [], ...(command.selectedPath ? { selectedPath: command.selectedPath } : {}) });
    }
    case "open-primary-view": {
      const id = tabId(command.kind, command.sessionId ?? "", command.workspaceDir ?? "");
      const tab: WorkspacePanelTab = { id, kind: command.kind, ...(command.sessionId ? { sessionId: command.sessionId } : {}), ...(command.workspaceDir ? { workspaceDir: command.workspaceDir } : {}) };
      const tabs = state.tabs.filter((candidate) => candidate.kind !== "files");
      return { ...state, open: true, addMenuOpen: false, tabs: [...tabs, tab], activeTabId: id };
    }
    case "open-tab": {
      const id = tabId(command.kind, command.sessionId ?? "", command.workspaceDir ?? "");
      return activate(state, { id, kind: command.kind, ...(command.sessionId ? { sessionId: command.sessionId } : {}), ...(command.workspaceDir ? { workspaceDir: command.workspaceDir } : {}) });
    }
    case "select-tab":
      return state.tabs.some((tab) => tab.id === command.tabId) ? { ...state, open: true, activeTabId: command.tabId, addMenuOpen: false } : state;
    case "select-review-file":
      return updateWorkspacePanelTab(state, command.tabId, (tab) => tab.kind === "review" ? { ...tab, selectedPath: command.path } : tab);
    case "set-review-snapshot": {
      const current = state.tabs.find((tab) => tab.id === command.tabId);
      if (current?.kind !== "review" || current.source !== "workspace" || current.reviewSnapshotId === command.reviewSnapshotId) return state;
      return updateWorkspacePanelTab(state, command.tabId, (tab) => tab.kind === "review" ? { ...tab, reviewSnapshotId: command.reviewSnapshotId } : tab);
    }
    case "close-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === command.tabId);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== command.tabId);
      const activeTabId = state.activeTabId === command.tabId ? tabs[Math.min(index, tabs.length - 1)]?.id : state.activeTabId;
      return { ...state, tabs, activeTabId, open: tabs.length > 0, addMenuOpen: false };
    }
    case "close-panel":
      return { ...state, open: false, addMenuOpen: false };
    case "toggle-expanded":
      return { ...state, expanded: !state.expanded };
    case "toggle-add-menu":
      return { ...state, open: true, addMenuOpen: !state.addMenuOpen };
  }
}

export function updateWorkspacePanelTab(state: WorkspacePanelState, tabIdValue: string, update: (tab: WorkspacePanelTab) => WorkspacePanelTab): WorkspacePanelState {
  return { ...state, tabs: state.tabs.map((tab) => tab.id === tabIdValue ? update(tab) : tab) };
}
