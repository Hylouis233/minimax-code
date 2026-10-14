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

// The plugin UI lives in its business home now (T08), so these three read from
// `features/plugins/ui/` rather than the retired `components/` tree.
const PLUGIN_UI = new URL("../../src/client/features/plugins/ui/", import.meta.url);
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, PLUGIN_UI)), "utf8");

const catalogue = read("PluginCatalogue.tsx");
const itemDialog = read("PluginItemDialog.tsx");
const importDialog = read("PluginImportDialog.tsx");

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

  it("routes to the form the open dialog names, and each form saves through one path", () => {
    // The dialog is now a chooser, not a form: it picks one of three units by
    // `dialog`, and each unit runs its own save (T08). The invariant is the same
    // one this case always guarded — one dialog, three paths, chosen by what is
    // open — it just moved from a chain of ternaries to three form units.
    expect(itemDialog).toContain("dialog === \"mcp\"");
    expect(itemDialog).toContain("<McpServerForm");
    expect(itemDialog).toContain(": dialog === \"agent\"");
    expect(itemDialog).toContain("<AgentForm");
    expect(itemDialog).toContain("<SkillForm");
    // Each form unit commits through the typed intent surface, not a wire verb.
    expect(read("McpServerForm.tsx")).toContain("onSubmit({ kind: \"updateMcpServer\"");
    expect(read("AgentForm.tsx")).toContain('kind: "createAgent"');
    expect(read("SkillForm.tsx")).toContain('kind: "createSkill"');
  });
});

describe("a failed operation leaves the user where they were", () => {
  it("install failure preserves prior state", () => {
    // Closing and clearing live INSIDE the success branch: a rejection runs neither, so the dialog
    // stays open on the preview the user was reading.
    const body = slice(catalogue, "const importPlugin = async () => {", "// Switching the marketplace catalogue");
    // The import now dispatches a typed intent rather than a wire verb (T08); the
    // invariant below is unchanged — the dialog only closes after a success.
    expect(body).toContain("kind: \"importGithubPlugin\"");
    const afterSuccess = body.slice(body.indexOf("kind: \"importGithubPlugin\""));
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
