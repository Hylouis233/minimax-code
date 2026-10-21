// The workspace panel's published command type. It is declared here, next to the
// rest of the workspace's contracts, because more than one business dispatches
// it: the transcript opens a turn review from a message footer, and the shell
// owns the panel. A consumer reads the type from the owner's contract rather than
// from the projection that happens to reduce it.

import type { WebuiTurnDiffView } from "../../../../shared/contracts/session.js";
import type { WebuiBrowserTargetId } from "../../../../shared/contracts/browser.js";

export type WorkspacePanelCommand =
  | { readonly type: "open-file"; readonly sessionId: string; readonly workspaceDir: string; readonly path: string; readonly lineStart?: number; readonly lineEnd?: number }
  /**
   * Open the session's plan file. It sits in the session's artifacts
   * directory rather than the workspace, so the content rides along instead of
   * being read through `readWorkspaceFile`, which refuses to leave the
   * workspace root.
   */
  | { readonly type: "open-plan-file"; readonly sessionId: string; readonly workspaceDir: string; readonly path: string; readonly content: string }
  | { readonly type: "open-workspace-review"; readonly sessionId: string; readonly workspaceDir: string; readonly selectedPath?: string }
  | { readonly type: "open-turn-review"; readonly sessionId: string; readonly workspaceDir: string; readonly messageId: string; readonly assistantMessageId?: string; readonly turnId?: string; readonly changeSetId?: string; readonly files: WebuiTurnDiffView["fileChanges"]; readonly selectedPath?: string }
  | { readonly type: "open-primary-view"; readonly kind: "files"; readonly sessionId?: string; readonly workspaceDir?: string }
  /**
   * Opens a web tab, or updates the one already bound to that target.
   *
   * The command carries the target the tab is bound to. The tab's own id is
   * the client's and is assigned when the tab is opened, so the same target
   * always finds the same tab.
   */
  | { readonly type: "open-web-tab"; readonly target: WebuiBrowserTargetId; readonly title: string; readonly url: string }
  | { readonly type: "open-tab"; readonly kind: WebuiWorkspaceMenuTabKind; readonly sessionId?: string; readonly workspaceDir?: string }
  | { readonly type: "select-tab"; readonly tabId: string }
  | { readonly type: "select-review-file"; readonly tabId: string; readonly path: string }
  | { readonly type: "set-review-snapshot"; readonly tabId: string; readonly reviewSnapshotId: string }
  | { readonly type: "close-tab"; readonly tabId: string }
  | { readonly type: "close-panel" }
  | { readonly type: "toggle-expanded" }
  | { readonly type: "toggle-add-menu" };

/**
 * The kinds an `open-tab` command may name: exactly those whose add-menu entry is
 * an `open-tab`. Derived, so a kind that gains or loses a menu entry moves this
 * union with it.
 */
export type WebuiWorkspaceMenuTabKind = Extract<
  WebuiWorkspaceAddMenuOpen,
  { readonly type: "open-tab" }
>["kind"];

/** How an add-menu entry opens its tab. Data, so the component only dispatches it. */
export type WebuiWorkspaceAddMenuOpen =
  | { readonly type: "open-workspace-review" }
  | { readonly type: "open-tab"; readonly kind: "files" | "canvas" | "terminal" };
