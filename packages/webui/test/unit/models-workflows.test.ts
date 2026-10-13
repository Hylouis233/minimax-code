// Unit tests for the models workflow owner (plan §5.6's `models` row; §5.7's
// provider-form attribution).
//
// These cases used to run against `settings-workflows.ts`, which published the
// model catalogue, the selection and the provider list without owning them. The
// owner moved, so its cases move with it; `settings-workflows.test.ts` keeps the
// settings ones. What is asserted here that could not be asserted before is the
// boundary: the owner keeps its own revision, and its one call into another
// business goes through that business's published command.

import { describe, expect, it, vi } from "vitest";

import { createWebuiModelsWorkflows } from "../../src/client/application/models/models-workflows.js";

const noStatusRefresh = async (): Promise<void> => {};

const build = (
  port: Parameters<typeof createWebuiModelsWorkflows>[0]["port"],
  refreshApiKeyStatus = noStatusRefresh,
) => createWebuiModelsWorkflows({ port, refreshApiKeyStatus });

describe("a provider change", () => {
  it("re-reads the provider list and marks the model list stale", async () => {
    let providers: readonly Record<string, unknown>[] = [{ providerId: "a" }];
    const workflows = build({
      listUserModelProviders: async () => providers,
      createUserModelProvider: async () => {
        providers = [...providers, { providerId: "b" }];
        return { ok: true };
      },
    });

    await workflows.loadProviders();
    expect(workflows.getSnapshot().providers.value).toHaveLength(1);
    const before = workflows.getSnapshot().modelsRevision;

    await workflows.createProvider({ providerId: "b" });
    expect(workflows.getSnapshot().providers.value).toHaveLength(2);
    expect(workflows.getSnapshot().modelsRevision).toBe(before + 1);
  });
});

describe("an optimistic provider patch stays the owner's", () => {
  it("shows the patched models at once and the reload is the truth", async () => {
    let providers: readonly Record<string, unknown>[] = [
      { providerId: "a", models: [{ modelId: "m1", enabled: true }] },
    ];
    const workflows = build({
      listUserModelProviders: async () => providers,
      updateUserModelProvider: async (body) => {
        providers = [{ providerId: "a", models: body.models as readonly Record<string, unknown>[] }];
        return { ok: true };
      },
    });

    await workflows.loadProviders();
    workflows.patchProviderModels("a", [{ modelId: "m1", enabled: false }]);
    expect(
      (workflows.getSnapshot().providers.value?.[0]?.models as readonly Record<string, unknown>[])[0]
        ?.enabled,
    ).toBe(false);
  });

  it("reloads the truth when the write fails", async () => {
    const workflows = build({
      listUserModelProviders: async () => [
        { providerId: "a", models: [{ modelId: "m1", enabled: true }] },
      ],
      updateUserModelProvider: async () => Promise.reject(new Error("nope")),
    });

    await workflows.loadProviders();
    workflows.patchProviderModels("a", [{ modelId: "m1", enabled: false }]);
    await expect(workflows.updateProvider({ providerId: "a" })).rejects.toThrow("nope");
    expect(
      (workflows.getSnapshot().providers.value?.[0]?.models as readonly Record<string, unknown>[])[0]
        ?.enabled,
    ).toBe(true);
  });
});

describe("the selection", () => {
  it("re-reads the list and bumps this owner's revision", async () => {
    const selectModel = vi.fn(async () => ({ success: true }));
    const workflows = build({
      listModels: async () => [{ providerId: "a", modelId: "m1", selected: true } as never],
      selectModel,
    });

    await workflows.loadModels("s1");
    const before = workflows.getSnapshot().modelsRevision;
    await workflows.selectModel({ providerId: "a", modelId: "m2", sessionId: "s1" });

    expect(selectModel).toHaveBeenCalledWith({ providerId: "a", modelId: "m2", sessionId: "s1" });
    expect(workflows.getSnapshot().modelsRevision).toBe(before + 1);
    expect(workflows.getSnapshot().models.value).toHaveLength(1);
  });
});

describe("writing a provider key", () => {
  it("refreshes settings' api-key status through that owner's published command", async () => {
    const refresh = vi.fn(async () => undefined);
    const workflows = build({ upsertMiniMaxApiKey: async () => ({ ok: true }) }, refresh);

    await workflows.upsertApiKey({ apiKey: "k", saveAndUse: true });

    // The write is models'; the status it invalidates is settings'. The carriage
    // is that owner's command, not a private copy of the read.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(workflows.getSnapshot().modelsRevision).toBe(1);
  });

  it("leaves the api-key status to the owner that holds it", () => {
    const workflows = build({ upsertMiniMaxApiKey: async () => ({ ok: true }) });
    expect(Object.keys(workflows.getSnapshot())).not.toContain("apiKeyStatus");
    expect(workflows).not.toHaveProperty("loadApiKeyStatus");
  });
});
