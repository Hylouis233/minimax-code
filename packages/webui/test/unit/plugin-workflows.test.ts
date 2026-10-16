// Unit tests for the plugin workflow owner.
//
// The owner is framework-free, so these run the real decision logic the plugin
// manager delegates to: that a superseded listing answer is dropped rather than
// applied over a newer selection, and that a mutation reloads exactly the
// listing it affects.

import { describe, expect, it, vi } from "vitest";

import {
  createWebuiPluginWorkflows,
  initialWebuiPluginSelection,
} from "../../src/client/features/plugins/application/plugin-workflows.js";
import type { WebuiPluginIntent } from "../../src/client/features/plugins/contracts/plugin-actions.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the plugin listing has one owner", () => {
  it("drops a listing answer for a selection the owner has left", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let call = 0;
    const workflows = createWebuiPluginWorkflows({
      port: {
        pluginManagement: (request) => {
          if (request.action !== "listInstalledPlugins") return Promise.resolve({ plugins: [] });
          call += 1;
          if (call === 1) {
            return new Promise((resolve) => {
              resolveFirst = resolve;
            });
          }
          return Promise.resolve({ plugins: [{ name: "second" }] });
        },
      },
    });

    void workflows.loadListing({ ...initialWebuiPluginSelection, view: "personal" });
    await workflows.loadListing({ ...initialWebuiPluginSelection, view: "personal", query: "b" });
    resolveFirst({ plugins: [{ name: "first" }] });
    await flush();

    expect(workflows.getSnapshot().listing.rows.map((row) => row.name)).toEqual(["second"]);
  });

  it("records a missing capability as one error, not a silent empty", async () => {
    const workflows = createWebuiPluginWorkflows({ port: {} });
    await workflows.loadListing(initialWebuiPluginSelection);
    expect(workflows.getSnapshot().listing.error).toBe(
      "Plugin management is not connected to the runtime",
    );
  });

  it("merges marketplace rows with installed state for the market view", async () => {
    const workflows = createWebuiPluginFold();
    await workflows.loadListing(initialWebuiPluginSelection);
    const rows = workflows.getSnapshot().listing.rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.name === "installed")?.installed).toBe(true);
    expect(workflows.getSnapshot().listing.pluginTotal).toBe(2);
  });
});

function createWebuiPluginFold() {
  return createWebuiPluginWorkflows({
    port: {
      pluginManagement: (request) => {
        if (request.action === "listMarketplacePlugins") {
          return Promise.resolve({
            plugins: [{ name: "installed" }, { name: "free" }],
            pluginTotal: 2,
          });
        }
        return Promise.resolve({ plugins: [{ name: "installed", source: 1 }] });
      },
    },
  });
}

