/**
 * The composer's thinking trigger (roadmap H, 模型与用量).
 *
 * A brain icon beside the send button that answers ONE question — is thinking
 * on — and, for a model with a depth scale, a second control beside it that
 * answers a different one: which level. Two questions, two controls, because
 * the brain cannot ask which depth the user wants; a clickable brain would have
 * to guess one, and a guess presented as a control is worse than no control.
 *
 * The interesting part is the THREE-valued `isThinkingOn`. A colour is a
 * claim, and there is a case where this process cannot support any claim at
 * all: the wire contract says an empty effort means "no override, the engine
 * picks", and the engine never reports back which level it chose. So the empty
 * case is `null`, not `false` — a blue brain next to the word "Default" would
 * assert a state nothing here can verify. `null` renders in the neutral colour
 * and lets the LABEL carry the truth; colour reinforces, text decides.
 *
 * Ported from `webapp/lib/effort-control.ts` in the other WebUI implementation,
 * re-shaped onto this repository's model entry: the target reports
 * `effortOptions` plus `thinking.effort` / `variant`, where the source reported
 * a `thinkingLevels` array and a single `thinking` string. The shape decisions
 * are unchanged.
 */

import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
} from "../../contracts/models/model-view.js";

/** Which control shape a model's thinking options render as. */
export type ThinkingControlShape = "switch" | "radiogroup" | null;

/**
 * Which control a model's option list renders as.
 *
 *   - exactly `["off","on"]` (either order) → a switch, the two-state shape a
 *     switchable builtin projects;
 *   - anything else with entries → a radio group, because that is a depth scale
 *     and a switch cannot express "medium";
 *   - an empty list → NO control at all. A no-op control is worse than none: it
 *     invites a click that changes nothing.
 */
export function thinkingControlShape(
  options: readonly string[],
): ThinkingControlShape {
  if (options.length === 0) return null;
  if (options.length === 2 && options.includes("off") && options.includes("on")) {
    return "switch";
  }
  return "radiogroup";
}

/**
 * Is thinking ON — `true` / `false` / `null` for "this process cannot say".
 *
 *   - an absent or empty record is the ENGINE's default and is `null`;
 *   - a record the model does not offer is `null` too, because the record does
 *     not describe this model — a cross-model leftover, not a state;
 *   - a recorded DEPTH (low / medium / high / …) counts as ON. It is a request
 *     FOR thinking, and treating it as off would grey the control while the
 *     engine is visibly reasoning. Only an explicit "off" is off.
 */
export function isThinkingOn(
  options: readonly string[],
  recorded: string | undefined,
): boolean | null {
  const value = (recorded ?? "").trim();
  if (value === "") return null;
  if (!options.includes(value)) return null;
  return value !== "off";
}

/** The whole of a model entry's thinking state, as the controls read it. */
export interface ThinkingState {
  /** The wire variant: `"thinking"`, `""` for the non-thinking variant. */
  readonly variant?: string;
  /** The recorded depth, or `null` for an explicit "engine decides". */
  readonly thinkingEffort?: string | null;
}

/**
 * Is thinking ON, reading the field that actually carries the answer.
 *
 * The switch's state is the WIRE VARIANT, not the effort. A two-state model has
 * no depth to record, so an on/off commit writes `variant: "thinking"` or
 * `variant: ""` and deliberately leaves `thinking.effort` alone — reading the
 * effort here therefore read a field the toggle never writes, and the control
 * sat in `unstated` for the whole life of the session no matter how many times
 * it was pressed.
 *
 * A present variant is a STATEMENT, so it is never `null`: the runtime always
 * reports one for a selected model, falling back to the model's declared
 * default. Only a model that reports no variant at all falls through to the
 * effort, and that keeps the three-valued verdict intact — an absent record is
 * still the engine's choice rather than a confident "off".
 *
 * `options` narrows the effort fallback, so a cross-model leftover ("high" on a
 * switch) still reads as `null` instead of as "on".
 */
export function resolveThinkingVerdict(
  options: readonly string[],
  state: ThinkingState,
): boolean | null {
  if (state.variant !== undefined) return state.variant === "thinking";
  return isThinkingOn(options, state.thinkingEffort ?? undefined);
}

/**
 * The level word the model chip carries, for a DEPTH model. `""` for none.
 *
 * The chip names the level beside the model name, in the muted colour: "High" is
 * a POSITION on a scale, and an on/off colour cannot express one. Which is also
 * why this is empty for a binary model — there the brain's blue already answers
 * "on", and 「开启」 in the chip restated what the glyph beside it says, two
 * controls apart in the same toolbar.
 *
 * Empty for an absent record and for a record the model does not offer: a level
 * the target cannot honour is not a level to print.
 */
export function chipLevelLabel(
  options: readonly string[],
  recorded: string | undefined,
): string {
  if (thinkingControlShape(options) !== "radiogroup") return "";
  const value = (recorded ?? "").trim();
  if (value === "" || !options.includes(value)) return "";
  return value;
}

