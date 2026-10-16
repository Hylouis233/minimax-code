// How the model catalogue becomes rows.
//
// The picker renders rows; it does not decide what a row IS. Grouping, the row's
// key, the difference between a model key and a row id, and where the highlight
// should point after the catalogue was re-derived are catalogue facts, so they
// live here with the rest of the Models projection. The picker keeps the menu
// cluster, the draft fly-out and the keyboard/focus/preview transaction
// behaviour, and reads these rules from its owner.

import type { WebuiModelPickerEntry, WebuiModelProviderGroup } from "../contracts/model-view.js";
import { orderModelGroups } from "./model-favorites.js";
import { filterModelGroups } from "./model-picker-search.js";

/** Group label: the provider's display name, falling back to its id. */
export function providerGroupLabel(model: WebuiModelPickerEntry): string {
  const name = model.providerName?.trim();
  return name || model.providerId;
}

/**
 * Groups by provider, keeping the catalog's own order — the same grouping the
 * TUI picker applies (see `packages/tui/src/tui/features/model/picker.ts`).
 *
 * Buckets on `providerId` and carries the display name alongside, rather than
 * bucketing on the name itself. Same visible result for the ordinary case
 * where every provider has a distinct name, and the right result for the
 * case where two do not.
 */
export function groupModelsByProvider(
  models: readonly WebuiModelPickerEntry[],
): readonly WebuiModelProviderGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, WebuiModelPickerEntry[]>();
  const labels = new Map<string, string>();
  for (const model of models) {
    const id = model.providerId;
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.push(model);
      continue;
    }
    buckets.set(id, [model]);
    labels.set(id, providerGroupLabel(model));
    order.push(id);
  }
  return order.map((id) => ({
    id,
    label: labels.get(id) ?? id,
    models: buckets.get(id) ?? [],
  }));
}

/**
 * The stable identity of one model: `providerId/modelId/variant`.
 *
 * The variant is part of the key because the picker lists the same model
 * twice when it offers an off/on pair, and a star on one of them is a
 * statement about that row, not about the model name.
 */
export function modelKey(model: WebuiModelPickerEntry): string {
  return `${model.providerId}/${model.modelId}/${model.variant ?? ""}`;
}

/**
 * A row's identity: the group it is rendered in, plus the model.
 *
 * A starred model is rendered TWICE — under its provider and again in the
 * shortlist — so the model key is not a row key. Anything per-ROW has to use
 * this: the highlight, the fly-out's anchor rectangle, where the arrow keys
 * think they are. Keyed by the model alone, all three point at whichever copy
 * mounted last, which is the provider's, and the panel then opens beside a
 * different line than the one the pointer is on.
 */
export function rowIdOf(groupId: string, key: string): string {
  return `${groupId}::${key}`;
}

/**
 * The part of a model key that survives the model's OWN settings changing.
 *
 * A key carries the variant, because a model offering an off/on pair is two
 * rows and a star on one of them is a statement about that row. Which makes the
 * key a poor thing to hold onto across a change made TO that row: switching the
 * thinking toggle off rewrites the variant, the re-derived catalogue renames the
 * row, and the key captured a moment earlier now names a row nobody renders.
 */
export function modelIdentity(key: string): string {
  const at = key.lastIndexOf("/");
  return at === -1 ? key : key.slice(0, at);
}

/** The row the pointer or the keyboard is on: which model, and which line of it. */
export interface FocusedRow {
  readonly key: string;
  readonly rowId: string;
}

/**
 * The focused row, re-pointed at the row that exists NOW.
 *
 * A row id is derived, not durable: it is built from the model and the group the
 * model is rendered in, and BOTH are re-derived whenever a setting is committed.
 * The user pressing the fly-out's own switch is one of those commits, so the act
 * of configuring a two-state model renames that model's row — and the highlight
 * goes dark while the fly-out loses its anchor, cannot measure, and drops out of
 * the flow it was anchored to. Nothing recovers it but moving the pointer, so the
 * panel stays beside nothing until the user goes back to the row and re-opens it.
 *
 * So the id is checked against the rows on screen rather than trusted to have
 * survived. Returns its argument UNCHANGED when the row is still there, which
 * keeps a stable input referentially stable — a fresh object every render would
 * rebuild the fly-out's anchor resolver and its scroll listeners with it. Returns
 * it unchanged when the row is genuinely GONE as well: a row that is not there
 * has nothing to re-point at, and the paths that remove rows (a search
 * keystroke, a filter) retract the panel themselves.
 */
export function reconcileFocusedRow(
  focused: FocusedRow | undefined,
  groups: readonly WebuiModelProviderGroup[],
): FocusedRow | undefined {
  if (!focused) return undefined;
  const identity = modelIdentity(focused.key);
  let sameModel: FocusedRow | undefined;
  let sameIdentity: FocusedRow | undefined;
  for (const group of groups) {
    for (const model of group.models) {
      const key = modelKey(model);
      const rowId = rowIdOf(group.id, key);
      if (rowId === focused.rowId) return focused;
      if (key === focused.key) sameModel ??= { key, rowId };
      if (modelIdentity(key) === identity) sameIdentity ??= { key, rowId };
    }
  }
  // The same model under a new group is this very row, re-homed. Failing that,
  // the same model under a new VARIANT is the row the pointer is still on, and
  // the switch that was just pressed is what renamed it.
  return sameModel ?? sameIdentity ?? focused;
}

/**
 * The sections the menu renders: the catalogue grouped by provider, narrowed by
 * the search, with the shortlist hoisted.
 *
 * Order matters and is deliberate: filter FIRST, then hoist. Hoisting on the
 * unfiltered list would keep a starred model visible while the user is searching
 * for something else, which is the one thing a search must not do. The other
 * order would also mean the favourites section is rebuilt on every keystroke
 * even when no star is in the result set.
 */
export function projectModelPickerSections(params: {
  readonly models: readonly WebuiModelPickerEntry[];
  readonly query: string;
  readonly favoriteIds: readonly string[];
  readonly favoritesLabel: string;
}): readonly WebuiModelProviderGroup[] {
  const grouped = groupModelsByProvider(params.models);
  const filtered = filterModelGroups(grouped, params.query);
  return orderModelGroups(filtered, params.favoriteIds, params.favoritesLabel, modelKey);
}
