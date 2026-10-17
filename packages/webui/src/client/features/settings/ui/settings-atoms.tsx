// Presentation atoms the settings surfaces share: two stroke glyphs and the
// section header three of the personalization editors hang their titles and
// hints on.
//
// The header is here rather than in `PersonalizationSettings.tsx` because that file *composes* those
// editors: a child importing the header back from its parent would be a cycle, and a shared rule
// belongs with the module that owns the concept — a settings-surface atom belongs with the other
// settings-surface atoms.
//
// They were declared inside `SettingsModal.tsx`; more than one module needs them, so they live here
// rather than being copied. `client/shell/icons.tsx` has a folder and a search icon, but they are
// filled paths with different geometry — substituting them would change what the user sees, which
// this package does not do to save a file.
//
// `IconButton`, `CloseIcon` and `RefreshIcon` were here too, but the models provider
// form reached in for them: three glyphs a models component should not have to
// import from a peer's private presentation module. They are presentation with no
// business owner, so they moved to `client/ui/form-atoms.tsx` beside the other
// cross-business atoms.

import type { ReactElement, ReactNode } from "react";

/**
 * The three section bubbles, word for word.
 *
 * Exported because the test asserts the exact strings: a tooltip is copy the
 * user reads, and a paraphrase that reads fine still means two surfaces stop
 * saying the same thing about the same control.
 */
export const PERSONALIZATION_SECTION_HINTS = {
  globalInstructions:
    "定义 Agent 应该如何工作、回答和执行任务，为此设备上的所有 Agent 提供额外指令和上下文。",
  userProfile: "告诉 Agent 你的背景和长期偏好。",
  memory: "设置在此电脑上如何收集、保留和整合本地记忆。",
} as const;

/**
 * The section title's help affordance.
 *
 * A real bubble rather than a native `title`: `title` cannot match the dark
 * bubble with an arrow this hangs above the glyph — the
 * browser draws its own surface, delays it about a second, and paints no
 * arrow. The shape itself is not new — `.webui-signin-credits-tooltip` and
 * `.webui-context-usage-label` already carry it, and this is the third call
 * site against the same object rather than a third design.
 *
 * Two decisions worth stating. It is a real `button`, not the `role="img"`
 * span it replaces, so the affordance is reachable by keyboard; the bubble is
 * `aria-hidden` because `aria-label` already reads as the control's name and
 * a `role="tooltip"` nothing references would be a second, dangling
 * announcement of the same sentence.
 */
export function InfoHint({ text, testId }: { readonly text: string; readonly testId: string }): ReactElement {
  return (
    <span className="webui-settings-info-hint-anchor">
      <button type="button" data-testid={testId} className="webui-settings-info-hint" aria-label={text}>
        i
      </button>
      <span aria-hidden="true" className="webui-settings-info-hint-bubble">
        {text}
      </span>
    </span>
  );
}

export function SectionHeader({
  title,
  hintTestId,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly hintTestId: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="webui-personalization-header">
      {/* Title and hint travel together: the header is `space-between`, so
          three loose children would push the action button into the middle. */}
      <div className="webui-personalization-title">
        <h3>{title}</h3>
        <InfoHint text={hint} testId={hintTestId} />
      </div>
      {children}
    </div>
  );
}
