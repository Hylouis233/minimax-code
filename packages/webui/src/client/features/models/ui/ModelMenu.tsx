import type { ReactElement } from "react";

import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
  WebuiModelProviderGroup,
} from "../contracts/model-view.js";
import { modelKey, rowIdOf } from "../projection/model-picker-rows.js";

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
              model.displayName ?? `${model.providerId}/${model.modelId}`;
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

export function WebuiModelMenuCluster({
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
