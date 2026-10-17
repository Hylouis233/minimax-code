// The client's session event vocabulary, checked against the runtime's own producers.
//
// The row this answers (V36) asks for three things about a session fact published by
// another client or the CLI: that it reaches its owning invalidation through installed
// ingress without a mounted view, that facts deliberately not handled are declared in
// one list rather than dropped, and that a newly published fact cannot arrive as an
// unconstrained string. The first is the ingress work (`session-workflows.applyFact`,
// `created`/`deleted`, and the retained-draft notice); this file is the second and
// third.
//
// Two halves, and the second is the one that has teeth:
//
//   * **Partition.** The closed catalogue in `shared/contracts/session-facts.ts` is
//     exactly the applied names plus the deliberately-unapplied ones. Both directions
//     are `AssertEmpty`, so a name added to the catalogue without a decision is a
//     compile error and a name removed from either side is too.
//   * **Derivation.** The runtime publishes these names as literals; it has no
//     catalogue type to import, and this package cannot be depended on from that side.
//     So this test reads the runtime's sources and collects every literal event name
//     it produces, then requires each one to be in the catalogue or in the declared
//     non-catalogue list. A new fact fails here with its name — which is the closest
//     tie to the host available, and is stated as such rather than as a host
//     catalogue this build does not have.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  WEBUI_NON_CATALOGUE_SESSION_EVENTS,
  WEBUI_SESSION_FACT_TYPES,
  type WebuiSessionFactType,
} from "../../src/shared/contracts/session-facts.js";
import {
  WEBUI_APPLIED_SESSION_FACTS,
  WEBUI_SESSION_FACTS_NOT_APPLIED,
} from "../../src/client/features/turn/application/session-fact.js";

type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/** Names the decoder applies, as the union its own case labels produce. */
type AppliedNames = ElementOf<typeof WEBUI_APPLIED_SESSION_FACTS>;
/** Names the decoder receives and declines, with the reason recorded beside each. */
type NotAppliedNames = ElementOf<typeof WEBUI_SESSION_FACTS_NOT_APPLIED>["type"];

type AssertEmpty<T extends never> = T;
/** A catalogue fact the decoder neither applies nor declines. */
type UndecidedFact = AssertEmpty<Exclude<WebuiSessionFactType, AppliedNames | NotAppliedNames>>;
/** A decision about a name that is not a catalogue fact. */
type DecisionOutsideCatalogue = AssertEmpty<
  Exclude<AppliedNames | NotAppliedNames, WebuiSessionFactType>
>;

/** The runtime sources, scanned for the literal event names they publish. */
function runtimeEventTypeLiterals(): readonly string[] {
  const root = path.resolve(process.cwd(), "packages/local-runtime-v2/src");
  const found = new Set<string>();
  const pattern =
    /\btype:\s*["']((?:session|message|agent|rotation|content|turn|stream|permission|questionnaire)\.[a-z_.]+)["']/gu;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      const source = readFileSync(full, "utf8");
      for (const match of source.matchAll(pattern)) found.add(match[1]!);
    }
  };
  walk(root);
  return [...found].sort();
}

describe("V36 · the session fact vocabulary is closed and derived", () => {
  it("partitions the catalogue between applied and deliberately unapplied", () => {
    // The aliases above are `never`: a name on one side only fails compilation here
    // with the name in the message. Referencing them keeps them resolved.
    const undecided: readonly UndecidedFact[] = [];
    const outside: readonly DecisionOutsideCatalogue[] = [];
    expect([undecided, outside]).toHaveLength(2);

    expect(WEBUI_APPLIED_SESSION_FACTS).toHaveLength(8);
    expect(WEBUI_SESSION_FACTS_NOT_APPLIED).toHaveLength(9);
    expect(WEBUI_SESSION_FACT_TYPES).toHaveLength(17);
  });

  it("classifies every literal event name the runtime publishes", () => {
    const literals = runtimeEventTypeLiterals();
    // A scan that found nothing would pass vacuously; the runtime publishes twenty
    // names today, so an empty or tiny result means the fixture path or pattern broke.
    expect(literals.length).toBeGreaterThanOrEqual(15);

    const catalogue = new Set<string>(WEBUI_SESSION_FACT_TYPES);
    const elsewhere = new Set(WEBUI_NON_CATALOGUE_SESSION_EVENTS.map((entry) => entry.type));
    const unclassified = literals.filter((type) => !catalogue.has(type) && !elsewhere.has(type));

    expect(
      unclassified,
      "these names are published by the runtime and are in neither the session fact catalogue nor the declared non-catalogue list",
    ).toEqual([]);
  });

  it("names what it routes elsewhere, so 'not here' has an owner", () => {
    for (const event of WEBUI_NON_CATALOGUE_SESSION_EVENTS) {
      expect(event.handledBy.length).toBeGreaterThan(0);
    }
    // The turn and queue events the decoder must not claim: they share the prefix and
    // belong to the reducer and the coordinator. This is the regression this file was
    // written after — an `unapplied` outcome for `session.start` silently took the
    // coordinator's own events away from it.
    const claimed = new Set<string>(WEBUI_NON_CATALOGUE_SESSION_EVENTS.map((entry) => entry.type));
    const catalogue = new Set<string>(WEBUI_SESSION_FACT_TYPES);
    for (const type of ["session.start", "session.finish", "session.queue.updated"]) {
      expect(claimed.has(type)).toBe(true);
      expect(catalogue.has(type)).toBe(false);
    }
  });
});
