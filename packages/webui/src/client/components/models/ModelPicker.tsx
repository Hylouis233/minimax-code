/**
 * Composer-side model picker. Mirrors the desktop's two-column popover:
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
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { WebuiIconChevronDown } from "../shell/icons.js";
import { ToggleSwitch } from "../shared/ToggleSwitch.js";
import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
  WebuiModelProviderGroup,
} from "../../contracts/models/model-view.js";
import { evaluateOutsideClose } from "../../projection/common/outside-close.js";
import { resolveEffortOptions } from "../../projection/models/thinking-control.js";
import {
  applyModelDraftResolution,
  resolveModelDraftSelection,
  type ModelDraftChange,
} from "../../projection/models/model-draft.js";
import {
  modelKey,
  projectModelPickerSections,
  reconcileFocusedRow,
  rowIdOf,
  type FocusedRow,
} from "../../projection/models/model-picker-rows.js";
import { useWebuiBrowserCapabilities } from "../../bindings/browser-capabilities.js";
import { isSearchEmpty } from "../../projection/models/model-picker-search.js";
import { toggleFavoriteId } from "../../projection/models/model-favorites.js";
import {
  isPreview,
  rowHasFlyout,
  type CascadeTier,
} from "../../projection/models/model-picker-cascade.js";
import {
  MODEL_FLYOUT_HOVER_DELAY_MS,
  hoverArrival,
} from "../../projection/models/model-picker-hover.js";
import {
  ModelSettingsFlyout,
  type ModelSettingsFlyoutProps,
  type FlyoutAnchor,
} from "./ModelSettingsFlyout.js";
import type { FlyoutRect } from "../../projection/common/flyout-position.js";

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


/**
 * The model column. A group header is a line of text, not an option: it lives
 * inside a `role="group"`, which carries the name through `aria-label`, so the
 * visible text is hidden from assistive technology.
 *
 * The star is a SIBLING of the option button, never a child. A button inside
 * the option button would be invalid nesting, would make the option's own
 * click handler fire when the star was pressed, and would leave a keyboard
 * user unable to reach the star at all. The row is therefore a wrapper that
 * owns the layout, and the option keeps the width it had before.
 */
