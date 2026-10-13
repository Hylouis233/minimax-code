// The version cell the two fences share (plan §8 Phase 3, B1; ticket #66).
//
// Both fences are the same mechanism — a monotonically increasing counter that a
// read captures before asking and compares after answering — and both need it
// stored outside the coordinator, because a coordinator may be constructed on
// every render and a counter living in it would reset and silently disable the
// guard it protects.
//
// They are **the same type and two independent cells**. Goal's fence orders goal
// reads against goal writes; the interaction fence orders pending-permission and
// questionnaire reads against replies. Neither bump is observable to the other,
// which is what this module makes structural rather than conventional: there is
// one cell definition to share, and nothing in it can be shared by accident
// because the cell is an object the caller owns one of per duty.

export interface WebuiVersionCell {
  current: number;
}

/**
 * Both cells, created together and owned by the application.
 *
 * They are made here rather than in the component that currently hands them to
 * the two coordinators: the cell must outlive a render (a counter inside a
 * per-render coordinator resets and silently disables the guard), and §4.2 field
 * 6 puts the goal's fence in `goal` and interactions' late-read protection in
 * `interactions` — so neither is the composer's state to declare.
 *
 * Still two independent objects. The pair is a construction convenience, not a
 * shared cell: `a goal write does not bump the pending cell` and its converse
 * assert that in `goal-coordinator.test.ts`.
 */
export interface WebuiVersionCells {
  /** `goal`'s: orders goal reads against goal writes. */
  readonly goal: WebuiVersionCell;
  /** `interactions`': orders pending-permission and questionnaire reads against replies. */
  readonly pending: WebuiVersionCell;
}

export function createWebuiVersionCells(): WebuiVersionCells {
  return { goal: { current: 0 }, pending: { current: 0 } };
}
