/**
 * The model picker's settings fly-out. ONE tier.
 *
 * Hovering a model row flies out a surface carrying the thinking control and
 * the context window's sizes, and the sizes are IN PLACE in that surface. The
 * earlier shape put them one tier deeper, behind a collapsed row that restated
 * the current value and carried a chevron — and that was one affordance too
 * many in each direction. The fly-out already says which model it describes, so
 * a row restating the current value, an arrow over it, and then a separate
 * panel carrying the same values are three ways to answer one question; and the
 * third of them was a floating panel landing back on top of the model list it
 * was describing, so choosing a window meant covering the rows to choose a
 * different model from.
 *
 * The list IS the answer: every size the model offers is readable as the
 * fly-out opens, the recorded one carries the ✓, and a previewed model carries
 * none — the record belongs to the ACTIVE model, so there is nothing to mark.
 *
 * Why a fly-out rather than the permanent right column this replaced: the
 * reference reserves no width for settings, and a column puts one model's
 * controls on screen permanently — next to a row the user could have simply
 * clicked. The old panel also rendered the same controls twice, once editable
 * in the column and once read-only in a panel-bottom area, and two renderings
 * of "which level is this model on" is a contradiction waiting to happen rather
 * than a second view.
 *
 * The surface, the motion and the dismissal belong to the shared dropdown
 * skeleton: the fly-out is a `WebuiDropdown` with no trigger — a row opens it by
 * hover, not by a click — so it hangs off the row in viewport coordinates, takes
 * the one surface every other popup in the client takes, and closes on Escape
 * through `onRetract`. What this file still owns is the placement rule and the
 * controls.
 *
 * The content is an `aria-live="polite"` region so a keyboard user hears the
 * controls appear. It is a region of its own rather than the popup root, because
 * the rows are ordered by `order` and that only means something to a flex
 * container for its OWN children — a wrapper with a box of its own would put the
 * context sizes back below the thinking control. When a model has nothing to
 * describe, the empty state prints the MODEL NAME before the sentence —
 * announcing the bare sentence would leave a screen-reader user asking which
 * model it was about.
 */
import type { ReactElement } from "react";

import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";
import {
  WebuiDropdown,
  type WebuiDropdownPlacement,
} from "../../../ui/Dropdown.js";
import {
  positionFlyout,
  type FlyoutRect,
} from "../../../projection/common/flyout-position.js";
import { resolveThinkingVerdict } from "../projection/thinking-control.public.js";
import type { WebuiModelPickerDraft, WebuiModelPickerEntry } from "../contracts/model-view.js";

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/**
 * Where the fly-out is anchored, resolved AT MEASURE TIME.
 *
 * A resolver, not a captured element. The row it points at is a React node the
 * list is free to replace on any commit — committing a setting re-derives the
 * catalogue, which remounts the row — and an element captured at render time
 * outlives the node it was captured from, so the next measure reads a detached
 * node's all-zero rect and places the panel against the viewport's origin.
 *
 * Asked from the shared skeleton's layout effect the same lookup answers
 * correctly, because by then the commit that remounted the row has attached its
 * ref. So the anchor is asked, not remembered.
 *
 * Asking is necessary and not sufficient. The row's ID is derived from the model
 * and the group rendering it, so a commit can rename the row outright — which
 * is what switching a two-state model's thinking off does to its own row — and
 * then there is no id to look up. `reconcileFocusedRow` in the picker's
 * interaction binding keeps that id pointing at a row that exists; this
 * contract only says that `undefined` here means "no row to measure", and the
 * panel is then not placed.
 */
export type FlyoutAnchor = () => FlyoutRect | undefined;

/**
 * Where the fly-out goes, unchanged: the shared `positionFlyout` engine's own
 * answer — right, then left, then below the row, aligned to its top, clamped
 * into the viewport.
 *
 * Stated as the skeleton's placement rule rather than computed in an effect here,
 * because the skeleton is what measures the surface. A measure of this
 * component's own would run against a popup the skeleton had not placed yet, and
 * the flip and the clamp are the two rules that are easy to get subtly wrong and
 * impossible to eyeball in a screenshot — so they stay in the one pure function,
 * with the measured `surface` handed to it.
 *
 * Module level, so its identity never changes: the skeleton re-asks it on every
 * scroll, resize and size change, and a fresh closure per render would hand it a
 * rule to re-read for nothing.
 */
