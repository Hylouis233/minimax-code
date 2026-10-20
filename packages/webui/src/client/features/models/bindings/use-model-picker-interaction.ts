import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  WebuiModelPickerEntry,
  WebuiModelProviderGroup,
} from "../contracts/model-view.js";
import {
  isPreview,
  rowHasFlyout,
  type CascadeTier,
} from "../projection/model-picker-cascade.js";
import {
  MODEL_FLYOUT_HOVER_DELAY_MS,
  hoverArrival,
} from "../projection/model-picker-hover.js";
import {
  modelKey,
  reconcileFocusedRow,
  rowIdOf,
  type FocusedRow,
} from "../projection/model-picker-rows.js";
import type { FlyoutAnchor } from "../ui/ModelSettingsFlyout.js";
import type { FlyoutRect } from "../../../projection/common/flyout-position.js";

/**
 * Owns the model picker's disposable hover, focus, cascade and anchor
 * attachment.
 *
 * Not its dismissal: the menu and the settings fly-out are `WebuiDropdown`s and
 * the shared skeleton is what closes them on a press outside and on Escape. What
 * stays here is what those two answers MEAN for this picker — `onEscape` walks
 * back out one tier at a time rather than closing the menu on the first press.
 */
export function useModelPickerInteraction({
  models,
  groups,
  selected,
}: {
  readonly models: readonly WebuiModelPickerEntry[];
  readonly groups: readonly WebuiModelProviderGroup[];
  readonly selected: WebuiModelPickerEntry | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [focusedRow, setFocusedRow] = useState<FocusedRow | undefined>();
  const [tier, setTier] = useState<CascadeTier>("list");
  const rowElements = useRef(new Map<string, HTMLElement>());
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelsRef = useRef(models);
  modelsRef.current = models;

  const clearPendingHover = useCallback(() => {
    if (hoverTimer.current === null) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);

  const focused = useMemo(
    () => reconcileFocusedRow(focusedRow, groups),
    [focusedRow, groups],
  );

  const retract = useCallback(() => {
    clearPendingHover();
    setTier("list");
    setFocusedRow(undefined);
  }, [clearPendingHover]);

  useEffect(() => {
    if (open) return;
    setTier("list");
    setFocusedRow(undefined);
    clearPendingHover();
  }, [clearPendingHover, open]);

  useEffect(() => clearPendingHover, [clearPendingHover]);

  const focusedModel = useMemo<WebuiModelPickerEntry | undefined>(() => {
    const key = focused?.key ?? (selected ? modelKey(selected) : undefined);
    if (!key) return undefined;
    return models.find((model) => modelKey(model) === key) ?? selected;
  }, [focused, models, selected]);
  const focusedKey = focusedModel ? modelKey(focusedModel) : "";

  const close = useCallback(() => {
    clearPendingHover();
    setOpen(false);
    setFocusedRow(undefined);
  }, [clearPendingHover]);

  const openOrToggle = useCallback(() => setOpen((value) => !value), []);

  const focusRow = useCallback((key: string, rowId: string) => {
    setFocusedRow({ key, rowId });
  }, []);

  const activateRow = useCallback(
    (key: string, rowId: string) => {
      clearPendingHover();
      const model = modelsRef.current.find((entry) => modelKey(entry) === key);
      if (!model) return;
      setFocusedRow({ key, rowId });
      setTier(rowHasFlyout(model) ? "settings" : "list");
    },
    [clearPendingHover],
  );

  const onHoverIntent = useCallback(
    (key: string, rowId: string) => {
      const model = modelsRef.current.find((entry) => modelKey(entry) === key);
      const arrival = hoverArrival({
        rowId,
        focusedRowId: focused?.rowId,
        tier,
        hasFlyout: rowHasFlyout(model),
      });
      if (arrival === "keep-open") return;
      clearPendingHover();
      setTier("list");
      if (arrival === "retract-only") return;
      hoverTimer.current = setTimeout(() => {
        hoverTimer.current = null;
        activateRow(key, rowId);
      }, MODEL_FLYOUT_HOVER_DELAY_MS);
    },
    [activateRow, clearPendingHover, focused?.rowId, tier],
  );

  const onHoverLeave = useCallback(
    (_rowId: string) => {
      clearPendingHover();
    },
    [clearPendingHover],
  );

  const onRowMount = useCallback(
    (rowId: string, element: HTMLElement | null) => {
      if (element) rowElements.current.set(rowId, element);
      else rowElements.current.delete(rowId);
    },
    [],
  );

  const flyoutAnchor: FlyoutAnchor = useCallback((): FlyoutRect | undefined => {
    if (tier !== "settings" || !focused) return undefined;
    const element = rowElements.current.get(focused.rowId);
    return element ? element.getBoundingClientRect() : undefined;
  }, [focused, tier]);

  const moveFocusedRow = useCallback(
    (delta: number) => {
      const rows = groups.flatMap((group) =>
        group.models.map((model) => {
          const key = modelKey(model);
          return { key, rowId: rowIdOf(group.id, key) };
        }),
      );
      if (rows.length === 0) return;
      const current = focused
        ? rows.findIndex((row) => row.rowId === focused.rowId)
        : -1;
      const next =
        current === -1
          ? delta > 0
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, current + delta));
      const row = rows[next];
      if (!row) return;
      activateRow(row.key, row.rowId);
      rowElements.current.get(row.rowId)?.scrollIntoView({ block: "nearest" });
    },
    [activateRow, focused, groups],
  );

  const onEscape = useCallback(() => {
    clearPendingHover();
    setTier((current) => {
      if (current === "settings") {
        setFocusedRow(undefined);
        return "list";
      }
      setOpen(false);
      return "list";
    });
  }, [clearPendingHover]);

  const isPreviewing = isPreview(
    focusedKey,
    selected ? modelKey(selected) : undefined,
  );

  return {
    open,
    tier,
    focused,
    focusedModel,
    focusedKey,
    isPreviewing,
    flyoutAnchor,
    toggle: openOrToggle,
    close,
    retract,
    onEscape,
    onRowFocus: focusRow,
    onHoverIntent,
    onHoverLeave,
    onRowMount,
    onMoveRow: moveFocusedRow,
  };
}