/** The accent token a brain should wear, given a three-valued verdict. */
export type BrainTone = "on" | "off" | "unstated";
/**
 * Map the verdict to a tone.
 *
 * A named mapping rather than a ternary at the call site, because the mistake
 * this guards against is collapsing `null` into `false`: that renders an
 * unstated state as a confidently-off one, which is the exact claim the
 * three-valued return exists to avoid.
 */
export function brainTone(thinkingOn: boolean | null): BrainTone {
  if (thinkingOn === null) return "unstated";
  return thinkingOn ? "on" : "off";
}

/**
 * What the brain says on hover: the ACTION a press performs.
 *
 * 「关闭思考」 / 「开启思考」, not a statement of what currently is. The state is
 * already carried twice over without the title — the glyph's colour
 * (`brainTone`) and `aria-pressed` — so 「已开启思考 · 点击关闭」 spent two
 * clauses restating a third time what the user could see, and the leading 「已」
 * made the title answer a question nobody asked. A toggle's tooltip earns its
 * place by saying what the click will do.
 *
 * The unstated case reads as 「开启思考」 for the same reason: the neutral colour
 * already declines to claim a state, and what the control offers is the press.
 * An unstated verdict is a state the toggle acts on, not a third position.
 *
 * One string per tone, and the tone is the whole input: the caller used to pass
 * the action separately, which said the same thing twice and could disagree with
 * the tone it was derived from. A depth model renders no brain at all — its
 * level is named on the model chip — so there is no level to append here.
 */
export function brainHoverLabel(tone: BrainTone): string {
  return tone === "on" ? "关闭思考" : "开启思考";
}

/**
 * The thinking options a model offers, in the order a control renders them.
 *
 * `effortOptions` is the runtime's explicit list when it fills one. Otherwise a
 * model that reports switchable thinking is treated as a binary off/on toggle,
 * so the picker surfaces the control without the runtime having to fill the
 * list. `default_value` counts as the runtime's own statement that a switch
 * exists, which keeps the brain icon from depending on the variant list
 * arriving intact.
 *
 * It lives here rather than beside the picker because two surfaces read it —
 * the cascade's fly-out and the composer's trigger — and because the option list
 * is what `variantForEffort` and `thinkingDraftPatch` are defined against.
 */
export function resolveEffortOptions(
  model: WebuiModelPickerEntry,
): readonly string[] {
  const explicit = model.effortOptions ?? [];
  if (explicit.length > 0) {
    return explicit.includes("default") ? explicit : ["default", ...explicit];
  }
  // The runtime reports switchable thinking via `thinkingConfig.mode` +
  // `supportedVariants`. Treat any model that supports both an empty and a
  // non-empty variant as a binary "off / on" toggle so the picker still
  // surfaces the control without the runtime having to fill `effortOptions`.
  if (model.thinkingConfig?.mode === "switchable") {
    const variants = model.supportedVariants ?? [];
    const hasOff = variants.includes("") || variants.includes("none-thinking");
    const hasOn = variants.some((variant) => variant && variant !== "none-thinking");
    // `default_value` is the runtime's own statement that this model has a
    // thinking switch, and it reaches the client on `thinkingConfig` even when
    // the variant list does not. Trusting it means the brain icon does not
    // depend on a second field arriving intact.
    const declaredSwitch = model.thinkingConfig?.default_value !== undefined;
    if ((hasOff && hasOn) || declaredSwitch) return ["off", "on"];
  }
  return [];
}

/** The wire variant an effort selection implies, when it implies one. */
export function variantForEffort(
  model: WebuiModelPickerEntry,
  effort: string,
): string | undefined {
  const options = resolveEffortOptions(model);
  if (options.length === 0) return undefined;
  const thinkingOn = options.includes("on");
  if (thinkingOn && (effort === "on" || effort === "off")) {
    return effort === "on" ? "thinking" : "";
  }
  // Multi-level efforts (low/high/max, …) are not part of the wire variant;
  // their value is carried by the thinking.effort selection instead.
  return undefined;
}

/**
 * What selecting one thinking option writes onto a model draft.
 *
 * Three shapes, and which one applies is a fact about the model contract rather
 * than about the control that reported it:
 *
 *   * `default` — the user asked for no override, so `thinkingEffort` is `null`
 *     and the engine picks. `null` is not "off"; the two are different claims
 *     and the composer's brain renders them in different colours.
 *   * `off` / `on` — a binary model carries this in the wire `variant`, which
 *     `variantForEffort` supplies, so the patch adds nothing.
 *   * anything else — a level (`low`, `high`, `max`), carried by
 *     `thinking.effort`.
 *
 * The cascade's fly-out and the composer's trigger each used to spell this out,
 * and the copies were the same three branches.
 */
export function thinkingDraftPatch(
  model: WebuiModelPickerEntry,
  option: string,
): Partial<Pick<WebuiModelPickerDraft, "variant" | "thinkingEffort">> {
  const variant = variantForEffort(model, option);
  return {
    ...(variant !== undefined ? { variant } : {}),
    ...(option === "default"
      ? { thinkingEffort: null }
      : option === "off" || option === "on"
        ? {}
        : { thinkingEffort: option }),
  };
}