export function WebuiModelMenuList({
  groups,
  selected,
  focusedRowId,
  favoriteKeys,
  onFocus,
  onHoverIntent,
  onHoverLeave,
  onSelect,
  onToggleFavorite,
  onRowMount,
}: {
  readonly groups: readonly WebuiModelProviderGroup[];
  readonly selected: WebuiModelPickerEntry | undefined;
  /**
   * The row the pointer or the keyboard is on, as a ROW id.
   *
   * Not a model key, and that is the whole point: a starred model is rendered
   * twice, so two rows can carry the same key. Highlighting both copies because
   * the pointer is on one of them is a claim the list cannot support — the user
   * is looking at one line, and the other line is somewhere else on screen.
   */
  readonly focusedRowId: string | undefined;
  readonly favoriteKeys: ReadonlySet<string>;
  readonly onFocus: (key: string, rowId: string) => void;
  /**
   * The pointer ARRIVED on this row. Opens the fly-out if the pointer rests.
   *
   * Separate from `onFocus` on purpose, and the split is the whole point:
   * `onFocus` is the row's highlight, which is the list answering "where is
   * the pointer" and has to be instant, while this is the list CLAIMING
   * something about the row. A claim that fires on contact makes sweeping the
   * pointer down a list throw a panel after every row it crosses.
   *
   * Optional so a caller that renders rows without a cascade (the search tests
   * do) does not have to pass a no-op.
   */
  readonly onHoverIntent?: (key: string, rowId: string) => void;
  /**
   * The pointer LEFT this row. Cancels a pending open and nothing else: the
   * panel is itself a hover region, and the pointer is usually on its way into
   * it, so an open panel is left standing.
   */
  readonly onHoverLeave?: (rowId: string) => void;
  readonly onSelect: (model: WebuiModelPickerEntry) => void;
  readonly onToggleFavorite: (key: string) => void;
  /**
   * Report each row's element so the caller can anchor the fly-out to it.
   *
   * A callback ref rather than a prop-drilled map: the rows mount and unmount
   * as the list filters, and an element the caller cannot measure is a fly-out
   * with nothing to point at.
   */
  readonly onRowMount?: (rowId: string, element: HTMLElement | null) => void;
}): ReactElement {
  return (
    <div role="listbox" aria-label="Model" className="webui-model-menu-list">
      {groups.map((group) => (
        <div
          key={group.id}
          role="group"
          aria-label={group.label}
          className="webui-model-menu-group"
        >
          <div className="webui-model-group-header" aria-hidden="true">
            {group.label}
          </div>
          {group.models.map((model) => {
            const key = modelKey(model);
            // The row's own identity, which is NOT the model's: a starred model
            // is rendered in two groups, and every per-ROW thing — the
            // highlight, the fly-out's anchor, the arrow keys' position — has to
            // tell those two apart or it will point at whichever mounted last.
            const rowId = rowIdOf(group.id, key);
            const isSelected = selected ? modelKey(selected) === key : false;
            const isFocused = focusedRowId === rowId;
            const isFavorite = favoriteKeys.has(key);
            const name =
              model.displayName ??
              `${model.providerId}/${model.modelId}`;
            // The provider this row was repeated FROM, on the one section that
            // repeats rows. Everywhere else the group header above already
            // says it, and saying it twice would be noise.
            const origin = group.modelOriginLabels?.[key];
            return (
              <div
                key={rowId}
                className="webui-model-option-row"
                ref={(element) => onRowMount?.(rowId, element)}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-focused={isFocused ? "true" : "false"}
                  className="webui-model-option"
                  onMouseEnter={() => {
                    onHoverIntent?.(key, rowId);
                    onFocus(key, rowId);
                  }}
                  onMouseLeave={() => onHoverLeave?.(rowId)}
                  onFocus={() => onFocus(key, rowId)}
                  onClick={() => onSelect(model)}
                >
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{name}</span>
                    {origin ? (
                      <span
                        className="webui-model-option-origin"
                        data-webui-model-origin={origin}
                      >
                        {origin}
                      </span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <span
                      aria-hidden="true"
                      className="webui-model-option-tick"
                    >
                      ✓
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-pressed={isFavorite}
                  aria-label={`${isFavorite ? "取消收藏" : "收藏"} ${name}`}
                  title={isFavorite ? "取消收藏" : "收藏"}
                  className="webui-model-option-star"
                  data-webui-model-star="true"
                  onClick={() => onToggleFavorite(key)}
                >
                  <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type WebuiModelMenuClusterProps = Pick<
  Parameters<typeof WebuiModelMenuList>[0],
  | "groups"
  | "selected"
  | "focusedRowId"
  | "favoriteKeys"
  | "onFocus"
  | "onHoverIntent"
  | "onHoverLeave"
  | "onSelect"
  | "onToggleFavorite"
  | "onRowMount"
> & {
  readonly query: string;
  readonly searchId: string;
  readonly searchIsEmpty: boolean;
  /** A keystroke re-filters the list and retracts a pending fly-out: one act, so one callback. */
  readonly onQueryChange: (value: string) => void;
  /** Focusing the field is the user asking a different question; the fly-out answered the last one. */
  readonly onSearchFocus: () => void;
  /** Arrows move the focused row while the field holds focus. */
  readonly onMoveRow: (delta: number) => void;
};

type WebuiModelDraftEditorProps = Pick<ModelSettingsFlyoutProps, "anchor" | "preview" | "onRetract"> & {
  readonly open: boolean;
  readonly tier: CascadeTier;
  readonly model: WebuiModelPickerEntry | undefined;
  readonly draft: WebuiModelPickerDraft;
  /** Write the draft back where the drafts map lives — the picker's state, not this file's. */
  readonly onCommitDraft: (draft: WebuiModelPickerDraft) => void;
  readonly onSettingChange: ModelPickerProps["onSettingChange"];
  readonly onSelect: ModelPickerProps["onSelect"];
  /** A window choice completes the selection, so the menu closes behind it. */
  readonly onCloseMenu: () => void;
};

/**
 * The menu's cluster: the search field and the list it filters, with the keyboard the field owns.
 *
 * One declaration because "how does typing in the picker's search box behave" is one behaviour, and
 * it used to be spread across the field's three handlers plus the list call beside them: the input
 * that re-filters, the focus that retracts a fly-out, and the arrows that move the focused row
 * without the field ever holding focus.
 *
 * A controlled region — the query, the focused row and the catalogue are the picker's, and the
 * cluster owns nothing but the markup and the wiring it is handed.
 */
function WebuiModelMenuCluster({
  query,
  searchId,
  searchIsEmpty,
  onQueryChange,
  onSearchFocus,
  onMoveRow,
  groups,
  selected,
  focusedRowId,
  favoriteKeys,
  onFocus,
  onHoverIntent,
  onHoverLeave,
  onSelect,
  onToggleFavorite,
  onRowMount,
}: WebuiModelMenuClusterProps): ReactElement {
  return (
    <div className="webui-model-menu-column">
      <div className="webui-model-menu-search">
        <label className="webui-model-search-field" htmlFor={searchId}>
          <span className="sr-only">搜索模型</span>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="搜索模型…"
            aria-label="搜索模型"
            className="webui-model-search-input"
            data-webui-model-search="true"
            onChange={(event) => {
              // A keystroke re-filters the list, and the row the open
              // panel was anchored to may be one of the rows that just
              // went. Its element unmounts, the anchor stops resolving,
              // and the panel is left describing a model the user can no
              // longer see. The search box taking the interaction is the
              // same act either way: nothing here is a row the pointer
              // is on.
              onQueryChange(event.currentTarget.value);
            }}
            onFocus={onSearchFocus}
            onKeyDown={(event) => {
              // The menu opens WITHOUT focus, so the search field is
              // reachable by Tab rather than by autofocus — and autofocus
              // is what it used to do. Focusing the field on open is wrong
              // for a menu whose first job is picking from a short list:
              // it drops a caret and a blinking cursor into a text box
              // nobody asked to type in, and typing then filters the list
              // by accident.
              //
              // "No autofocus" must not mean "no keyboard", so the arrows
              // that used to work by virtue of the field holding focus now
              // work here explicitly. Caret movement inside the field is
              // left alone: this is a single-line search box, and stealing
              // Left/Right would break editing a query.
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              onMoveRow(event.key === "ArrowDown" ? 1 : -1);
            }}
          />
        </label>
      </div>
      {searchIsEmpty ? (
        <div className="webui-model-search-empty">没有匹配的模型</div>
      ) : (
        <WebuiModelMenuList
          groups={groups}
          selected={selected}
          focusedRowId={focusedRowId}
          favoriteKeys={favoriteKeys}
          onFocus={onFocus}
          onHoverIntent={onHoverIntent}
          onHoverLeave={onHoverLeave}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          onRowMount={onRowMount}
        />
      )}
    </div>
  );
}

/**
 * The drafts editor: one model's draft and the two controls that write it.
 *
 * The `drafts` map decides what a model's selection *means*, so "add a per-model draft field" is a
 * change to one declaration — the draft's shape, the options it offers and the two writes — instead
 * of a read of the whole picker. It owns no state: the draft and the map it is committed into are
 * the picker's, which is what keeps a menu close from losing an edit in flight.
 */
function WebuiModelDraftEditor({
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

export function WebuiModelPicker({
  models,
  selected,
  onSelect,
  onSettingChange,
  triggerLabel,
  triggerLevel,
  favorites,
}: ModelPickerProps): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const [open, setOpen] = useState(false);
  /**
   * The row the pointer or the keyboard pointed at, and the model that row
   * described AT THE TIME.
   *
   * One state holding both, because the two have to agree: a row id with no
   * model cannot anchor a panel, and a model with no row cannot say WHICH line
   * on screen the panel belongs to. Two separate states would be two chances to
   * disagree, and the disagreement is invisible until the panel opens beside the
   * wrong line.
   *
   * What is stored is the user's ANSWER; which line that answer points at today
   * is `focused` below, re-derived from it. A row id is built out of the model
   * and its group, and committing a setting re-derives both — so the stored id
   * is a record of where the pointer was, not a promise that the line is still
   * there. Holding the promise instead is what let the fly-out's own thinking
   * switch rename the row it was anchored to.
   */
  const [focusedRow, setFocusedRow] = useState<FocusedRow | undefined>(undefined);
  const [tier, setTier] = useState<CascadeTier>("list");
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<readonly string[]>([]);
  const [drafts, setDrafts] = useState<
    Readonly<Record<string, WebuiModelPickerDraft>>
  >({});

  // Grouping, the search narrowing and the shortlist hoist are one projection
  // rule (`projectModelPickerSections`), including why the order is
  // filter-then-hoist.
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

  /**
   * Where the pointer's answer points NOW, which is not always where it pointed
   * when it was given.
   *
   * Memoised on the rows rather than recomputed inline: `reconcileFocusedRow`
   * hands back the very object it was given whenever the row survived, so an
   * unchanged menu keeps a stable `focused` and the fly-out's anchor resolver
   * and its scroll listeners are not rebuilt on every render. Deriving it during
   * render rather than in an effect is also what keeps the correction invisible
   * — the fly-out measures in a layout effect, which runs after this and before
   * anything is painted, so a re-pointed row is already anchored by the time the
   * panel is on screen.
   */
  const focused = useMemo(
    () => reconcileFocusedRow(focusedRow, groupedModels),
    [focusedRow, groupedModels],
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  /**
   * Every mounted row, so the fly-out can measure the one it is anchored to.
   *
   * A ref map rather than React state: the fly-out re-measures on scroll, and
   * a scroll must not re-render the whole list just to update a rectangle.
   */
  const rowElements = useRef(new Map<string, HTMLElement>());
  /**
   * The pending fly-out, if the pointer is resting on a row.
   *
   * Held in a ref rather than state because it is not something to render: it
   * exists only so that leaving the row, taking the interaction elsewhere, or
   * closing the menu can call it off before it pays out. A `setTimeout` id in
   * state would re-render the whole list every time the pointer moved.
   */
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The catalogue a timer callback resolves its row against.
   *
   * The callback closes over the render that created it, so a plain `models`
   * lookup would resolve the row against whatever the catalogue was when the
   * pointer ARRIVED — up to `MODEL_FLYOUT_HOVER_DELAY_MS` stale, and the
   * runtime refreshes that catalogue underneath an open menu on its own.
   */
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const triggerId = useId();
  const menuId = useId();
  const searchId = useId();

  /**
   * Call off a hover that has not been paid for yet.
   *
   * Every path that takes the interaction away from the rows — leaving a row,
   * the search box taking focus, a keystroke re-filtering the list, Escape, the
   * menu closing — routes through here, so a panel cannot open for a pointer
   * that is no longer on the row that asked for it.
   */
  const clearPendingHover = () => {
    if (hoverTimer.current === null) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  /**
   * Put the fly-out away, and forget which row it was describing.
   *
   * Used when the interaction moves somewhere that is not a row. The row is
   * forgotten along with the panel because a remembered row with no panel is
   * what makes the NEXT panel describe a model the user has not gone back to.
   */
  const retractFlyout = () => {
    clearPendingHover();
    setTier("list");
    setFocusedRow(undefined);
  };

  // Keep the local mirror through model-catalog refreshes while the menu is
  // open; each setting change is also committed immediately to the runtime.
  // Drop the mirror on close so reopening always starts from persisted state.
  useEffect(() => {
    if (open) return;
    setDrafts({});
  }, [open]);

  // The query does not survive a close. A picker that reopens still filtered
  // to three rows from a search the user has forgotten they typed reads as a
  // catalogue that lost models, which is a scarier bug than the one the reset
  // avoids.
  useEffect(() => {
    if (open) return;
    setQuery("");
  }, [open]);

  // Reopening starts at the list tier. A picker that reopens one tier deep into
  // a fly-out for a row the user has not re-hovered would be showing controls
  // with no row to explain them.
  useEffect(() => {
    if (open) return;
    retractFlyout();
  }, [open]);

  // A hover still waiting out its delay when the menu goes away must not open a
  // panel on a picker that is no longer showing. Separate from the effect above
  // because that one is about the tier a REOPEN starts at.
  useEffect(() => clearPendingHover, []);

  // Read the stars when the menu OPENS rather than on mount: the store is the
  // only writer, and re-reading on open is what makes a star applied in
  // another tab of the same picker show up. Reading during the first render
  // would also mean a server render and a client render disagreed.
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

  // Close on outside pointerdown.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: PointerEvent) => {
      if (!rootRef.current) return;
      const insideContainer = rootRef.current.contains(event.target as Node);
      // The four-surface outside-close policy lives in
      // `projection/common/outside-close.ts`; ModelPicker's per-surface variant
      // subscribes to `pointerdown` only (no keydown listener). Routing
      // through `evaluateOutsideClose` keeps the four call sites
      // consistent without changing the original close semantics.
      if (
        evaluateOutsideClose({
          surface: "modelPicker",
          kind: "pointerdown",
          insideContainer,
        }) === "close"
      ) {
        setOpen(false);
      }
    };
    return dom.listenForPointerDown(handler);
  }, [dom, open]);

  const focusedModel = useMemo<WebuiModelPickerEntry | undefined>(() => {
    const key = focused?.key ?? (selected ? modelKey(selected) : undefined);
    if (!key) return undefined;
    return models.find((model) => modelKey(model) === key) ?? selected;
  }, [focused, models, selected]);

  const focusedKeyString = focusedModel ? modelKey(focusedModel) : "";
  const focusedDraft: WebuiModelPickerDraft =
    focusedModel ? (drafts[focusedKeyString] ?? {}) : {};

  /**
   * A click means "this is the one", and it finishes. The settings are a hover
   * away — hovering the row is a second away from here, and the row the pointer
   * is on is the one being clicked — so there is nothing left to visit, and
   * keeping the menu open would strand the user on a surface they have already
   * answered.
   *
   * A plain selection writes no settings: the row's settings were committed when
   * they were edited and the local draft mirrors that, so re-committing here
   * would be a second write of the same thing.
   */
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
        close: handleCloseFlyout,
      },
    );
  };

  /**
   * Open the fly-out for whichever row the pointer is on.
   *
   * Only for a row that HAS something to configure. Hovering a model with
   * nothing to configure must not summon an empty panel — a fly-out with no
   * controls in it is a worse answer than no fly-out, and there is nothing to
   * learn from it. `rowHasFlyout` is the "does this model have settings" test,
   * kept separate from `rowClickOutcome` because a click no longer varies by
   * model while the fly-out still does.
   *
   * Also the landing place for the keyboard, which reaches here directly and so
   * opens the panel without waiting out a hover delay: arrowing into a row is a
   * decision, not a pass over it.
   */
  const handleHoverRow = (key: string, rowId: string) => {
    // Whatever hover was pending is this one now, whether it came from the
    // pointer's delay or from the keyboard.
    clearPendingHover();
    const model = modelsRef.current.find((entry) => modelKey(entry) === key);
    if (!model) return;
    setFocusedRow({ key, rowId });
    // A row with nothing to configure retracts the fly-out rather than
    // leaving the previous row's panel up: the panel would then describe a
    // model the pointer has already left.
    setTier(rowHasFlyout(model) ? "settings" : "list");
  };

  /**
   * The row's highlight moved: this one, and only this.
   *
   * No panel, and no cancelling of a pending one. The list calls this from the
   * SAME mouseenter that queued the hover, so cancelling here would call off
   * the panel the pointer had just asked for, a few lines after asking for it.
   * It is also right on its own terms: Tab moves the highlight without moving
   * the pointer, and a pointer still resting on a row is still resting on it.
   *
   * The difference from arrowing is the point. Tab is a sweep through the
   * controls on the way to somewhere else, so a surface that unfolds on every
   * tab stop makes the list unusable by keyboard; arrowing is a decision to
   * look at this row, and that is what earns the panel. The pointer reaches the
   * panel through `handleHoverIntent`.
   */
  const handleRowFocus = (key: string, rowId: string) => {
    setFocusedRow({ key, rowId });
  };

  /**
   * The pointer arrived on a row. Open its panel only if the pointer rests.
   *
   * The rules are in `hoverArrival`; the two things worth reading here are why
   * the retract happens NOW rather than after the delay, and why the highlight
   * is not part of this. The retract is immediate because the highlight moves
   * on this very mouse event (the list calls `onFocus` alongside this), so a
   * panel left standing would re-anchor itself to the row the pointer has only
   * just passed over — the old model's settings, sliding onto a new model,
   * before the user has read either.
   */
  const handleHoverIntent = (key: string, rowId: string) => {
    const model = modelsRef.current.find((entry) => modelKey(entry) === key);
    const arrival = hoverArrival({
      rowId,
      focusedRowId: focused?.rowId,
      tier,
      hasFlyout: rowHasFlyout(model),
    });
    // The panel already describes this row — the pointer has just crossed back
    // out of it. Retracting here closes the panel under the pointer.
    if (arrival === "keep-open") return;
    clearPendingHover();
    setTier("list");
    if (arrival === "retract-only") return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      handleHoverRow(key, rowId);
    }, MODEL_FLYOUT_HOVER_DELAY_MS);
  };

  /**
   * The pointer left a row. Cancel the pending open, leave an open panel.
   *
   * The asymmetry is the point, not an oversight: the panel is a hover region
   * of its own, and leaving a row is the normal first step of moving INTO it.
   * A panel that retracts on that crossing cannot be clicked, which is the
   * whole reason the fly-out exists. The panel does still go when the pointer
   * arrives on another row, when the search box takes over, and on Escape.
   */
  const handleHoverLeave = () => {
    clearPendingHover();
  };

  // Escape backs out ONE tier: the first press retracts the fly-out and leaves
  // the list, the second closes the menu. Handled here rather than through the
  // outside-close policy table because that table answers "does this surface
  // dismiss", and the fly-out is INSIDE the picker's container — it is a tier
  // of one surface, not a surface of its own.
  const handleRetract = () => {
    // Escape is an answer, so a hover still counting down is a hover the user
    // has already made irrelevant.
    clearPendingHover();
    setTier((current) => {
      if (current === "settings") {
        setFocusedRow(undefined);
        return "list";
      }
      setOpen(false);
      return "list";
    });
  };

  const selectedKeyString = selected ? modelKey(selected) : undefined;
  // Whether the fly-out describes a model other than the active one. It changes
  // what the panel SHOWS and nothing about what it lets the user do: a click
  // inside the fly-out is how that row gets picked, so gating the controls on it
  // made the panel a dead end that could only be read — the user had to click
  // the row first to unlock it, which is the step the fly-out exists to save.
  const flyoutIsPreview = isPreview(focusedKeyString, selectedKeyString);
  /**
   * Ask the row where it is, rather than remembering where it was.
   *
   * Two things move a row under an open panel, and this answers only the first.
   * The ELEMENT is replaced whenever the list re-renders, so a row captured
   * during render is a detached node by the next commit, and its rectangle
   * measures all zeroes — which places the panel against the viewport's origin
   * instead of against the row. Resolving here, from a callback the fly-out
   * calls out of its own layout effect, reads the row that is mounted NOW.
   *
   * The row's ID is the other thing, and `reconcileFocusedRow` is what handles
   * it: a key that names no rendered row resolves to nothing at all, and nothing
   * that measures can recover from that. Both are needed — the resolver cannot
   * invent a row that is not in the map, and the reconciliation cannot resurrect
   * an element that has already been replaced.
   */
  const flyoutAnchor: FlyoutAnchor = useCallback((): FlyoutRect | undefined => {
    if (tier !== "settings" || !focused) return undefined;
    const element = rowElements.current.get(focused.rowId);
    return element ? element.getBoundingClientRect() : undefined;
  }, [focused, tier]);

  /**
   * Move the focused row by `delta` through the VISIBLE rows, and return where
   * focus ended up.
   *
   * Exists because the menu no longer autofocuses its search field. The arrows
   * used to work by virtue of that field holding focus; without an explicit
   * handler here, dropping the autofocus would have silently taken the keyboard
   * with it, which is the trade this change must not make.
   *
   * Walks `groupedModels` rather than the raw catalogue, so a row the search
   * filter has hidden is not a row the arrow keys can land on. The first
   * ArrowDown from nothing focused enters at the top, which is what someone
   * opening a picker and pressing Down expects.
   *
   * Lands through the same `handleHoverRow` the pointer uses. Arrowing and
   * hovering are the same act — "this row is the one I am looking at" — and
   * routing them separately is how a keyboard user ends up unable to see the
   * settings a mouse user sees on the same row.
   */
  const moveFocusedRow = (delta: number) => {
    // Rows, not models. A starred model is listed twice, so a walk keyed by
    // model would step onto the shortlist's M3 and then onto the provider's M3
    // — two presses, one model, and the second press looks like the keyboard
    // ignored the first.
    const rows = groupedModels.flatMap((group) =>
      group.models.map((model) => {
        const key = modelKey(model);
        return { key, rowId: rowIdOf(group.id, key) };
      }),
    );
    if (rows.length === 0) return;
    const current = focused ? rows.findIndex((row) => row.rowId === focused.rowId) : -1;
    // From nothing focused, Down enters at the top and Up at the bottom, so
    // both keys are useful from the start rather than one of them doing
    // nothing.
    const next = current === -1
      ? (delta > 0 ? 0 : rows.length - 1)
      : Math.min(rows.length - 1, Math.max(0, current + delta));
    const row = rows[next];
    if (!row) return;
    handleHoverRow(row.key, row.rowId);
    rowElements.current.get(row.rowId)?.scrollIntoView({ block: "nearest" });
  };

  /**
   * The three seams the menu cluster takes. Each is one behaviour the cluster would otherwise have
   * to reach for the picker's state to perform.
   */
  const handleSearchChange = (value: string) => {
    retractFlyout();
    setQuery(value);
  };
  const handleSearchFocus = () => retractFlyout();
  const handleRowMount = (rowId: string, element: HTMLElement | null) => {
    if (element) rowElements.current.set(rowId, element);
    else rowElements.current.delete(rowId);
  };
  const handleCommitDraft = (draft: WebuiModelPickerDraft) => {
    setDrafts((current) => ({ ...current, [focusedKeyString]: draft }));
  };
  const handleCloseFlyout = () => {
    setOpen(false);
    setFocusedRow(undefined);
  };

  const favoriteKeys = useMemo(
    () => new Set(favoriteIds),
    [favoriteIds],
  );
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
        onClick={() => setOpen((value) => !value)}
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
            if (event.key === "Escape") handleRetract();
          }}
        >
          <WebuiModelMenuCluster
            query={query}
            searchId={searchId}
            searchIsEmpty={searchIsEmpty}
            onQueryChange={handleSearchChange}
            onSearchFocus={handleSearchFocus}
            onMoveRow={moveFocusedRow}
            groups={groupedModels}
            selected={selected}
            focusedRowId={focused?.rowId}
            favoriteKeys={favoriteKeys}
            onFocus={handleRowFocus}
            onHoverIntent={handleHoverIntent}
            onHoverLeave={handleHoverLeave}
            onSelect={handleSelectModel}
            onToggleFavorite={handleToggleFavorite}
            onRowMount={handleRowMount}
          />
        </div>
      ) : null}
      <WebuiModelDraftEditor
        open={open}
        tier={tier}
        model={focusedModel}
        draft={focusedDraft}
        anchor={flyoutAnchor}
        preview={flyoutIsPreview}
        onCommitDraft={handleCommitDraft}
        onSettingChange={onSettingChange}
        onSelect={onSelect}
        onCloseMenu={handleCloseFlyout}
        onRetract={handleRetract}
      />
    </div>
  );
}
