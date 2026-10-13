// How the catalogue hosts the two dialogs, and what a failed operation does to the user's state
// (ticket #72's third and fourth criteria).
//
// The dialogs were cut out of this file, so what the ticket requires is that the *hosting* and the
// two failure behaviours did not move with them:
//
//   - each dialog still renders in the conditional it occupied (`dialog ?` / `pluginImportDialog ?`),
//     which is also what makes both own no state — they are unmounted on close, and the fields they
//     show are the catalogue's, so reopening one shows what the user last typed;
//   - the three save paths are dispatched from the form's submit, by `dialog`, as before;
//   - **install failure preserves prior state**: `importPlugin` closes the dialog and clears the
//     preview only inside the branch that ran after the mutation reported success;
//   - **preview failure preserves browse state**: `previewPlugin` records the error and writes the
//     preview only on success, so a failed preview leaves the typed URL, the previous preview and the
//     catalogue's rows exactly as they were.
//
// These are source assertions on purpose: the interactions need a DOM, and this repo has no DOM test
// framework (§ the no-jsdom rule). Each one names the exact expression, so moving the close out of
// the success branch or clearing the preview in the catch turns it red.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMPONENTS = new URL("../../src/client/components/", import.meta.url);
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, COMPONENTS)), "utf8");

const catalogue = read("plugins/PluginCatalogue.tsx");
const itemDialog = read("plugins/PluginItemDialog.tsx");
const importDialog = read("plugins/PluginImportDialog.tsx");

const slice = (text: string, from: string, to: string): string =>
  text.slice(text.indexOf(from), text.indexOf(to));

describe("the catalogue hosts both dialogs as it did", () => {
  it("renders each in the conditional it occupied", () => {
    expect(catalogue).toContain("{dialog ? (\n        <PluginItemDialog");
    expect(catalogue).toContain("{pluginImportDialog ? (\n        <PluginImportDialog");
  });

  it("keeps both dialogs stateless, so the catalogue's fields outlive a close", () => {
    for (const [name, source] of [["PluginItemDialog", itemDialog], ["PluginImportDialog", importDialog]] as const) {
      expect(source, `${name} declares state`).not.toContain("useState(");
      expect(source, `${name} declares a ref`).not.toContain("useRef(");
      expect(source, `${name} subscribes to an owner`).not.toContain("useWebuiPluginWorkflows");
    }
  });

  it("saves through the same three paths, chosen by the open dialog", () => {
    // The submit handler picks by `dialog`: the MCP form, the skill form, the agent form. Sliced
    // from the first of the three to the end, because every other marker in this file (an
    // `aria-label`, a branch) occurs earlier and would make an empty window.
    const submit = itemDialog.slice(itemDialog.indexOf("? saveMcp()"));
    expect(submit).toContain("? saveMcp()");
    expect(submit).toContain("? saveSkill()");
    expect(submit).toContain(": saveAgent()");
  });
});

describe("a failed operation leaves the user where they were", () => {
  it("install failure preserves prior state", () => {
    // Closing and clearing live INSIDE the success branch: a rejection runs neither, so the dialog
    // stays open on the preview the user was reading.
    const body = slice(catalogue, "const importPlugin = async () => {", "// Switching the marketplace catalogue");
    expect(body).toContain('if (await mutate("importGithubPlugin"');
    const afterSuccess = body.slice(body.indexOf('if (await mutate("importGithubPlugin"'));
    expect(afterSuccess.indexOf("setPluginImportDialog(false)")).toBeGreaterThan(-1);
    expect(afterSuccess.indexOf("setPluginImportDialog(false)")).toBeLessThan(afterSuccess.indexOf("\n  };"));
    // And nothing in the wrapper closes before the mutation is awaited.
    expect(body.indexOf("setPluginImportDialog(false)")).toBeGreaterThan(body.indexOf("await mutate("));
  });

  it("preview failure preserves browse state", () => {
    const body = slice(catalogue, "const previewPlugin = async () => {", "const importPlugin = async () => {");
    // The preview is written on success...
    expect(body).toContain("setPluginPreview(result as Row)");
    // ...and the catch only records the message: the URL, the previous preview and the listing stay.
    const cat = body.slice(body.indexOf("catch (cause)"));
    expect(cat).toContain("setLocalError(");
    expect(cat).not.toContain("setPluginPreview");
    expect(cat).not.toContain("setPluginUrl");
    expect(cat).not.toContain("setArea");
    expect(cat).not.toContain("setView");
  });
});