describe("a plugin mutation invalidates exactly what it affects", () => {
  it("reloads the listing and bumps the revision after a mutation", async () => {
    let installed = false;
    const reloads: string[] = [];
    const workflows = createWebuiPluginWorkflows({
      port: {
        pluginManagement: (request) => {
          if (request.action === "listInstalledPlugins") {
            reloads.push("list");
            return Promise.resolve({ plugins: installed ? [{ name: "p" }] : [] });
          }
          installed = true;
          return Promise.resolve({ ok: true });
        },
      },
    });

    await workflows.loadListing({ ...initialWebuiPluginSelection, view: "personal" });
    expect(workflows.getSnapshot().listing.rows).toHaveLength(0);
    const before = workflows.getSnapshot().revision;

    await workflows.installPlugin({ pluginName: "p" });
    expect(workflows.getSnapshot().revision).toBe(before + 1);
    expect(workflows.getSnapshot().listing.rows).toHaveLength(1);
    expect(reloads.length).toBeGreaterThanOrEqual(2);
  });

  it("sends the named action for a named command", async () => {
    const actions: string[] = [];
    const workflows = createWebuiPluginWorkflows({
      port: {
        pluginManagement: (request) => {
          actions.push(request.action);
          return Promise.resolve({});
        },
      },
    });

    await workflows.loadListing({ ...initialWebuiPluginSelection, view: "personal" });
    await workflows.setSkillEnabled({ skillName: "s", enabled: false });
    expect(actions).toContain("setSkillEnabled");
  });

  it("forwards every supported UI intent to its named command with the declared fields", async () => {
    const requests: { action: string; input?: Record<string, unknown> }[] = [];
    const workflows = createWebuiPluginWorkflows({
      port: {
        pluginManagement: (request) => {
          requests.push(request);
          return Promise.resolve({});
        },
      },
    });
    const intents: readonly WebuiPluginIntent[] = [
      { kind: "installPlugin", pluginName: "p", source: 1 },
      { kind: "uninstallPlugin", pluginName: "p", source: 2 },
      { kind: "enablePlugin", pluginName: "p", source: 3 },
      { kind: "disablePlugin", pluginName: "p", source: 4 },
      {
        kind: "importGithubPlugin",
        source: { repositoryUrl: "https://github.com/o/r", commitSha: "abc" },
      },
      {
        kind: "installSkill",
        url: "https://example.invalid/skill",
        displayName: "Skill",
        publisherSourceType: 7,
        isFromGit: true,
        creatorInfo: { name: "Publisher" },
      },
      { kind: "createSkill", name: "s", description: "d", content: "c" },
      { kind: "setSkillEnabled", skillName: "s", enabled: false, locationUri: "file:///s" },
      { kind: "deleteSkill", skillName: "s", locationUri: "file:///s" },
      { kind: "createMcpServer", name: "m", config: { command: "run" }, enabled: false },
      { kind: "updateMcpServer", name: "m", config: { command: "run2" } },
      { kind: "deleteMcpServer", name: "m" },
      { kind: "setMcpServerEnabled", name: "m", enabled: true },
      { kind: "testMcpServer", name: "m" },
      { kind: "createAgent", name: "a", displayName: "Agent", initialDefinition: { name: "a", description: "d", systemPrompt: "p" } },
      { kind: "updateAgent", name: "a", systemPrompt: "updated" },
      { kind: "deleteAgent", name: "a" },
    ];

    for (const intent of intents) await workflows.runIntent(intent);

    expect(
      requests
        .filter((request) => !request.action.startsWith("list"))
        .map(({ action, input }) => ({ action, input })),
    ).toEqual([
      { action: "installPlugin", input: { pluginName: "p", source: 1 } },
      { action: "uninstallPlugin", input: { pluginName: "p", source: 2 } },
      { action: "enablePlugin", input: { pluginName: "p", source: 3 } },
      { action: "disablePlugin", input: { pluginName: "p", source: 4 } },
      { action: "importGithubPlugin", input: { source: { repositoryUrl: "https://github.com/o/r", commitSha: "abc" } } },
      { action: "installSkill", input: { url: "https://example.invalid/skill", displayName: "Skill", publisherSourceType: 7, isFromGit: true, creatorInfo: { name: "Publisher" } } },
      { action: "createSkill", input: { name: "s", description: "d", content: "c" } },
      { action: "setSkillEnabled", input: { skillName: "s", enabled: false, locationUri: "file:///s" } },
      { action: "deleteSkill", input: { skillName: "s", locationUri: "file:///s" } },
      { action: "createMcpServer", input: { name: "m", config: { command: "run" }, enabled: false } },
      { action: "updateMcpServer", input: { name: "m", config: { command: "run2" } } },
      { action: "deleteMcpServer", input: { name: "m" } },
      { action: "setMcpServerEnabled", input: { name: "m", enabled: true } },
      { action: "testMcpServer", input: { name: "m" } },
      { action: "createAgent", input: { name: "a", displayName: "Agent", initialDefinition: { name: "a", description: "d", systemPrompt: "p" } } },
      { action: "updateAgent", input: { name: "a", systemPrompt: "updated" } },
      { action: "deleteAgent", input: { name: "a" } },
    ]);
  });

  it("surfaces a mutation failure to the caller without a phantom reload", async () => {
    const reload = vi.fn(() => Promise.resolve({}));
    const workflows = createWebuiPluginWorkflows({
      port: {
        pluginManagement: (request) =>
          request.action === "deleteAgent"
            ? Promise.reject(new Error("in use"))
            : reload(),
      },
    });

    await workflows.loadListing(initialWebuiPluginSelection);
    await expect(workflows.runIntent({ kind: "deleteAgent", name: "a" })).rejects.toThrow("in use");
    // One owner records the failure, so no call site keeps its own copy.
    expect(workflows.getSnapshot().mutationError).toBe("in use");
    expect(workflows.getSnapshot().mutating).toBe(false);
  });

  it("clears the recorded failure when the next mutation starts", async () => {
    let fail = true;
    const workflows = createWebuiPluginWorkflows({
      port: {
        pluginManagement: (request) => {
          if (request.action === "deleteAgent") {
            return fail ? Promise.reject(new Error("in use")) : Promise.resolve({});
          }
          return Promise.resolve({ plugins: [] });
        },
      },
    });

    await workflows.loadListing({ ...initialWebuiPluginSelection, view: "personal" });
    await expect(workflows.deleteAgent({ name: "a" })).rejects.toThrow("in use");
    expect(workflows.getSnapshot().mutationError).toBe("in use");
    fail = false;
    await workflows.deleteAgent({ name: "a" });
    expect(workflows.getSnapshot().mutationError).toBeUndefined();
  });
});
