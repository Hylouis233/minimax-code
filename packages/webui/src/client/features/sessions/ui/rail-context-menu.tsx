// RailContextMenu — extracted from `SessionRail.tsx` (T07's responsibility cut of the rail).
// The declaration body is verbatim; the `export` keyword, this header and the
// import specifiers are the only differences.

import { type ReactElement } from "react";
import { WebuiContextMenu, type WebuiContextMenuItem } from "../../../ui/ContextMenu.js";

/**
 * The rail's context menu (plan §16.10's three in-file regions: the context menu).
 *
 * `WebuiProjectList` has two returns — the empty/loading branch and the populated one — and both mount
 * the menu over the same list state. Naming it once is what makes the third region a region: the menu's
 * position and items stay the list's state, and this component only renders them.
 */
export function RailContextMenu({ menu, onClose }: {
  readonly menu: { readonly x: number; readonly y: number; readonly items: readonly WebuiContextMenuItem[] };
  readonly onClose: () => void;
}): ReactElement {
  return <WebuiContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={onClose} />;
}
