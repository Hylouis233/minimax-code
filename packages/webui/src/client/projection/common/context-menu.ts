// Where a context menu opens, given the pointer and the viewport.
//
// Carved out of `components/shared/ContextMenu.tsx` by Phase 4b, and moved here
// from `projection/shell/` by T18: the placement rule has no shell policy in it
// — it clamps a floating box to the viewport for whichever surface opened it —
// so it belongs with the other generic menu mechanics
// (`projection/common/outside-close.ts`, which the same component reads for its
// close rule). While it sat under the shell's projection, the shared menu, which
// no business owns, reached into one business's private projection; here the
// edge is what it always was in substance: reusable mechanics read by reusable
// presentation.
//
// The body is the declaration as it stood in the source module — no behaviour
// change.

export function placeWebuiContextMenu({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  padding = 8,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly padding?: number;
}): { readonly left: number; readonly top: number } {
  const maxLeft = Math.max(padding, viewportWidth - width - padding);
  const left = Math.min(Math.max(padding, x), maxLeft);
  const flippedTop = y + height + padding > viewportHeight ? y - height : y;
  const maxTop = Math.max(padding, viewportHeight - height - padding);
  return { left, top: Math.min(Math.max(padding, flippedTop), maxTop) };
}
