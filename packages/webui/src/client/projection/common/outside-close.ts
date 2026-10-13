/**
 * Outside-close policy catalogue.
 *
 * Six WebUI surfaces close themselves when an interaction happens outside
 * the surface's container. The implementations vary across components
 * today; this module captures the six existing behaviours as data so the
 * truth table lives in one place and a future refactor (e.g. unifying
 * pointerdown + mousedown into a single hook) can read from it without
 * rebuilding the matrix.
 *
 * No runtime change: this module is documentation + a pure evaluation
 * function. The components continue to attach their listeners
 * directly; the policy table pins the contract.
 *
 * Pointer-event vocabulary:
 *
 *   `pointerdown` — the modern, fire-and-forget pointer event. Fires for
 *                    mouse, touch, pen. Used by UserMenu, ModelPicker,
 *                    SessionComposer's permission popover, workspace picker
 *                    and slash-popover.
 *   `mousedown`    — the legacy mouse-only event. Used by ContextMenu;
 *                    kept verbatim because the desktop's context menu
 *                    listener is also `mousedown`.
 *   `keydown`      — keyboard event. Used by UserMenu and ContextMenu
 *                    for the Escape key, and by the composer for the
 *                    permission popover; the `pointerdown`-only surfaces
 *                    (ModelPicker, workspace picker, slash-popover) do NOT
 *                    listen to keyboard — the regex-driven dismiss in
 *                    slash-popover is triggered by the input change, and
 *                    ModelPicker is dismissed by the click that opens
 *                    another picker / blurs the textarea.
 *
 * Truth table — every (event, target-relationship-to-container) cell:
 *
 *   | surface        | pointerdown outside | pointerdown inside | mousedown outside | Escape |
 *   |----------------|---------------------|--------------------|-------------------|--------|
 *   | userMenu       | close               | ignore             | (n/a — pointer)   | close  |
 *   | modelPicker    | close               | ignore             | (n/a — pointer)   | (n/a)  |
 *   | permissionMenu | close               | ignore             | (n/a — pointer)   | close  |
 *   | workspacePicker| close               | ignore             | (n/a — pointer)   | (n/a)  |
 *   | slashPopover   | close (clear draft) | ignore             | (n/a — pointer)   | (n/a)  |
 *   | contextMenu    | (n/a — mousedown)   | (n/a — mousedown)  | close             | close  |
 *
 * Every cell maps to `evaluateOutsideClose(...) === true | false | null`
 * (null = event not subscribed by this surface; the component never
 * attaches a listener for it, so the value is purely documentation).
 *
 * "Container" is per-surface and the difference is load-bearing:
 * `permissionMenu`'s and `workspacePicker`'s containers are their own
 * trigger-and-body wraps, while `slashPopover`'s is the whole composer
 * region. All three therefore answer "ignore" for an inside click, but
 * they answer it for DIFFERENT clicks — the permission popover and the
 * workspace picker dismiss on a textarea click, the slash popover does
 * not. Reusing one ref for both shapes is what made those panels stick.
 */

export type WebuiOutsideCloseSurface =
  | "userMenu"
  | "modelPicker"
  | "permissionMenu"
  | "composerMenu"
  | "workspacePicker"
  | "slashPopover"
  | "contextMenu";

export type WebuiOutsideCloseEventKind = "pointerdown" | "mousedown" | "keydown";

/**
 * One row of the policy table. `subscribedKinds` lists the events the
 * surface attaches listeners for; the `kind` value the listener cares
 * about for `keydown` is the `key` field, all other surfaces close on any
 * event of the subscribed kind. `usesContainerContains` is always true
 * today (every implementation uses `Node.contains` to test inside-ness);
 * the flag exists so a future portal-rendered surface can flip it off
 * without rewriting the table.
 */
export interface WebuiOutsideClosePolicy {
  readonly surface: WebuiOutsideCloseSurface;
  readonly subscribedKinds: readonly WebuiOutsideCloseEventKind[];
  readonly usesContainerContains: true;
  readonly onEscape?: boolean;
  readonly notes: string;
}

