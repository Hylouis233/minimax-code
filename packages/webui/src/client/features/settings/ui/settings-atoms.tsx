// Presentation atoms the settings surfaces share: the copy of the three
// personalization section hints.
//
// The section header these hints hang on is not here: the shared settings
// skeleton in `client/ui/settings-layout.tsx` owns the header, its help
// affordance and the card the content sits in, and every settings page —
// these editors included — renders that frame rather than its own copy.
//
// The hints stay in the settings business because they are this business's
// copy. A tooltip is text the user reads, and a paraphrase that reads fine
// still means two surfaces stop saying the same thing about the same control.

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
