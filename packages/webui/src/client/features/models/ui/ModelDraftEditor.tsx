import type { ReactElement } from "react";

import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
} from "../contracts/model-view.js";
import {
  applyModelDraftResolution,
  resolveModelDraftSelection,
  type ModelDraftChange,
} from "../projection/model-draft.js";
import { resolveEffortOptions } from "../projection/thinking-control.public.js";
import type { CascadeTier } from "../projection/model-picker-cascade.js";
import {
  ModelSettingsFlyout,
  type ModelSettingsFlyoutProps,
} from "./ModelSettingsFlyout.js";

type WebuiModelDraftEditorProps = Pick<
  ModelSettingsFlyoutProps,
  "anchor" | "preview" | "onRetract"
> & {
  readonly open: boolean;
  readonly tier: CascadeTier;
  readonly model: WebuiModelPickerEntry | undefined;
  readonly draft: WebuiModelPickerDraft;
  /** Write the draft back where the drafts map lives — the picker's state, not this file's. */
  readonly onCommitDraft: (draft: WebuiModelPickerDraft) => void;
  readonly onSettingChange: (
    model: WebuiModelPickerEntry,
    draft: WebuiModelPickerDraft,
  ) => void;
  readonly onSelect: (
    model: WebuiModelPickerEntry,
    draft: WebuiModelPickerDraft,
  ) => void;
  /** A window choice completes the selection, so the menu closes behind it. */
  readonly onCloseMenu: () => void;
};

export function WebuiModelDraftEditor({
  open,
  tier,
  model,
  draft,
  anchor,
  preview,
  onCommitDraft,
  onSettingChange,
  onSelect,
  onCloseMenu,
  onRetract,
}: WebuiModelDraftEditorProps): ReactElement | null {
  const effortOptions = model ? resolveEffortOptions(model) : [];
  const contextOptions = model?.contextWindowOptions ?? [];

  /**
   * Commit a thinking option, in whichever shape that option implies.
   *
   * "default" RESETS the effort to the model's configured default (null, not
   * the empty string — the wire distinguishes them), "on"/"off" flip the wire
   * VARIANT rather than recording a level, and a depth level records itself.
   * Splitting these three is the reason the option is reported verbatim by the
   * fly-out instead of being pre-mapped there.
   *
   * It SELECTS the model. Same reasoning as `handleContextChange`: the fly-out
   * belongs to a row, so choosing a level inside it is a statement about that
   * row. Unlike a window, though, a level is a mid-visit edit — the user may
   * still want a window next, and this panel is flat precisely so both fit in
   * one visit — so the menu stays open and the row carries the tick.
   */
  /**
   * The one place a change to this row becomes a selection. The decision is
   * `resolveModelDraftSelection`'s; this performs it with the fly-out's own
   * surfaces, so a level, a window and a row click cannot drift apart.
   */
  const commitChange = (change: ModelDraftChange) => {
    if (!model) return;
    applyModelDraftResolution(
      resolveModelDraftSelection({ model, draft, change }),
      {
        commitDraft: onCommitDraft,
        commitSettings: (next) => onSettingChange(model, next),
        select: (next) => onSelect(model, next),
        close: onCloseMenu,
      },
    );
  };

  const handleThinkingChange = (option: string) => {
    if (!model) return;
    commitChange({ kind: "thinking", option });
  };

  /**
   * Commit a context window. This CLOSES: picking a window is the commitment
   * that completes the selection, where a level is a mid-visit edit.
   *
   * It also SELECTS the model. The fly-out belongs to a row, and choosing an
   * option inside it is a statement about that row — a user who picks "1M" next
   * to M3 has chosen M3, and leaving the row unselected while closing the menu
   * made the action read as "changed a setting" and left the tick beside a
   * model they had just picked out of step. The row click is the same two calls
   * in a different order, so both routes to a finished selection look alike.
   */
  const handleContextChange = (value: number) => {
    if (!model) return;
    commitChange({ kind: "context", value });
  };
  if (!open || tier !== "settings") return null;
  return (
    <ModelSettingsFlyout
      model={model}
      effortOptions={effortOptions}
      contextOptions={contextOptions}
      anchor={anchor}
      draft={draft}
      preview={preview}
      onThinkingChange={handleThinkingChange}
      onContextChange={handleContextChange}
      onRetract={onRetract}
    />
  );
}
