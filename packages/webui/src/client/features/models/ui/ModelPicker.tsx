/**
 * Composer-side model picker, a two-column popover:
 *
 *   ┌─ models ──────────┬─ detail ──────────────────┐
 *   │ ● MiniMax-M3       │ 上下文窗口                 │
 *   │   MiniMax-M2.7-…   │ 512K                      │
 *   │   MiniMax-M2.7     │ 1M                    ✓   │
 *   │   OpenCode Go      ├─ 推理等级                 │
 *   │                    │ default                   │
 *   └────────────────────┴───────────────────────────┘
 *
 * Model choices and their settings share a compact vertical menu. Selecting a
 * model closes the menu; changing thinking or context immediately commits the
 * focused model's draft through the same `selectModel` operation.
 *
 * The model column is grouped by provider: each group renders a plain provider
 * name above its rows — no nested menu, no second level. Grouping follows the
 * catalog's own order, so the first provider listed stays on top.
 *
 * Drafts live in a `useState` map keyed by `providerId/modelId/variant` so a
 * setting remains responsive while the runtime refreshes its model catalog.
 * The runtime projection is the source of truth after the menu is reopened.
 */
import { useEffect, useId, useMemo, useState, type ReactElement } from "react";

import { WebuiIconChevronDown } from "../../../shell/icons.js";
import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
  WebuiModelProviderGroup,
} from "../contracts/model-view.js";
import {
  applyModelDraftResolution,
  resolveModelDraftSelection,
} from "../projection/model-draft.js";
import {
  modelKey,
  projectModelPickerSections,
} from "../projection/model-picker-rows.js";
import { useModelPickerInteraction } from "../bindings/use-model-picker-interaction.js";
import { isSearchEmpty } from "../projection/model-picker-search.js";
import { toggleFavoriteId } from "../projection/model-favorites.js";
import { WebuiModelMenuCluster } from "./ModelMenu.js";
import { WebuiModelDraftEditor } from "./ModelDraftEditor.js";
export { WebuiModelMenuList } from "./ModelMenu.js";

// Re-export so existing importers keep their import path stable.
export type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
  WebuiModelProviderGroup,
};

export interface ModelPickerProps {
  readonly models: readonly WebuiModelPickerEntry[];
  readonly selected: WebuiModelPickerEntry | undefined;
  readonly onSelect: (
    model: WebuiModelPickerEntry,
    draft: WebuiModelPickerDraft,
  ) => void;
  readonly onSettingChange: (
    model: WebuiModelPickerEntry,
    draft: WebuiModelPickerDraft,
  ) => void;
  readonly triggerLabel?: string;
  /**
   * The thinking level the chip names beside the model, or `undefined`.
   *
   * Passed in rather than derived here because "which shape is this model's
   * thinking" is a fact about the model CONTRACT, and it is already resolved
   * once for the composer's brain trigger — deriving it a second time here
   * would give two places to disagree about whether this model has a depth
   * scale, and the disagreement would show as a chip claiming a level the
   * brain beside it says nothing about.
   */
  readonly triggerLevel?: string;
  readonly favorites: {
    readonly read: () => string[];
    readonly write: (ids: readonly string[]) => void;
  };
}

