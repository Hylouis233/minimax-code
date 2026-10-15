// `turn`'s four §5.1 prohibition assertions (ticket #57).
//
// Ticketing note: every other business's four prohibitions are written by that
// business's own Phase 3 carve ticket. `turn` takes no carve ticket — it *is*
// the substrate — so its four are carried by the ticket that widens its
// intents, as a separate item from the four substrate fences
// (`turn-substrate-fences.test.ts`). The two are different claims: a fence
// asserts that a mechanism holds; a prohibition asserts that one business
// cannot reach another's state.
//
// They are source-level assertions, and that is deliberate. §12.1 says the
// dependency checker holds **no** business-boundary rule and this programme
// proposes none, so the machine half of the prohibitions is these tests — a
// reading, made repeatable. Each one states what it cannot see.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

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

/** The modules `turn` owns: its capability slice, commands, loop and lease. */
const TURN_MODULES = [
  "features/turn/application/turn-capabilities.ts",
  "features/turn/application/turn-commands.ts",
  "features/turn/application/turn-coordinator.ts",
  "features/sessions/application/session-commands.ts",
  "features/turn/application/stream-state-bundle.ts",
  "features/turn/application/stream-lease-controller.ts",
  "conversation/stream-loop.ts",
  "conversation/stream-lease.ts",
];

describe("prohibition 1 — turn holds no writer for another business's state", () => {
  it("writes the store through its own writer, its own read, and one stream-only patch", () => {
    for (const modulePath of TURN_MODULES) {
      const source = read(modulePath);
      // The only store entry points a turn module may use. Anything else is a
      // second writer for a slice `turn` does not own. Matched as *calls*, so
      // an import specifier like `"./session-store.js"` is not mistaken for one.
      const members = [...source.matchAll(/\bstore\.([A-Za-z_$][\w$]*)\s*\(/gu)].map(
        (match) => match[1],
      );
      expect(
        members.every((member) =>
          ["createSessionWriter", "readSession", "updateSession"].includes(member!),
        ),
      ).toBe(true);
      // `updateSession` is the one generic write, and it exists in exactly one
      // turn module: the lease controller, which patches the `stream` field and
      // nothing else.
      if (members.includes("updateSession")) {
        expect(modulePath).toBe("features/turn/application/stream-lease-controller.ts");
        const calls = source.split("store.updateSession(").slice(1);
        expect(calls).toHaveLength(2);
        for (const call of calls) {
          // The written field set of each patch, read off the callback's object
          // literal: `stream` and nothing else.
          const body = call.slice(0, call.indexOf("}))"));
          const keys = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/gu)].map(
            (match) => match[1],
          );
          expect(keys).toEqual(["stream"]);
        }
      }
    }
  });

  it("takes its interaction targets as injected functions rather than importing an owner", () => {
    // `session-commands.ts` declares `setPermissions` / `setQuestionnaire` /
    // `setGoal` as *parameter types* of the interaction command factory. The
    // writer behind them belongs to `interactions`; this module must not be able
    // to reach it.
    const source = read("features/sessions/application/session-commands.ts");
    expect(source).not.toMatch(/from "\.\.?\/[^"]*session-store\.js"/u);
    expect(source).not.toMatch(/createInteractionWriter/u);
    expect(source).not.toMatch(/updateSession\(/u);
  });
});

describe("prohibition 2 — turn's rules are filed inside turn", () => {
  it("declares the loop and the lease in conversation/, never in a component", () => {
    const declarations = [
      { symbol: "function runWebuiStreamLoop", owner: "conversation/stream-loop.ts" },
      { symbol: "function buildWebuiStreamLoopSink", owner: "conversation/stream-loop.ts" },
      { symbol: "function nextWebuiLeaseGeneration", owner: "conversation/stream-lease.ts" },
      { symbol: "function isWebuiLeaseGenerationCurrent", owner: "conversation/stream-lease.ts" },
      { symbol: "function fenceWebuiLeaseStream", owner: "conversation/stream-lease.ts" },
    ];
    const modules = clientModules();
    for (const { symbol, owner } of declarations) {
      const sites = modules.filter((modulePath) => read(modulePath).includes(symbol));
      expect(sites).toEqual([owner]);
    }
    // And no component so much as names them: a component that reached the
    // mechanism directly would be holding the loop rather than submitting an
    // intent to it. Presentation lives in `client/shell/`, `client/ui/` and each
    // feature's `ui/`; a scan of one spelling alone finds nothing and would pass
    // for the wrong reason, so the guard below pins that something was scanned.
    const isPresentation = (path: string): boolean =>
      path.startsWith("shell/") || path.startsWith("ui/") || /^features\/[^/]+\/ui\//u.test(path);
    const presentations = modules.filter(isPresentation);
    expect(presentations.length).toBeGreaterThan(0);
    for (const modulePath of presentations) {
      const source = read(modulePath);
      for (const { symbol } of declarations) expect(source).not.toContain(symbol);
      expect(source).not.toMatch(/(?:mechanisms|conversation)\/stream-(loop|lease)\.js/u);
    }
  });
});

describe("prohibition 3 — the stream-phase value set is enumerated exactly once", () => {
  const PHASES = ["idle", "streaming", "waiting", "reconnecting", "refused", "done"];

  it("keeps the union in features/turn/contracts/stream-state.ts and nowhere else", () => {
    const enumerations = clientModules().filter((modulePath) => {
      const source = read(modulePath);
      return PHASES.every((phase) => new RegExp(`"${phase}"`, "u").test(source));
    });
    // `WebuiConnectionState` also says "reconnecting", which is a *different*
    // closed set — a connection state, not a stream phase. Only the stream
    // phase's six values together identify the one enumeration.
    expect(enumerations).toEqual(["features/turn/contracts/stream-state.ts"]);
  });

  it("derives the phase type from the union instead of re-listing it", () => {
    expect(read("features/turn/contracts/turn-command-views.ts")).toContain(
      'WebuiStreamState["phase"]',
    );
  });
});

describe("prohibition 4 — turn's shared rules have exactly one owner", () => {
  it("has one generation counter, and every reader imports it", () => {
    const modules = clientModules();
    for (const symbol of [
      "nextWebuiLeaseGeneration",
      "isWebuiLeaseGenerationCurrent",
      "fenceWebuiLeaseStream",
    ]) {
      const declaring = modules.filter((modulePath) =>
        new RegExp(`function ${symbol}\\b`, "u").test(read(modulePath)),
      );
      expect(declaring).toEqual(["conversation/stream-lease.ts"]);

      const users = modules.filter((modulePath) => read(modulePath).includes(symbol));
      for (const user of users) {
        if (user === "conversation/stream-lease.ts") continue;
        // A second copy is what prohibition 4 forbids; a reader must import the
        // owner's rule. Both specifier shapes count: the module itself sits
        // beside `stream-lease.ts` (`./`), every other layer reaches it from one
        // level (or more) below the substrate's home.
        expect(read(user)).toMatch(
          /from "(\.\/(?:\.\.\/)*|.*?\/conversation\/)stream-lease\.js"/u,
        );
      }
      expect(users.length).toBeGreaterThan(1);
    }
  });
});
