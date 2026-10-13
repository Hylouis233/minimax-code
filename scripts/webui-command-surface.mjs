// The WebUI **command surface**, generated (plan §8 Phase 3 item 2; ticket #57).
//
// Phase 3's acceptance is that a business's published commands are an *output*,
// not a claim in prose: "sessions publishes X" has to show up as a diff when X
// changes. This script is that output. It reads the exported command
// declarations named in `BUSINESSES` below, extracts their members with the
// repository's own TypeScript parser, and writes one flat table to
// `docs/webui/command-surface.md`.
//
// The table is flat and sorted on purpose. A new member is exactly one added
// row, a removed member is exactly one removed row, and a rename reads as one
// of each — so a review diff of this file *is* the review of a command-surface
// change. A nested or per-module layout would hide the same information behind
// re-indentation.
//
// ## Where the rest of the businesses go
//
// Ticket #57 establishes this surface with `turn`, because `turn` is the
// substrate every later carve consumes. Each Phase 3 carve ticket adds its own
// rule to `BUSINESSES` in the same change as the carve — this script never
// guesses a business's owner module or its command declarations, and an
// unlisted business is absent from the table rather than empty in it.
//
// ## What it does not do
//
// It does not read the *implementation* (the factory's returned object). A
// surface reader keyed on the returned literal would go silent the moment a
// factory returns a `const` or spreads a helper, and it would report the
// members of the object rather than the members of the published type. The
// declaration is the contract every consumer compiles against; that is what is
// read here.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = fileURLToPath(new URL("../", import.meta.url));
const outputPath = path.join(root, "docs/webui/command-surface.md");

/**
 * business → the exported declarations that are its published command surface.
 * `module` is relative to `packages/webui/src/client/`.
 *
 * Only what the plan names as a business's *published* surface goes here: the
 * command groups it hands out and the capability slice it publishes. Internal
 * helpers, state owners and view types are not a command surface.
 */
const BUSINESSES = [
  {
    business: "turn",
    // §4.12 field 3: "the stream-phase group, the turn-lifecycle group, and the
    // turn capability slice (send/resume/load/stop)". The interaction group is
    // the third view of the same writer surface and belongs to `interactions`;
    // the groups themselves are the two interfaces `session-commands.ts` draws.
    declarations: [
      { module: "application/turn-capabilities.ts", name: "WebuiTurnCapabilitySlice" },
      { module: "application/sessions/session-commands.ts", name: "WebuiStreamPhaseCommands" },
      { module: "application/sessions/session-commands.ts", name: "WebuiTurnLifecycleCommands" },
      { module: "application/sessions/session-commands.ts", name: "WebuiTurnCommandWriter" },
      { module: "application/turn/turn-coordinator.ts", name: "WebuiTurnCoordinator" },
    ],
  },
  {
    business: "interactions",
    // The interaction view of the same writer surface. It is listed here rather
    // than under `turn` because the state it writes is `interactions`' own
    // (§5.6); the fact that one module declares both views is not ownership.
    declarations: [
      { module: "application/sessions/session-commands.ts", name: "WebuiInteractionCommands" },
      // §5.6: the carve's owner publishes the permission reply and the
      // answer/dismiss commands. Added by ticket #66, which split the two duties
      // out of the composer and gave each business its own owner.
      {
        module: "application/interactions/interaction-coordinator.ts",
        name: "WebuiInteractionCoordinator",
      },
    ],
  },
  {
    business: "composer",
    // §5.6's composer row: the owner module is `application/composer/composer-store.ts`, and
    // its published commands are what B3's session delete invokes (`purgeSlot`).
    // Recorded by ticket #68, which consumes that command.
    declarations: [
      { module: "application/composer/composer-store.ts", name: "WebuiComposerStore" },
    ],
  },
  {
    business: "goal",
    // §4 criterion C: `goal` owns state, has its own lifecycle events and
    // publishes commands, while no component ever names it. §5.6 gives the carve
    // the refresh, the write commands and the versioned apply. Added by ticket #66.
    declarations: [
      { module: "application/goal-coordinator.ts", name: "WebuiGoalCoordinator" },
    ],
  },
];

/** Members of an exported interface, or of an object-shaped type alias. */
function declarationMembers(relativePath, name) {
  const absolute = path.join(root, "packages/webui/src/client", relativePath);
  const source = ts.createSourceFile(
    absolute,
    readFileSync(absolute, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of source.statements) {
    const isInterface = ts.isInterfaceDeclaration(statement);
    const isTypeAlias = ts.isTypeAliasDeclaration(statement);
    if (!isInterface && !isTypeAlias) continue;
    if (statement.name.text !== name) continue;
    if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      continue;
    const type = isInterface
      ? statement
      : ts.isTypeLiteralNode(statement.type)
        ? statement.type
        : undefined;
    if (!type) continue;
    return type.members
      .filter((member) => member.name !== undefined)
      .map((member) => member.name.getText(source));
  }
  throw new Error(
    `webui-command-surface: ${relativePath} exports no interface or object type named ${name}`,
  );
}

function renderSurface() {
  const rows = [];
  for (const { business, declarations } of BUSINESSES) {
    for (const { module: modulePath, name } of declarations) {
      const members = declarationMembers(modulePath, name);
      if (members.length === 0)
        throw new Error(
          `webui-command-surface: ${name} declares no member, so it is not a surface`,
        );
      for (const member of members) rows.push({ business, name, member, modulePath });
    }
  }
  rows.sort(
    (a, b) =>
      a.business.localeCompare(b.business) ||
      a.name.localeCompare(b.name) ||
      a.member.localeCompare(b.member),
  );
  return [
    "<!-- Generated by scripts/webui-command-surface.mjs. Do not edit by hand. -->",
    "",
    "# The WebUI command surface",
    "",
    "Every business's published commands, read from its exported command declarations.",
    "This file is generated and checked by `pnpm check:webui-commands`; regenerate it with",
    "`node scripts/webui-command-surface.mjs --write` after changing a listed declaration.",
    "",
    "A business appears here only once its carve ticket has listed its declarations in",
    "`scripts/webui-command-surface.mjs`. The absence of a business means it has no carve",
    "yet, not that it publishes nothing.",
    "",
    "| Business | Declaration | Member | Declared in |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.business} | \`${row.name}\` | \`${row.member}\` | \`${row.modulePath}\` |`,
    ),
    "",
  ].join("\n");
}

const { values } = parseArgs({
  options: { write: { type: "boolean", default: false } },
});
const rendered = renderSurface();
if (values.write) {
  writeFileSync(outputPath, rendered);
  console.log(`webui-command-surface: wrote docs/webui/command-surface.md`);
  process.exit(0);
}
let current = "";
try {
  current = readFileSync(outputPath, "utf8");
} catch {
  current = "";
}
if (current !== rendered) {
  console.error(
    "webui-command-surface: docs/webui/command-surface.md is stale.\n" +
      "Regenerate it with `node scripts/webui-command-surface.mjs --write` and commit the result.\n" +
      "A stale file means a published command surface changed without the generated record moving.",
  );
  process.exit(1);
}
console.log("webui-command-surface: docs/webui/command-surface.md is current");
