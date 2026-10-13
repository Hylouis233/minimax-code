// The plugin action inventory, applied and checked (ticket #72; plan §15.3, §4.8, §5.6).
//
// §15.3 sizes this business by its **actions**, not by its port member: `plugin-port.ts` declares one
// member (`pluginManagement?`) standing in front of 29 union values. §5.6 makes the accepted
// inventory (`docs/webui/plugin-action-inventory.md`, accepted 2026-10-12) a Required predecessor of
// this carve, and #72's acceptance says the inventory **is applied and each action's business is
// verified against it — a count of port members is not enough**.
//
// So the inventory file is this suite's authority, not a restatement of it: the names are read out of
// the document and compared as a SET against the four places they are carried. A fifth action added
// to any carrier without the document, or a name changed in one place, fails here.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = new URL("../../../../", import.meta.url);
const SRC = new URL("../../src/", import.meta.url);
const CLIENT = new URL("client/", SRC);
const read = (url: URL): string => readFileSync(fileURLToPath(url), "utf8");

const inventory = read(new URL("docs/webui/plugin-action-inventory.md", REPO));

/** The inventory table's action column: one row per action, numbered. */
const actions = [...inventory.matchAll(/^\|\s*\d+\s*\|\s*`(\w+)`\s*\|/gmu)].map((m) => m[1]!);
/** The rows the inventory records as having no client caller at all. */
const callerless = [...inventory.matchAll(/^\|\s*\d+\s*\|\s*`(\w+)`\s*\|([^|]*)\|/gmu)]
  .filter((m) => /no client caller/u.test(m[2] ?? ""))
  .map((m) => m[1]!);

const unionSrc = read(new URL("shared/plugin-management.ts", SRC));
const union = [...unionSrc.matchAll(/^\s*\|\s*"(\w+)"/gmu)].map((m) => m[1]!);

const serverSrc = read(new URL("server/operation/plugin-management.ts", SRC));
const serverActions = [...serverSrc.matchAll(/^\s*"(\w+)",?$/gmu)].map((m) => m[1]!);

const workflowSrc = read(new URL("application/plugins/plugin-workflows.ts", CLIENT));

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe("the inventory is the population the carve covers", () => {
  it("enumerates 29 actions, and the union carries exactly those", () => {
    expect(sorted(actions)).toHaveLength(29);
    expect(sorted(union)).toEqual(sorted(actions));
  });

  it("finds the same 29 in the server's two carriers", () => {
    // The server names them twice more (the accepted-action set and the input shapes); the
    // inventory's own counting rule calls these its three witnesses.
    const named = serverActions.filter((name) => actions.includes(name));
    expect(sorted([...new Set(named)])).toEqual(sorted(actions));
  });

  it("is sized by actions, not by port members", () => {
    // The port declares two members: `pluginManagement` carries the 29 actions, and `listSkills`
    // joined it at the port re-file (§9; the operator's 2026-10-12 decision files the skill
    // catalogue under `plugins`). The point of this case is that neither member's COUNT is the
    // size of the business — 2 members, 29 actions — so a carve driven by the member list
    // under-scopes by an order of magnitude (§15.3).
    const port = read(new URL("contracts/plugins/plugin-port.ts", CLIENT));
    const members = [...port.matchAll(/^  readonly (\w+)\??:/gmu)].map((m) => m[1]!);
    expect(members).toEqual(["pluginManagement", "listSkills"]);
    expect(members).toHaveLength(2);
    expect(actions).toHaveLength(29);
    // And the carrier the inventory counts is named as such where it is declared.
    expect(port).toContain("`pluginManagement` carries 29 actions behind its one member");
  });
});

describe("each action's business is the one the inventory records", () => {
  it("is invoked by the plugin owner", () => {
    // `plugins'` owner names every action it publishes. The one exception is the action the
    // inventory records as having no client surface to carve — declaring it beats inventing one.
    // The owner names them through its two dispatch helpers — `call` for reads, `mutate` for
    // writes — so both forms count as naming the action.
    const notInOwner = actions.filter(
      (action) => !new RegExp(`(?:call|mutate)\\(\\s*"${action}"`, "u").test(workflowSrc),
    );
    expect(sorted(notInOwner)).toEqual(sorted(callerless));
    expect(sorted(callerless)).toEqual(["listRuntimeSkills"]);
  });

  it("is reached from no client module outside the plugin business, bar the declared reader", () => {
    // The allowance is per module and each entry states its reason; a new module reaching this port
    // fails the case rather than passing a count.
    const allowed = [
      "application/plugins/plugin-workflows.ts", // the owner
      "application/port-slices.ts", // the slice's cut
      "contracts/plugins/plugin-port.ts", // the declaration
      "infrastructure/transport.ts", // the wire
      "components/shell/WebuiClientFoundationApp.tsx", // the composition root that builds the slice
      "components/SessionComposer.tsx", // the declared reader of `listInstalledPlugins` (§4.2, §4.8)
    ];
    const reach = [..."application contracts infrastructure components bindings projection".split(" ")]
      .flatMap((layer) => {
        const dir = fileURLToPath(new URL(layer + "/", CLIENT));
        return listFiles(dir).filter((file) => /pluginManagement/u.test(readSafe(file)));
      });
    expect(reach.length).toBeGreaterThan(0);
    const base = fileURLToPath(CLIENT).replace(/\/$/u, "") + "/";
    for (const file of reach) {
      const rel = file.slice(base.length);
      expect(allowed, `${rel} reaches the plugin port`).toContain(rel);
    }
  });

  it("keeps the composer's read of listInstalledPlugins as the inventory declares it", () => {
    const composer = read(new URL("components/SessionComposer.tsx", CLIENT));
    expect(composer).toContain("listInstalledPlugins");
  });
});

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      // `join` rather than a template: the directory handed in ends in a separator, and
      // `\${dir}/\${entry}` would produce `application//file.ts`, which matches no allowance.
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/u.test(path)) out.push(path);
    }
  };
  walk(dir);
  return out;
}

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