export const WEBUI_OUTSIDE_CLOSE_POLICIES: {
  readonly [K in WebuiOutsideCloseSurface]: WebuiOutsideClosePolicy;
} = {
  userMenu: {
    surface: "userMenu",
    subscribedKinds: ["pointerdown", "keydown"],
    usesContainerContains: true,
    onEscape: true,
    notes:
      "UserMenu listens to pointerdown + keydown; Escape closes; the keydown does not check inside-ness (Escape is a global key).",
  },
  modelPicker: {
    surface: "modelPicker",
    subscribedKinds: ["pointerdown"],
    usesContainerContains: true,
    notes:
      "ModelPicker listens to pointerdown only; no Escape handler — closing is triggered by an outside click that hits another surface or by re-clicking the trigger.",
  },
  permissionMenu: {
    surface: "permissionMenu",
    subscribedKinds: ["pointerdown", "keydown"],
    usesContainerContains: true,
    onEscape: true,
    notes:
      "Permission popover listens to pointerdown only at the document level; its container is the trigger-and-popover wrap, NOT the composer region, so a click on the textarea or any other footer control also dismisses it. Escape is handled by the composer's own onKeyDown (textarea and popover), not by a document-level listener — so Escape only closes it when focus is inside the composer.",
  },
  composerMenu: {
    surface: "composerMenu",
    subscribedKinds: ["pointerdown"],
    usesContainerContains: true,
    notes:
      "The composer's `+` menu (attach / skills / plugins / goal / plan) listens to pointerdown only; its container is the trigger-and-panel wrap, NOT the composer region, so a click on the textarea or any other footer control also dismisses it. Escape is handled by the panel's own onKeyDown.",
  },
  workspacePicker: {
    surface: "workspacePicker",
    subscribedKinds: ["pointerdown"],
    usesContainerContains: true,
    notes:
      "Workspace picker (the 选择文件夹 bar under the composer) listens to pointerdown only; its container is its own wrap — trigger pill plus the menu or the directory-browser dialog — so any other click dismisses it. No Escape handler: Escape was never wired for this surface.",
  },
  slashPopover: {
    surface: "slashPopover",
    subscribedKinds: ["pointerdown"],
    usesContainerContains: true,
    notes:
      "Slash popover listens to pointerdown only; no Escape handler — the composer input change handler drops the '/xxx' segment when the regex no longer matches.",
  },
  contextMenu: {
    surface: "contextMenu",
    subscribedKinds: ["mousedown", "keydown"],
    usesContainerContains: true,
    onEscape: true,
    notes:
      "ContextMenu listens to mousedown (NOT pointerdown — desktop parity) + keydown; Escape closes.",
  },
} as const;

/**
 * Pure evaluation: given a surface policy, an event kind, an event key (for
 * keydown), and whether the target is inside the container, return whether
 * the close should fire.
 *
 * Behaviour table:
 *
 *   | surface        | event       | key     | inside | result     |
 *   |----------------|-------------|---------|--------|------------|
 *   | userMenu       | pointerdown | (any)   | true   | ignore     |
 *   | userMenu       | pointerdown | (any)   | false  | close      |
 *   | userMenu       | keydown     | Escape  | (any)  | close      |
 *   | userMenu       | keydown     | other   | (any)  | ignore     |
 *   | modelPicker    | pointerdown | (any)   | true   | ignore     |
 *   | modelPicker    | pointerdown | (any)   | false  | close      |
 *   | permissionMenu | pointerdown | (any)   | true   | ignore     |
 *   | permissionMenu | pointerdown | (any)   | false  | close      |
 *   | permissionMenu | keydown     | Escape  | (any)  | close      |
 *   | permissionMenu | keydown     | other   | (any)  | ignore     |
 *   | workspacePicker | pointerdown | (any)  | true   | ignore     |
 *   | workspacePicker | pointerdown | (any)  | false  | close      |
 *   | slashPopover   | pointerdown | (any)   | true   | ignore     |
 *   | slashPopover   | pointerdown | (any)   | false  | close      |
 *   | contextMenu    | mousedown   | (any)   | true   | ignore     |
 *   | contextMenu    | mousedown   | (any)   | false  | close      |
 *   | contextMenu    | keydown     | Escape  | (any)  | close      |
 *
 * Events the surface does NOT subscribe to return `null` (the component
 * would never attach a listener for that kind, so the value is purely
 * documentation).
 */
