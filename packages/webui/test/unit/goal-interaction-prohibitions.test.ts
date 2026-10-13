// The eight §5.1 prohibition cases for `goal` and `interactions` (ticket #66).
//
// §5.1 has four prohibitions, so "the eight prohibition cases for both businesses"
// is four per business. `turn`'s four are in `turn-boundary-prohibitions.test.ts`,
// written by the ticket that widened its intents because `turn` takes no carve;
// every other business's four are written by its own carve, and this is B1's.
//
// They are source-level and type-level assertions, and that is deliberate. §12.1
// says the dependency checker holds **no** business-boundary rule and this
// programme proposes none, so the machine half of the prohibitions is these tests —
// a reading, made repeatable. Each one states what it cannot see.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import type { WebuiInteractionSink } from "../../src/client/application/interactions/interaction-coordinator.js";
import type { WebuiGoalSink } from "../../src/client/application/goal/goal-coordinator.js";
import { createWebuiVersionCells } from "../../src/client/application/version-cell.js";

const CLIENT_ROOT = new URL("../../src/client/", import.meta.url);

/** Every `.ts`/`.tsx` module under `src/client`, as a repo-relative path. */
function clientModules(): string[] {
  const out: string[] = [];
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(child, `${path}/`);
      else if (/\.tsx?$/u.test(entry.name)) out.push(path);
    }
  };
  walk(CLIENT_ROOT, "");
  return out;
}

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, CLIENT_ROOT), "utf8");
}

/** Whitespace squashed, so a re-wrap cannot break a match. */
const flat = (text: string): string => text.replace(/\s+/gu, " ");

type OnlyTrue<T extends true> = T;

describe("prohibition 1 — a business may not hold a writer for another business's state", () => {
  it("goal: its sink carries the goal's own state and nothing else", () => {
    type Foreign = Extract<
      keyof WebuiGoalSink,
      // Anything that is not the goal's own projection or its own re-read hook.
      | "replacePendingPermissions"
      | "removePendingPermission"
      | "applyQuestionnaire"
      | "awaitInteraction"
      | "startStreaming"
      | "endStreaming"
      | "replaceStream"
      | "setSending"
    >;
    const narrow: OnlyTrue<Foreign extends never ? true : never> = true;
    expect(narrow).toBe(true);
    // What it does carry, named, so the assertion above is not vacuous.
    const own: Array<keyof WebuiGoalSink> = ["applyGoal", "afterGoalReRead"];
    expect(own).toHaveLength(2);
  });

  it("interactions: its sink carries no goal write and no stream writer", () => {
    type Foreign = Extract<
      keyof WebuiInteractionSink,
      | "applyGoal"
      | "afterGoalReRead"
      | "awaitInteraction"
      | "startStreaming"
      | "endStreaming"
      | "markStreamPhase"
      | "resumeAfterPermission"
      | "afterQuestionnaireAnswer"
      | "afterQuestionnaireDismiss"
    >;
    const narrow: OnlyTrue<Foreign extends never ? true : never> = true;
    expect(narrow).toBe(true);
    // The stream transitions are invoked as turn's published commands instead
    // (§5.2: an injected optional object is the violation, an invocation of the
    // owner's published command is the legal form); `interaction-coordinator.ts`
    // holds that command view — `prohibition 1` in `interaction-coordinator.test.ts`
    // asserts the runtime half.
    expect(flat(read("application/interactions/interaction-coordinator.ts"))).toContain(
      "readonly streams: WebuiStreamPhaseCommands;",
    );
  });
});

describe("prohibition 2 — a rule may not be filed under a module that does not own its concept", () => {
  it("interactions: the answers→phase rule lives with the flow that knows the outcome", () => {
    // The composer's wiring computed this; the transition's policy is the
    // interaction flow's, so both moved into the owner in this carve.
    const composer = flat(read("components/composer/WebuiComposer.tsx"));
    expect(composer).not.toContain("webuiAnswersEndTurn");
    expect(flat(read("application/interactions/interaction-coordinator.ts"))).toContain(
      "webuiAnswersEndTurn(answers)",
    );
  });

  it("the two fence cells are created by the application, not by the component", () => {
    // §4.2 field 6: the composer owns neither fence. The cell has to outlive a
    // render, so the application creates the instance and the business reads the
    // one it is handed.
    const composer = flat(read("components/composer/WebuiComposer.tsx"));
    // T05 moved both fences into the session-keyed owners: the component reads
    // neither cell and holds no counter of its own.
    expect(composer).not.toContain("useWebuiVersionCells()");
    expect(composer).not.toMatch(/useRef\(0\)/u);
    expect(flat(read("application/goal/goal-session-owners.ts"))).toContain(
      "const goalVersionRef: WebuiVersionCell = { current: 0 };",
    );
    expect(flat(read("application/interactions/interaction-session-owners.ts"))).toContain(
      "const pendingVersionRef: WebuiVersionCell = { current: 0 };",
    );
    expect(flat(read("application/create-application.ts"))).toContain(
      "const versionCells = createWebuiVersionCells();",
    );
    // One type, two objects: independence is structural, not conventional.
    const cells = createWebuiVersionCells();
    expect(cells.goal).not.toBe(cells.pending);
    cells.goal.current += 1;
    expect(cells.pending.current).toBe(0);
  });

  it("goal: no component holds a goal fence or a goal read of its own", () => {
    // The composer used to keep a second copy of the capture/compare guard while
    // the owner held the same logic. Neither the fence nor the read may be filed
    // in a component again.
    const composer = flat(read("components/composer/WebuiComposer.tsx"));
    expect(composer).not.toContain("goalVersionRef.current ==");
    expect(composer).not.toContain("goalVersionRef.current +=");
    expect(composer).not.toContain("getGoal({ sessionId })");
    expect(flat(read("application/goal/goal-coordinator.ts"))).toContain(
      "goalVersionRef.current !== versionAtRequest",
    );
  });
});

