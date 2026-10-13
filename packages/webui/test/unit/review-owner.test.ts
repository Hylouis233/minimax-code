// The review/diff machine has one owner and two readers (plan §5.6's `transcript`
// row; §10 S13: "review/diff rendered in a second place | the reducer is filed in
// the transcript's component | one owner (`review`'s reducer module) and two
// readers"; ticket #69).
//
// Two surfaces render a diff — the transcript's card on an assistant message and
// the review page over a whole change set — and the machine, the failure copy and
// the mutation decisions used to be filed in the first of them. They live in
// `projection/review-state.ts` now, and this file asserts both halves of the
// acceptance: one machine, two readers, and no private copy in either.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import {
  buildWebuiDiffMutationRequest,
  confirmWebuiDiffMutation,
  describeWebuiDiffFailure,
  initialWebuiDiffState,
  reduceWebuiDiffState,
  resolveWebuiDiffMutation,
} from "../../src/client/projection/review-state.js";

const CLIENT = new URL("../../src/client/", import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, CLIENT), "utf8");
const flat = (text: string): string => text.replace(/\s+/gu, " ");

/** Every `.ts`/`.tsx` module under a directory, recursively. */
function modulesUnder(prefix: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(new URL(dir, CLIENT), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (/\.tsx?$/u.test(entry.name)) found.push(path);
    }
  };
  walk(prefix);
  return found;
}

describe("the diff machine has one owner", () => {
  it("is declared in the review module and nowhere else", () => {
    const declarers = [...modulesUnder("components/"), ...modulesUnder("projection/")].filter(
      (file) => /export function reduceWebuiDiffState\(/u.test(read(file)),
    );
    expect(declarers).toEqual(["projection/review-state.ts"]);
  });

  it("leaves the transcript's card with no machine of its own", () => {
    const card = flat(read("components/DiffCard.tsx"));
    // It CALLS the machine (every state update goes through it) and does not
    // declare one: no reducer, no initial-state literal, no switch, no copy table.
    expect(card).not.toContain("export function reduceWebuiDiffState(");
    expect(card).not.toContain("export const initialWebuiDiffState");
    expect(card).not.toContain("switch (action.type)");
    expect(card).toContain("reduceWebuiDiffState(current,");
    expect(card).not.toContain("WEBUI_DIFF_FAILURE_COPY");
    // ...and it reads the owner instead.
    expect(card).toContain('from "../projection/review-state.js"');
  });

  it("keeps the failure copy in exactly one module", () => {
    const holders = [...modulesUnder("components/"), ...modulesUnder("projection/")].filter(
      (file) => read(file).includes("unsafe_path:"),
    );
    expect(holders).toEqual(["projection/review-state.ts"]);
  });
});

describe("the two readers share it", () => {
  it("is read by the transcript's card and by the review page", () => {
    const readers = ["components/DiffCard.tsx", "components/SettingsModal.tsx"].filter((file) =>
      read(file).includes('"../projection/review-state.js"'),
    );
    expect(readers).toEqual(["components/DiffCard.tsx", "components/SettingsModal.tsx"]);
  });

  it("still decides the same things the card used to decide itself", () => {
    // The move is move-only: these are the decisions the component used to own,
    // asserted against the owner so a relocation that changes one fails here.
    const loaded = reduceWebuiDiffState(initialWebuiDiffState, {
      type: "loaded",
      view: { changeSetId: "c1", status: "active", canUndo: true, canReapply: false, fileChanges: [] },
    } as never);
    expect(buildWebuiDiffMutationRequest(loaded, { id: "s" } as never, "revert")).toEqual({
      id: "s",
      changeSetId: "c1",
    });
    // A failure is not an absent capability, and the copy is the table's.
    const failed = reduceWebuiDiffState(loaded, { type: "mutation-failed", error: "conflict" });
    expect(failed.unsupported).toBe(false);
    expect(describeWebuiDiffFailure("conflict")).toContain("文件又被修改过");
    expect(confirmWebuiDiffMutation(failed, true).busy).toBe(true);
    expect(confirmWebuiDiffMutation(failed, false)).toBe(failed);
    expect(resolveWebuiDiffMutation("reapply", undefined, new Error("boom")).type).toBe(
      "mutation-failed",
    );
  });
});