export type WebuiOutsideCloseDecision = "close" | "ignore" | "not-subscribed";

export function evaluateOutsideClose(args: {
  readonly surface: WebuiOutsideCloseSurface;
  readonly kind: WebuiOutsideCloseEventKind;
  readonly key?: string;
  readonly insideContainer: boolean;
}): WebuiOutsideCloseDecision {
  const policy = WEBUI_OUTSIDE_CLOSE_POLICIES[args.surface];
  if (!policy.subscribedKinds.includes(args.kind)) {
    return "not-subscribed";
  }
  if (args.kind === "keydown") {
    if (args.key === "Escape" && policy.onEscape === true) return "close";
    return "ignore";
  }
  // pointerdown / mousedown — close when the event target is outside
  // the surface container; ignore when the user clicked inside.
  if (args.insideContainer) return "ignore";
  return "close";
}

/**
 * Which of the composer's three dismissible surfaces a single `pointerdown`
 * closes.
 *
 * `SessionComposer` drives three surfaces from ONE document-level
 * `pointerdown` listener — the `+` attachment menu (`composerMenu`), the
 * permission popover (`permissionMenu`) and the `@` mention list
 * (`mentionRange`) — but they do not share a container, and that is the whole
 * point of this function:
 *
 *   - `composerMenu` and `mentionRange` are anchored to the textarea / `+`
 *     trigger. They stay open while the pointer moves around inside the
 *     composer region, because the caret moving is not a dismissal.
 *   - `permissionMenu` is a dropdown hinged to the footer button. Its
 *     container is its own wrap, so ANY other click dismisses it — including
 *     a click on the textarea, which is the case that used to get stuck.
 *
 * Collapsing this into the region test (`inside the region → ignore`) is what
 * made the popover un-dismissable from anywhere inside the composer. Keep the
 * wrap check separate.
 *
 * Returned as three independent booleans because the caller feeds three
 * separate setters; a single `shouldClose` invites a caller to apply the
 * region rule to all three and reintroduce the bug this split prevents.
 */
export function evaluateComposerDismiss(input: {
  readonly permissionMenuOpen: boolean;
  readonly insidePermissionWrap: boolean;
  readonly addMenuOpen: boolean;
  readonly insideAddWrap: boolean;
  readonly insideComposerRegion: boolean;
}): {
  readonly closeComposerMenu: boolean;
  readonly closePermissionMenu: boolean;
  readonly closeMentionRange: boolean;
} {
  // Two anchored dropdowns first: while either is open the click is judged
  // against its OWN trigger-and-body wrap, never against the region. A region
  // test would swallow every click in the composer and leave the panel stuck.
  const anchored = input.permissionMenuOpen
    ? { surface: "permissionMenu" as const, inside: input.insidePermissionWrap }
    : input.addMenuOpen
      ? { surface: "composerMenu" as const, inside: input.insideAddWrap }
      : undefined;
  if (anchored) {
    const closes = evaluateOutsideClose({
      surface: anchored.surface,
      kind: "pointerdown",
      insideContainer: anchored.inside,
    }) === "close";
    return {
      closeComposerMenu: closes,
      closePermissionMenu: closes,
      closeMentionRange: closes,
    };
  }
  if (input.insideComposerRegion) {
    // Caret moved within the composer: the region-anchored surface stays.
    return {
      closeComposerMenu: false,
      closePermissionMenu: false,
      closeMentionRange: false,
    };
  }
  // A pointerdown clear of the composer dismisses everything at once, which is
  // the long-standing behaviour for all three.
  return {
    closeComposerMenu: true,
    closePermissionMenu: true,
    closeMentionRange: true,
  };
}