// Presentation atoms the settings surfaces share: the copy of the three
// personalization section hints, the page's button, and the page's dialog
// frame.
//
// The section header these hints hang on is not here: the shared settings
// skeleton in `client/ui/settings-layout.tsx` owns the header, its help
// affordance and the card the content sits in, and every settings page —
// these editors included — renders that frame rather than its own copy.
//
// The hints stay in the settings business because they are this business's
// copy. A tooltip is text the user reads, and a paraphrase that reads fine
// still means two surfaces stop saying the same thing about the same control.
//
// The button and the dialog frame are here for the same reason: they are the
// settings pages' own controls, and a control that each page re-authors is a
// control that drifts. The button keeps the `webui-mavis-button` classes the
// stylesheet already owns; the dialog keeps the scrim-and-surface treatment
// the memory manager established, under a name that says what it is rather
// than which feature happens to use it.

import type { ReactElement, ReactNode } from "react";

export const PERSONALIZATION_SECTION_HINTS = {
  globalInstructions:
    "定义 Agent 应该如何工作、回答和执行任务，为此设备上的所有 Agent 提供额外指令和上下文。",
  userProfile: "告诉 Agent 你的背景和长期偏好。",
  memory: "设置在此电脑上如何收集、保留和整合本地记忆。",
} as const;

/**
 * The settings pages' button.
 *
 * `compact` is the row-action size: a settings row is 56px tall, and a
 * full-width 80px button in a row's control slot reads as the row's primary
 * action rather than as the action it is. The `min-width` is what a centred
 * action like 退出登录 wants; a two-character action does not.
 */
export function SettingsButton({
  children,
  variant = "gray",
  size = "regular",
  disabled = false,
  onClick,
  testId,
  type = "button",
}: {
  readonly children: ReactNode;
  readonly variant?: "gray" | "black" | "danger";
  readonly size?: "regular" | "compact";
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly testId?: string;
  readonly type?: "button" | "submit";
}): ReactElement {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={`webui-mavis-button webui-mavis-button-${variant}${size === "compact" ? " webui-mavis-button-compact" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * The settings pages' dialog: a scrim, a surface, a header with a close
 * button, and a body the caller fills.
 *
 * The scrim is what makes a dialog a dialog. The workspace's commit dialog
 * floats without one, which suits a confirm that appears over work the user
 * is still looking at; a dialog that lists thirty days of history does not,
 * because the list it floats over competes with the list it holds.
 */
export function SettingsDialog({
  title,
  children,
  footer,
  onClose,
  testId,
  width = "narrow",
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly testId?: string;
  readonly width?: "narrow" | "wide";
}): ReactElement {
  return (
    <div className="webui-settings-dialog-mask">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className={`webui-settings-dialog-surface${width === "wide" ? " is-wide" : ""}`}
      >
        <header className="webui-settings-dialog-header">
          <h3>{title}</h3>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="webui-settings-dialog-body">{children}</div>
        {footer ? <footer className="webui-settings-dialog-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
