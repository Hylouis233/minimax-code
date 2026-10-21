// Browser input: turning a gesture into a command that may be forwarded.
//
// Every function here is pure, and that is the point rather than an accident of
// layering. The panel is the only place that knows what the user aimed at, and
// the only place that can therefore tell a mis-aimed click from a malformed one —
// but it is also the least testable place in the package, because this WebUI has
// no DOM in its test environment. Putting the decision here makes the decision
// assertable without one.
//
// Three rules, and each is a rule the wire format cannot enforce:
//
//   1. **Malformed input is refused, never repaired.** A `NaN` coordinate, a
//      negative one, an empty text payload and an unrecognised modifier are all
//      rejected with a stable reason. Forwarding them would move the failure to
//      the provider, where it reads as a browser bug rather than a panel bug.
//   2. **The command carries the target's generation.** Built from the target
//      identity it was aimed at, so the receiving side can tell a command meant
//      for the current page from one meant for the page that was there a moment
//      ago.
//   3. **The command is refused unless it names the page the panel is showing.**
//      A pointer press queued while the tab navigated would otherwise land on
//      whatever replaced it. Binding is checked here, at send time, against the
//      state rather than at construction time, because that is the only moment
//      the two can be compared.

import type {
  WebuiBrowserAuthorization,
  WebuiBrowserAuthorizationChange,
  WebuiBrowserErrorCode,
  WebuiBrowserInputCommand,
  WebuiBrowserInputModifier,
} from "../../../../shared/contracts/browser.js";
import type { WebuiBrowserAuthorizationToggle } from "../contracts/browser-port.js";
import {
  isUsableWebuiBrowserTargetId,
  type WebuiBrowserCommandRejectionReason,
  type WebuiBrowserCommandResult,
  type WebuiBrowserInputIntent,
  type WebuiBrowserPanelState,
} from "../contracts/browser-panel.js";

/**
 * The longest text one command may carry.
 *
 * Bounded because the command travels as one message: a paste of a large file
 * would otherwise be forwarded as a single frame the host has to hold whole. The
 * cap is generous for typing and for ordinary pastes, and a refusal is a fact
 * the panel can report rather than a truncation nobody would notice.
 */
export const WEBUI_BROWSER_TEXT_MAX_LENGTH = 65_536;

/** The longest key name one command may carry. A key name is a word, not a document. */
export const WEBUI_BROWSER_KEY_MAX_LENGTH = 128;

/** The closed set of modifiers, derived from the shared union. */
export const WEBUI_BROWSER_INPUT_MODIFIERS = Object.freeze([
  "alt",
  "ctrl",
  "meta",
  "shift",
] as const satisfies readonly WebuiBrowserInputModifier[]);

export function isWebuiBrowserInputModifier(value: unknown): value is WebuiBrowserInputModifier {
  return (
    typeof value === "string" &&
    (WEBUI_BROWSER_INPUT_MODIFIERS as readonly string[]).includes(value)
  );
}

/** The DOM flag each modifier reads, named once so the order and the source agree. */
const MODIFIER_FLAG: Readonly<
  Record<WebuiBrowserInputModifier, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
> = {
  alt: "altKey",
  ctrl: "ctrlKey",
  meta: "metaKey",
  shift: "shiftKey",
};

/** A mouse button number as the contract names it. Anything else is a left click. */
export function webuiBrowserPointerButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

/**
 * The modifiers a keyboard event carried, in a fixed order.
 *
 * Fixed rather than event-order so the same physical gesture produces the same
 * command every time, which is what makes a recorded command comparable.
 */
export function webuiBrowserModifierFlags(flags: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): readonly WebuiBrowserInputModifier[] {
  return WEBUI_BROWSER_INPUT_MODIFIERS.filter((modifier) => flags[MODIFIER_FLAG[modifier]]);
}

function rejection(
  reason: WebuiBrowserCommandRejectionReason,
  code: WebuiBrowserErrorCode,
  message: string,
): WebuiBrowserCommandResult {
  // A rejected command is never retryable as it stands: the payload is wrong, or
  // the target it names has moved on. Retrying would send the same broken command
  // to the same page and report the same failure.
  return { ok: false, reason, error: { code, message, retryable: false } };
}