export function WebuiModelPicker({
  models,
  selected,
  onSelect,
  onSettingChange,
  triggerLabel,
  triggerLevel,
  favorites,
}: ModelPickerProps): ReactElement {
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<readonly string[]>([]);
  const [drafts, setDrafts] = useState<
    Readonly<Record<string, WebuiModelPickerDraft>>
  >({});

  const groupedModels = useMemo(
    () =>
      projectModelPickerSections({
        models,
        query,
        favoriteIds,
        favoritesLabel: "收藏",
      }),
    [models, query, favoriteIds],
  );
  const interaction = useModelPickerInteraction({
    models,
    groups: groupedModels,
    selected,
  });
  const { focusedModel, focusedKey } = interaction;
  const focusedDraft = focusedModel ? (drafts[focusedKey] ?? {}) : {};
  const { open, tier, rootRef } = interaction;
  const triggerId = useId();
  const menuId = useId();
  const searchId = useId();

  useEffect(() => {
    if (open) return;
    setDrafts({});
  }, [open]);
  useEffect(() => {
    if (open) return;
    setQuery("");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setFavoriteIds(favorites.read());
  }, [favorites, open]);

  const handleToggleFavorite = (key: string) => {
    setFavoriteIds((current) => {
      const next = toggleFavoriteId(current, key);
      favorites.write(next);
      return next;
    });
  };
  const handleCommitDraft = (draft: WebuiModelPickerDraft) => {
    setDrafts((current) => ({ ...current, [focusedKey]: draft }));
  };
  const handleSelectModel = (model: WebuiModelPickerEntry) => {
    applyModelDraftResolution(
      resolveModelDraftSelection({
        model,
        draft: drafts[modelKey(model)] ?? {},
        change: { kind: "select" },
      }),
      {
        commitDraft: handleCommitDraft,
        commitSettings: (next) => onSettingChange(model, next),
        select: (next) => onSelect(model, next),
        close: interaction.close,
      },
    );
  };
  const favoriteKeys = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const searchIsEmpty = isSearchEmpty(groupedModels, query, models.length);

  const triggerText =
    selected?.displayName ??
    (selected ? `${selected.providerId}/${selected.modelId}` : undefined) ??
    triggerLabel ??
    "Model";

  return (
    <div
      ref={rootRef}
      className="webui-model-selector"
      data-webui-model-selector="true"
    >
      <button
        type="button"
        id={triggerId}
        className="webui-model-selector-trigger"
        aria-label="Model"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={models.length === 0}
        onClick={interaction.toggle}
      >
        <span className="flex min-w-0 items-baseline gap-[6px]">
          <span className="min-w-0 truncate whitespace-nowrap">
            {triggerText}
          </span>
          {/*
            The level, named where the model is named. A depth scale has a
            POSITION to state and the brain's on/off colour cannot state one, so
            the word rides the model name in the muted colour instead of a
            second copy of it sitting two controls away. The name truncates and
            this does not: a long provider-prefixed name losing its tail is
            fine, a level word half-clipped is not.
          */}
          {triggerLevel ? (
            <span
              className="shrink-0 text-icon_default_tertiary"
              data-webui-model-chip-level="true"
            >
              {triggerLevel}
            </span>
          ) : null}
        </span>
        <WebuiIconChevronDown className="flex-shrink-0 text-icon_default_tertiary" />
      </button>
      {open ? (
        <div
          role="dialog"
          id={menuId}
          aria-labelledby={triggerId}
          data-webui-model-menu="true"
          data-webui-model-tier={tier}
          className="webui-model-menu webui-model-menu--cascade"
          onKeyDown={(event) => {
            // The fly-out stops propagation on its own Escape, so reaching here
            // means focus is on the list: one more press closes the menu.
            if (event.key === "Escape") interaction.onEscape();
          }}
        >
          <WebuiModelMenuCluster
            query={query}
            searchId={searchId}
            searchIsEmpty={searchIsEmpty}
            onQueryChange={(value) => {
              interaction.retract();
              setQuery(value);
            }}
            onSearchFocus={interaction.retract}
            onMoveRow={interaction.onMoveRow}
            groups={groupedModels}
            selected={selected}
            focusedRowId={interaction.focused?.rowId}
            favoriteKeys={favoriteKeys}
            onFocus={interaction.onRowFocus}
            onHoverIntent={interaction.onHoverIntent}
            onHoverLeave={interaction.onHoverLeave}
            onSelect={handleSelectModel}
            onToggleFavorite={handleToggleFavorite}
            onRowMount={interaction.onRowMount}
          />
        </div>
      ) : null}
      <WebuiModelDraftEditor
        open={open}
        tier={tier}
        model={focusedModel}
        draft={focusedDraft}
        anchor={interaction.flyoutAnchor}
        preview={interaction.isPreviewing}
        onCommitDraft={handleCommitDraft}
        onSettingChange={onSettingChange}
        onSelect={onSelect}
        onCloseMenu={interaction.close}
        onRetract={interaction.onEscape}
      />
    </div>
  );
}
