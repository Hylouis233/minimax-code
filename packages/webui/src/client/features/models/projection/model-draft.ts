// One model-draft selection workflow (T03's `model-picker-responsibility-cut`;
// plan §5 row for `components/models/ModelPicker.tsx`).
//
// Selecting a model and editing one of its settings used to be three handlers in
// the picker, each assembling the next draft and each making its own decision
// about committing and closing. They agreed by convention, which is how a
// "changed a setting" path and a "picked a model" path drift apart — one of them
// leaves the tick beside a model the user has just chosen. The decision is a
// catalogue fact, so it lives here once and the picker performs it.

import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
} from "../contracts/model-view.js";
import { thinkingDraftPatch } from "./thinking-control.js";

/**
 * What the user did to the row.
 *
 * A row click finishes a visit; a thinking level is a mid-visit edit that keeps
 * the panel open so a window can still be picked in the same visit; a context
 * window is the commitment that completes the selection.
 */
export type ModelDraftChange =
  | { readonly kind: "select" }
  | { readonly kind: "thinking"; readonly option: string }
  | { readonly kind: "context"; readonly value: number };

export interface ModelDraftResolution {
  /** The draft the row now carries. */
  readonly draft: WebuiModelPickerDraft;
  /**
   * Whether the change is also a settings write. A plain selection is not: the
   * row's settings were already committed when they were edited, and the local
   * draft is the mirror of that, not a second write.
   */
  readonly commitsSettings: boolean;
  /** Whether the change finishes the visit and the menu closes. */
  readonly closes: boolean;
}

/**
 * Resolves one change into the row's next draft, whether it writes settings, and
 * whether it closes the menu.
 *
 * A thinking option RESETS to the model's configured default, flips the wire
 * VARIANT, or records a depth level depending on its shape — that mapping is
 * `thinkingDraftPatch`'s, and the option is reported verbatim by the fly-out
 * rather than pre-mapped there.
 *
 * Both editing paths SELECT the model. The fly-out belongs to a row, so choosing
 * an option inside it is a statement about that row: a user who picks "1M" next
 * to M3 has chosen M3, and leaving the row unselected while closing the menu made
 * the action read as "changed a setting" and left the tick out of step. The row
 * click is the same two calls in a different order, so both routes to a finished
 * selection look alike.
 */
/**
 * Performs a resolution. The decision above is shared; this is what each surface
 * has to do with it, so the fly-out and the row click cannot perform it
 * differently.
 */
export function applyModelDraftResolution(
  resolution: ModelDraftResolution,
  actions: {
    readonly commitDraft: (draft: WebuiModelPickerDraft) => void;
    readonly commitSettings: (draft: WebuiModelPickerDraft) => void;
    readonly select: (draft: WebuiModelPickerDraft) => void;
    readonly close: () => void;
  },
): void {
  if (resolution.commitsSettings) {
    actions.commitDraft(resolution.draft);
    actions.commitSettings(resolution.draft);
  }
  actions.select(resolution.draft);
  if (resolution.closes) actions.close();
}

export function resolveModelDraftSelection(params: {
  readonly model: WebuiModelPickerEntry;
  readonly draft: WebuiModelPickerDraft;
  readonly change: ModelDraftChange;
}): ModelDraftResolution {
  const { model, draft, change } = params;
  switch (change.kind) {
    case "select":
      return { draft, commitsSettings: false, closes: true };
    case "thinking":
      return {
        draft: { ...draft, ...thinkingDraftPatch(model, change.option) },
        commitsSettings: true,
        closes: false,
      };
    case "context":
      return {
        draft: { ...draft, contextLimit: change.value },
        commitsSettings: true,
        closes: true,
      };
  }
}