describe("prohibition 3 — the set of valid values is enumerated in exactly one place", () => {
  const literal = /"(?:thread_goal|permission|questionnaire)\.[a-z_.]+"/u;

  /**
   * The scan is scoped to **runtime event kinds**, which is the closed set the
   * registry owns. `features/transcript/projection/message-parts.ts` names message-block kinds
   * (`agent_joined`, `communication.message`, `delegation.message`,
   * `questionnaire.response`) — a different set, enumerated at that one site, whose
   * dotted and underscored spellings are a payload tolerance in the same class as
   * the snake_case alternatives on the lines beside them (`stringValue(data,
   * "requestId", "request_id")`). Excluding it is a scoping statement, not an
   * exemption: the two cases below still fail if a *third* module names a runtime
   * event kind.
   */
  const MESSAGE_BLOCK_KINDS = "features/transcript/projection/message-parts.ts";

  it("goal: no module but the registry and the reducer names a goal kind", () => {
    const naming = clientModules().filter((file) => {
      if (file === "projection/common/event-kinds.ts") return false;
      if (file === "application/turn/effect-reducer.ts") return false; // §10 S9 keeps the reducer's switch
      if (file === MESSAGE_BLOCK_KINDS) return false; // message-block kinds, not event kinds
      return literal.test(flat(read(file)));
    });
    expect(naming).toEqual([]);
  });

  it("interactions: the same, so a new interaction kind has one place to go", () => {
    // Same scan as above; the two are separate cases because the eight cases are
    // per business, and a future edit that reintroduces a literal for one family
    // should say which business it broke.
    const naming = clientModules().filter(
      (file) =>
        file !== "projection/common/event-kinds.ts" &&
        file !== "application/turn/effect-reducer.ts" &&
        file !== MESSAGE_BLOCK_KINDS &&
        /"(?:permission|questionnaire)\.[a-z_.]+"/u.test(flat(read(file))),
    );
    expect(naming).toEqual([]);
  });
});

describe("prohibition 4 — a rule shared across businesses gets one owner everyone reads", () => {
  it("the answers→phase rule is declared once and read from its owner", () => {
    const declaring = clientModules().filter((file) =>
      /export function webuiAnswersEndTurn/u.test(read(file)),
    );
    // One declaration. The render path and the interaction flow both read it, and
    // neither restates it — which is the whole of this prohibition.
    expect(declaring).toEqual(["projection/interactions/questionnaire-state.ts"]);
  });

  it("the goal version cell is declared once and shared as a type", () => {
    const declaring = clientModules().filter((file) =>
      /export interface WebuiVersionCell/u.test(read(file)),
    );
    expect(declaring).toEqual(["application/version-cell.ts"]);
    // Read as a type by both fences, one cell each — the independence the two
    // coordinators assert in their own suites. Phase 4 filed the interaction
    // coordinator under `application/interactions/` and the goal coordinator
    // under `application/goal/`, so both owners reach the shared cell by their
    // business-relative path.
    for (const [file, specifier] of [
      ["application/goal/goal-coordinator.ts", '../version-cell.js'],
      ["application/interactions/interaction-coordinator.ts", '../version-cell.js'],
    ]) {
      expect(read(file)).toContain(`from "${specifier}"`);
    }
  });
  it("a session switch resets the goal VIEW without clearing the retained goal", () => {
    // T01 ledger C4: the selection effect called `applyGoal(undefined)` before
    // the re-read, which wrote `goal: undefined` into the record of the session
    // being opened and destroyed truth that session already had. The correction
    // is un-drivable in a unit test (it needs a mounted React tree), so it is
    // pinned as a source tripwire — the same shape this suite already uses for
    // wiring a render cannot observe.
    const composer = flat(read("components/composer/WebuiComposer.tsx"));
    const at = composer.indexOf("void goalCoordinator.refreshGoal().then(");
    expect(at).toBeGreaterThan(-1);
    // The window is the selection effect: the mode reset, the re-read, and
    // nothing that clears the canonical goal.
    const effect = composer.slice(Math.max(0, at - 500), at + 200);
    expect(effect).toContain("setGoalMode(false);");
    expect(effect).not.toContain("applyGoal(undefined)");
  });
});