const placeFlyout: WebuiDropdownPlacement = ({ anchor, surface, viewport }) => {
  const { left, top, side } = positionFlyout({ anchor, surface, viewport });
  // The side the fly-out opened on, in the shared layer's words, so the motion
  // slides the way it came: a panel that opened to the right of its row comes
  // from the right, not from above.
  return { left, top, side: side === "below" ? "bottom" : side };
};

export interface ModelSettingsFlyoutProps {
  readonly model: WebuiModelPickerEntry | undefined;
  /**
   * The thinking options, already resolved by the caller.
   *
   * Passed in rather than derived here on purpose: resolution is a fact about
   * the model CONTRACT (a `switchable` thinking config with both an empty and a
   * non-empty variant is a binary on/off, per `resolveEffortOptions` in
   * `ModelPicker.tsx`), and the fly-out is presentation. Re-deriving it here
   * would give the two places to disagree about when a model is binary.
   */
  readonly effortOptions: readonly string[];
  /** The context window's options, already resolved by the caller. */
  readonly contextOptions: readonly number[];
  readonly anchor: FlyoutAnchor | undefined;
  readonly draft: WebuiModelPickerDraft;
  /**
   * True while the described model is not the active one.
   *
   * Carried on the surface as state, NOT as a gate. Every control here is a way
   * of picking the row this panel describes, so disabling them until the row was
   * already picked made the panel read-only for exactly the case it was opened
   * for: the user hovering a model they had not yet chosen, to see what it
   * offers. They had to click the row first to unlock it, and then the fly-out
   * had saved them nothing over editing the panel's own column.
   */
  readonly preview: boolean;
  /**
   * Commit a thinking change, carrying the chosen option VERBATIM.
   *
   * "default", "on" and a depth level are three different shapes of commit —
   * one resets the effort to the model's configured default, one flips the
   * wire variant, one records a level — and which shape applies is a fact about
   * the model contract, not about how the control is drawn. So the fly-out
   * reports the option and `ModelPicker` does the mapping.
   *
   * Records and LEAVES the surface open: a level and a window are meant to be
   * adjusted in one visit, and closing here would make that impossible.
   */
  readonly onThinkingChange: (option: string) => void;
  /**
   * Commit a context window. Choosing a window is a COMMITMENT rather than a
   * mid-visit edit, so this is where the selection completes — the caller
   * closes the picker, unlike `onThinkingChange`.
   */
  readonly onContextChange: (value: number) => void;
  /** Escape from inside the fly-out: retract the tier, keep the list. */
  readonly onRetract: () => void;
}