function invalid(reason: WebuiBrowserCommandRejectionReason, message: string): WebuiBrowserCommandResult {
  return rejection(reason, "browser_command_invalid", message);
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The pointer command for one press, if the press is one the contract allows. */
export function buildWebuiBrowserPointerCommand(
  intent: WebuiBrowserInputIntent,
  target: WebuiBrowserInputCommand["target"],
): WebuiBrowserCommandResult {
  if (intent.kind !== "pointer") return invalid("pointer_coordinate", "指针命令的输入类型不匹配。");
  if (!isUsableWebuiBrowserTargetId(target)) {
    return rejection("target_identity", "browser_command_invalid", "指针命令缺少可用的目标标识。");
  }
  // Non-finite and negative are both refused rather than clamped: a clamped
  // coordinate silently aims at the page's edge, and the user would click
  // something they never pointed at.
  if (!finiteCoordinate(intent.x) || !finiteCoordinate(intent.y)) {
    return invalid("pointer_coordinate", "指针坐标必须是有限数值。");
  }
  if (intent.x < 0 || intent.y < 0) {
    return invalid("pointer_coordinate", "指针坐标不能为负数。");
  }
  if (intent.button !== "left" && intent.button !== "middle" && intent.button !== "right") {
    return invalid("pointer_button", "指针按钮必须是 left、middle 或 right。");
  }
  if (!Number.isInteger(intent.clickCount) || intent.clickCount < 0) {
    return invalid("pointer_click_count", "点击次数必须是非负整数。");
  }
  return { ok: true, command: { kind: "pointer", target, x: intent.x, y: intent.y, button: intent.button, clickCount: intent.clickCount } };
}

/** The keyboard command for one key press, if the press is one the contract allows. */
export function buildWebuiBrowserKeyCommand(
  intent: WebuiBrowserInputIntent,
  target: WebuiBrowserInputCommand["target"],
): WebuiBrowserCommandResult {
  if (intent.kind !== "key") return invalid("key_name", "按键命令的输入类型不匹配。");
  if (!isUsableWebuiBrowserTargetId(target)) {
    return rejection("target_identity", "browser_command_invalid", "按键命令缺少可用的目标标识。");
  }
  if (typeof intent.key !== "string") return invalid("key_name", "按键名称必须是字符串。");
  const key = intent.key.trim();
  if (key.length === 0) return invalid("key_name", "按键名称不能为空。");
  if (key.length > WEBUI_BROWSER_KEY_MAX_LENGTH) {
    return invalid("key_name", `按键名称超过 ${WEBUI_BROWSER_KEY_MAX_LENGTH} 个字符。`);
  }
  const modifiers: WebuiBrowserInputModifier[] = [];
  for (const modifier of intent.modifiers ?? []) {
    // An unrecognised modifier is refused, not dropped: dropping it would send a
    // bare keystroke where the user held a key down, which is how a shortcut
    // turns into the command it was standing in for.
    if (!isWebuiBrowserInputModifier(modifier)) {
      return invalid("key_modifier", `未知的修饰键：${String(modifier)}。`);
    }
    // A repeated modifier is the same modifier, and the list is re-emitted in the
    // canonical order rather than the order the event happened to carry, so the
    // same physical gesture always produces the same command.
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  modifiers.sort(
    (left, right) =>
      WEBUI_BROWSER_INPUT_MODIFIERS.indexOf(left) - WEBUI_BROWSER_INPUT_MODIFIERS.indexOf(right),
  );
  const text = intent.text;
  if (text !== undefined && typeof text !== "string") {
    return invalid("key_name", "按键产生的字符必须是字符串。");
  }
  return {
    ok: true,
    command: {
      kind: "key",
      target,
      key,
      ...(intent.code ? { code: intent.code } : {}),
      ...(text ? { text } : {}),
      modifiers,
    },
  };
}

/** The text command for one insertion, if the insertion is one the contract allows. */
export function buildWebuiBrowserTextCommand(
  intent: WebuiBrowserInputIntent,
  target: WebuiBrowserInputCommand["target"],
): WebuiBrowserCommandResult {
  if (intent.kind !== "text") return invalid("text_empty", "文本命令的输入类型不匹配。");
  if (!isUsableWebuiBrowserTargetId(target)) {
    return rejection("target_identity", "browser_command_invalid", "文本命令缺少可用的目标标识。");
  }
  // Empty is refused; a single space is not. The user typing a space meant a space,
  // and trimming it away would insert nothing where they expected one character.
  if (typeof intent.text !== "string" || intent.text.length === 0) {
    return invalid("text_empty", "文本内容不能为空。");
  }
  if (intent.text.length > WEBUI_BROWSER_TEXT_MAX_LENGTH) {
    return invalid("text_too_long", `文本内容超过 ${WEBUI_BROWSER_TEXT_MAX_LENGTH} 个字符。`);
  }
  return { ok: true, command: { kind: "text", target, text: intent.text } };
}

/** Builds whichever command the intent names. */
export function buildWebuiBrowserInputCommand(
  intent: WebuiBrowserInputIntent,
  target: WebuiBrowserInputCommand["target"],
): WebuiBrowserCommandResult {
  switch (intent.kind) {
    case "pointer":
      return buildWebuiBrowserPointerCommand(intent, target);
    case "key":
      return buildWebuiBrowserKeyCommand(intent, target);
    case "text":
      return buildWebuiBrowserTextCommand(intent, target);
  }
}

/**
 * Whether `target` still names the page the panel is showing.
 *
 * Both directions of a generation mismatch are refused. A command bound to an
 * older generation was aimed at a page that has been replaced; one bound to a
 * newer generation was aimed at a page the panel has not adopted yet, so sending
 * it would act on something the user cannot see.
 */
export function checkWebuiBrowserInputTarget(
  selected: WebuiBrowserPanelState["selectedTarget"],
  target: WebuiBrowserInputCommand["target"],
): WebuiBrowserCommandResult | undefined {
  if (!isUsableWebuiBrowserTargetId(target)) {
    return rejection("target_identity", "browser_command_invalid", "命令缺少可用的目标标识。");
  }
  if (!selected) {
    return rejection("target_unknown", "browser_target_unknown", "面板当前没有选中的浏览器目标。");
  }
  if (
    selected.surface !== target.surface ||
    selected.browserId !== target.browserId ||
    selected.targetId !== target.targetId
  ) {
    return rejection("target_generation_ahead", "browser_target_stale", "命令指向的目标不是面板当前显示的目标。");
  }
  if (target.generation < selected.generation) {
    return rejection(
      "target_generation_behind",
      "browser_target_stale",
      `目标已更新到第 ${selected.generation} 代，命令仍绑定第 ${target.generation} 代。`,
    );
  }
  if (target.generation > selected.generation) {
    return rejection(
      "target_generation_ahead",
      "browser_target_stale",
      `命令绑定第 ${target.generation} 代，面板显示的是第 ${selected.generation} 代。`,
    );
  }
  return undefined;
}

/**
 * The one call the panel makes: build the command, then refuse it unless it names
 * the page currently on screen.
 *
 * Both halves are here rather than left to the caller so the order cannot be
 * wrong — a command validated against a target and then sent to a different one
 * would pass both checks and still mis-aim.
 */
export function prepareWebuiBrowserInputCommand(
  state: WebuiBrowserPanelState,
  intent: WebuiBrowserInputIntent,
): WebuiBrowserCommandResult {
  const selected = state.selectedTarget;
  if (!selected) {
    return rejection("target_unknown", "browser_target_unknown", "面板当前没有选中的浏览器目标。");
  }
  const built = buildWebuiBrowserInputCommand(intent, selected);
  if (!built.ok) return built;
  const unbound = checkWebuiBrowserInputTarget(selected, built.command.target);
  return unbound ?? built;
}

/**
 * The wire change one switch move produces.
 *
 * The mapping lives here so the shape the wire accepts is named in one place:
 * the UI knows which switch moved, `shared/contracts/browser.ts` knows what a
 * write looks like, and this function is the only statement connecting them. The
 * field is present only when the switch moved — an absent field is what keeps a
 * write from clearing the three switches it does not name.
 */
export function webuiBrowserAuthorizationChange(
  toggle: WebuiBrowserAuthorizationToggle,
): WebuiBrowserAuthorizationChange {
  switch (toggle.surface) {
    case "isolated-chromium":
      return { isolatedChromium: toggle.enabled };
    case "edge":
      return { edge: toggle.enabled };
    case "chrome":
      return { chrome: toggle.enabled };
    case "full-cdp":
      return { fullCdp: toggle.enabled };
    default: {
      const exhaustive: never = toggle.surface;
      return exhaustive;
    }
  }
}

/**
 * The authorization a change produces, locally.
 *
 * Pure, and the reason the four switches can be proven independent: a change
 * naming `fullCdp` returns the surfaces exactly as they were. It is also the
 * switch UI's optimistic preview — the panel shows the next value immediately and
 * rolls back if the write fails, which is only safe because this function touches
 * one field.
 */
export function applyWebuiBrowserAuthorizationChange(
  current: WebuiBrowserAuthorization,
  change: WebuiBrowserAuthorizationChange,
): WebuiBrowserAuthorization {
  return {
    isolatedChromium: change.isolatedChromium ?? current.isolatedChromium,
    edge: change.edge ?? current.edge,
    chrome: change.chrome ?? current.chrome,
    fullCdp: change.fullCdp ?? current.fullCdp,
  };
}
