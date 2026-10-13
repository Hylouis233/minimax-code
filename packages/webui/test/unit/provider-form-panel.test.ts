// The provider form's lifecycle conditions, pinned where they can go red (ticket #71; plan §5.7).
//
// The split moved a branch's JSX into `components/models/ProviderFormPanel.tsx`. What the plan
// requires to be *unchanged* is not the file layout but the lifetime (§5.7 LC-1…LC-6), and every one
// of those conditions is a fact about which module holds a declaration — so each is asserted against
// the source, where moving it back turns the case red:
//
//   LC-1  the panel renders inside the same `sourceTab === "custom"` conditional it occupied
//   LC-2  the session-keyed preload effect stays in the parent, still keyed on `[sessionId]`
//   LC-3  the parent keeps its quota clock, and the Codex OAuth poll is the Account
//         owner's (T09): the surface acquires an interest, the owner owns the timer
//   LC-4  the provider drafts are parent state
//   LC-6  `ProviderPresetPicker` still resets on unmount (it lives inside the form's conditional)
//
// The drafts editor's counterpart (the picker's two regions) is pinned by the picker's own suites.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT = new URL("../../src/client/components/", import.meta.url);
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, CLIENT)), "utf8");

const parent = read("settings/UsageModelSettings.tsx");
const accountOwner = readFileSync(
  fileURLToPath(
    new URL("../../src/client/features/account/application/account-workflows.ts", import.meta.url),
  ),
  "utf8",
);
const panel = read("models/ProviderFormPanel.tsx");

/** The slice from one marker to the next, so an assertion cannot be satisfied from elsewhere. */
const between = (text: string, from: string, to: string): string =>
  text.slice(text.indexOf(from), text.indexOf(to));

describe("the parent keeps the lifetime", () => {
  it("LC-2 keeps the session-keyed preload in the parent", () => {
    const effect = between(parent, "useEffect(() => {", "}, [sessionId]);");
    expect(effect).toContain("account?.loadUsage()");
    // The credential-status reads belong to the Account owner (T09).
    expect(effect).toContain("account?.loadApiKeyStatus()");
    expect(effect).toContain("models?.loadProviders()");
    expect(effect).toContain("settings?.loadModelSource()");
    expect(effect).toContain("account?.loadCodexOAuthStatus()");
    expect(parent).toContain("}, [sessionId]);");
    // and NOT in the panel: a panel-side preload would run per mount
    expect(panel).not.toContain("loadProviders()");
    expect(panel).not.toContain("useEffect(");
  });

  it("LC-3 keeps the quota clock in the parent and the OAuth poll in its owner", () => {
    expect(parent).toContain("setInterval(() => setQuotaClock(Date.now()), 1000)");
    expect(parent).toContain("clearInterval(timer)");
    // The surface asks the owner for the poll instead of running its own timer,
    // and releases it on unmount.
    expect(parent).toContain("return account.acquireCodexOAuthPolling();");
    expect(parent).not.toContain("setInterval(() => { void settings.loadCodexOAuthStatus(); }, 1000)");
    // The timer itself lives in the Account owner, with its own cleanup.
    expect(accountOwner).toContain("setInterval(");
    expect(accountOwner).toContain("clearInterval(codexPollTimer)");
    expect(panel).not.toContain("setInterval(");
  });

  it("LC-4 keeps the provider drafts as parent state", () => {
    for (const declaration of [
      'useState("")', // draftName / draftBaseUrl / draftApiKey / draftModelId
      'useState("openai-completions")', // draftApiFormat
      "useState<readonly ProviderHeaderDraft[]>([])",
      "useState(false)", // draftTested / skipTest
    ]) {
      expect(parent).toContain(declaration);
    }
    expect(parent).toContain("setDraftName={setDraftName}");
    expect(parent).toContain("setDraftHeaders={setDraftHeaders}");
    // The panel reads them and writes them back; it never declares them.
    expect(panel).not.toMatch(/const \[draft[A-Z]/u);
  });

  it("LC-1 renders the panel in the branch it occupied, and only there", () => {
    // Anchored on the branch's own testid: `sourceTab === "custom"` also appears in the tab
    // button's className, and a slice from there would assert about the wrong region.
    // From the branch's own testid to the end of the module: `</section> : null}` closes the
    // token-plan branch first, so slicing to the FIRST one of those would assert about that one.
    const branch = parent.slice(parent.indexOf('data-testid="settings-custom-models-panel"'));
    expect(branch).toContain("<ProviderFormPanel");
    expect(parent.match(/<ProviderFormPanel/gu) ?? []).toHaveLength(1);
    // The OAuth surface is `settings`' (§5.6), so it stayed in the parent, after the panel.
    expect(branch.indexOf("<ProviderFormPanel")).toBeLessThan(branch.indexOf("Codex OAuth"));
  });
});

describe("the panel keeps the reset boundary", () => {
  it("LC-6 keeps ProviderPresetPicker inside the form's conditional", () => {
    // Its `open`/`query` reset when the enclosing subtree unmounts, which is today's behaviour.
    // Hoisting the picker out of `{!editingProvider ? … : null}`, or out of the dialog, would make
    // its state survive a close and the case goes red.
    const form = between(panel, "webui-provider-form-body", "webui-provider-form-actions");
    expect(form).toContain("{!editingProvider ?");
    expect(form.indexOf("ProviderPresetPicker")).toBeGreaterThan(form.indexOf("{!editingProvider ?"));
    // The dialog itself is still conditional on `showProviderForm`, and still a portal.
    expect(panel).toContain("{showProviderForm && portalTarget ? createPortal(");
    expect(panel).toContain("function ProviderPresetPicker(");
  });

  it("invokes the provider commands it is handed, and owns none of them", () => {
    expect(panel).toContain("commands.patchProviderModels(");
    expect(panel).toContain("commands.updateProvider(");
    expect(panel).toContain("commands.saveCandidate(");
    expect(panel).not.toContain("useWebuiSettingsWorkflows");
    expect(panel).not.toContain("application/");
  });
});
