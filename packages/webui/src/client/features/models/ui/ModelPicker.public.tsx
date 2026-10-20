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
 *
 * The menu itself is a `WebuiDropdown`: the shared skeleton owns its surface,
 * its motion, its placement above the trigger and its dismissal, so the panel
 * and every other popup in the client answer a press outside and an Escape the
 * same way. What stays here is the picker's own ladder — which of the two
 * Escape answers applies — and the trigger that opens it.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiIconChevronDown } from "../../../shell/icons.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
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
// `WebuiModelMenuList` is NOT republished here. It lives in `ModelMenu.tsx` and
// only the models business's own tests import it; forwarding it from a published
// surface would make this module the publisher of a symbol nothing outside the
// business needs, and a forwarding export is the escape the publication gate
// exists to close.

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
  const { open, tier } = interaction;
  const triggerId = useId();
  const searchId = useId();

  const { dom } = useWebuiBrowserCapabilities();

  /**
   * What this dismissal IS, and whether that Escape has already been answered.
   *
   * One Escape may walk back ONE tier. The menu and the fly-out are two
   * dropdowns, each with the shared skeleton's document listener, so the same
   * keydown reaches both of them and answering it twice would throw away the
   * list position the user built up — which is the part that took effort. So
   * the first dismissal claims the press and the second finds it claimed.
   *
   * The recorder below is what says a press is an Escape at all. It is not the
   * only path: React stops the event at the app root before it reaches the
   * document when the focus is on the trigger, so the trigger's own handler
   * below records the press by hand.
   */
  const escapeClaimedRef = useRef(false);
  const escapeSpentRef = useRef(false);

  const noteEscape = useCallback(() => {
    escapeClaimedRef.current = true;
    escapeSpentRef.current = false;
  }, []);

  useEffect(
    () =>
      dom.listenForKeyDown((event) => {
        if (event.key === "Escape") noteEscape();
      }),
    [dom, noteEscape],
  );

  /**
   * Claim the Escape this dismissal is answering, if it is one.
   *
   * `"press"` is a dismissal that is not the Escape — a pointer press outside,
   * which has its own answer per surface. `"spent"` is the same Escape seen by
   * the second popup, which has already been answered and must stay quiet.
   */
  const claimEscape = useCallback((): "press" | "escape" | "spent" => {
    if (!escapeClaimedRef.current) return "press";
    if (escapeSpentRef.current) return "spent";
    escapeSpentRef.current = true;
    return "escape";
  }, []);

  /**
   * The menu's dismissal: a press outside is the end of it, an Escape is one
   * step back up the ladder.
   *
   * Not memoised — the skeleton reads `onClose` through a ref, so a fresh
   * closure per render costs it nothing.
   */
  const handleMenuDismiss = () => {
    const answer = claimEscape();
    if (answer === "escape") interaction.onEscape();
    else if (answer === "press") interaction.close();
  };

  /**
   * The fly-out's dismissal, in either form, and both forms mean the same thing:
   * back to the list.
   *
   * An Escape here is already spent in almost every case — the menu's skeleton
   * listens to the same keydown and is registered first, so it walks the ladder
   * and this finds the press claimed. A press outside the fly-out but inside the
   * model list lands on the list's own answer, which is this one.
   */
  const handleFlyoutDismiss = () => {
    if (claimEscape() === "press") interaction.onEscape();
  };

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
    <div className="webui-model-selector" data-webui-model-selector="true">
      <WebuiDropdown
        open={open}
        onOpen={interaction.toggle}
        onClose={handleMenuDismiss}
        role="dialog"
        // The panel is named by the control that opens it, which is the same
        // one the skeleton's trigger props name — `id` below is this id, so
        // there is one id and not two that could disagree.
        labelledBy={triggerId}
        // Above the trigger, right-aligned to it, eight pixels of air: where
        // the panel has always opened. `flip` opens it downwards when there is
        // no room above, so a trigger near the top of the window still shows
        // its panel.
        side="top"
        align="end"
        offset={8}
        collision="flip"
        className="webui-model-menu webui-model-menu--cascade"
        popupDataAttributes={{
          "data-webui-model-menu": "true",
          "data-webui-model-tier": tier,
        }}
        trigger={(triggerProps) => {
          // The popup is measured against this button by default, and every
          // trigger prop is spread onto it: they are all DOM attributes, or
          // the ref the skeleton focuses when Escape closes the menu.
          const buttonProps = triggerProps;
          return (
            <button
              type="button"
              {...buttonProps}
              // The skeleton's trigger handler closes the popup on Escape and
              // stops the event on its way out. Here that would answer one press
              // with the whole menu, so the trigger answers it with the ladder
              // instead — the same answer the key gives inside the list — and
              // keeps the event to itself so the two document listeners do not
              // answer it a second time. The focus is already here, which is all
              // the skeleton's handler would have restored.
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                noteEscape();
                handleMenuDismiss();
              }}
              id={triggerId}
              className="webui-model-selector-trigger"
              aria-label="Model"
              disabled={models.length === 0}
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
          );
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
      </WebuiDropdown>
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
        onRetract={handleFlyoutDismiss}
      />
    </div>
  );
}