export function ModelSettingsFlyout({
  model,
  effortOptions,
  contextOptions,
  anchor,
  draft,
  preview,
  onThinkingChange,
  onContextChange,
  onRetract,
}: ModelSettingsFlyoutProps): ReactElement | null {
  // No model to describe is no fly-out at all, so reaching this component at all
  // means it is open: there is no trigger to open it and nothing to close it
  // but `onRetract`, which the caller wires to the shared skeleton's dismissal.
  if (!model) return null;

  const isBinary =
    effortOptions.length === 2 &&
    effortOptions.includes("off") &&
    effortOptions.includes("on");

  // A two-state model's control is a switch, not a position on a scale: it turns
  // thinking on and off and has no level to sit at. Labelling it 「推理等级」
  // promises a scale the control cannot express, and it contradicted the
  // toolbar brain beside the send button, which was already calling the same
  // thing 思考. A depth model keeps the scale wording, because there the level
  // is real and the row lists one.
  const effortLabel = isBinary ? "思考" : "推理等级";

  // A recorded level the target model does not advertise highlights NOTHING.
  // Silently falling back to "default" would pretend the engine default is
  // picked, which is the same anti-stale rule the row badge applies.
  const recordedEffort = draft.thinkingEffort;
  const currentEffort = (() => {
    if (recordedEffort === undefined) return "default";
    if (recordedEffort === null) return "default";
    return effortOptions.includes(recordedEffort) ? recordedEffort : undefined;
  })();

  // One verdict, read from the field that carries it and shared with the
  // composer's brain trigger. This used to re-derive it locally from the
  // recorded effort alone, which never changes for a two-state model — the
  // switch commits a VARIANT — so this toggle sat off no matter what the
  // composer said. Two controls answering "is thinking on" from two different
  // fields is how the toolbar and the fly-out end up disagreeing.
  //
  // `null` is a stated choice ("engine decides"), so the draft's own value wins
  // over the model's whenever it is anything but `undefined`.
  const draftEffort =
    draft.thinkingEffort !== undefined
      ? draft.thinkingEffort
      : (model.thinking?.effort ?? null);
  const stateVariant = draft.variant !== undefined ? draft.variant : model.variant;
  const thinkingOn =
    resolveThinkingVerdict(effortOptions, {
      ...(stateVariant !== undefined ? { variant: stateVariant } : {}),
      thinkingEffort: draftEffort,
    }) === true;

  // The recorded window, and only when the model actually offers it. A recorded
  // value the target model does not advertise highlights NOTHING — silently
  // falling back to the first option would put a ✓ on a size the model does not
  // have, which is the same anti-stale rule the thinking row applies.
  const currentWindow = (() => {
    const recorded = draft.contextLimit ?? model.contextLimit;
    return typeof recorded === "number" && contextOptions.includes(recorded)
      ? recorded
      : undefined;
  })();

  return (
    <WebuiDropdown
      open
      // Nothing opens this popup — a row opens it by hover — and nothing but a
      // press outside or an Escape closes it, both of which mean the same thing
      // here: back to the list, keeping the position it was built up in.
      onOpen={() => undefined}
      onClose={onRetract}
      role="dialog"
      ariaLabel={`${model.displayName ?? model.modelId} 的设置`}
      className="webui-model-flyout"
      // The markers name the SURFACE, and the surface is the popup root: the
      // stylesheet's `[data-webui-model-preview]` rule and the browser cases
      // both find the fly-out by what it is, not by a wrapper inside it.
      popupDataAttributes={{
        "data-webui-model-flyout": "tier-one",
        "data-webui-model-preview": preview ? "true" : "false",
      }}
      // The row, asked when the skeleton measures: by then a commit that
      // remounted the row has attached its ref.
      anchorRect={() => anchor?.()}
      placement={placeFlyout}
    >
      {/*
        The live region is this element, not the popup root. `order` only
        reaches a flex container's own children, so the rows stay direct
        children of the column they are ordered in — the region and the layout
        are one element because they cannot be two.
      */}
      <div className="webui-model-flyout-content" aria-live="polite">
        {effortOptions.length > 0 ? (
          <div className="webui-model-detail-row webui-model-setting-effort">
            <span className="webui-model-detail-label">{effortLabel}</span>
            {isBinary ? (
              <ToggleSwitch
                checked={thinkingOn}
                label={effortLabel}
                data-webui-model-thinking-toggle="true"
                className="webui-model-thinking-toggle"
                onChange={() => onThinkingChange(thinkingOn ? "off" : "on")}
              />
            ) : (
              <div
                role="radiogroup"
                aria-label={effortLabel}
                className="webui-model-effort-group"
              >
                {effortOptions.map((option) => {
                  const active = currentEffort === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className="webui-model-effort-option"
                      onClick={() => onThinkingChange(option)}
                    >
                      {option}
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="webui-model-context-tick"
                        >
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
        {contextOptions.length > 0 ? (
          <div className="webui-model-detail-row webui-model-setting-context">
            <span className="webui-model-detail-label">上下文窗口</span>
            {/*
              The sizes, in place. NOT a collapsed row that opens a second
              fly-out: the surface already says which model it describes, so a
              row restating the current value, a chevron over it, and then a
              panel carrying the same sizes were three ways to answer one
              question — and the panel was a floating surface landing back over
              the model list it was describing.
            */}
            <div
              role="listbox"
              aria-label="上下文窗口"
              className="webui-model-context-group"
            >
              {contextOptions.map((value) => {
                const selected = currentWindow === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`webui-model-context-option ${selected ? "is-active" : ""}`}
                    data-webui-model-context-option={String(value)}
                    onClick={() => onContextChange(value)}
                  >
                    <span className="webui-model-context-value">
                      {formatContextWindow(value)}
                    </span>
                    {model.contextWindowOptionHints?.[String(value)] ===
                    "higher_usage" ? (
                      <span className="webui-model-context-hint">用量较高</span>
                    ) : null}
                    {selected ? (
                      <span
                        aria-hidden="true"
                        className="webui-model-context-tick"
                      >
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {effortOptions.length === 0 && contextOptions.length === 0 ? (
          <div className="webui-model-detail-empty">
            <div className="webui-model-detail-empty-title">
              {model.displayName ?? model.modelId}
            </div>
            <div className="webui-model-detail-empty-hint">
              这个模型没有可调设置。
            </div>
          </div>
        ) : null}
      </div>
    </WebuiDropdown>
  );
}
