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

import type { WebuiModelEntry } from "../../src/shared/contracts/models.js";

import { createWebuiModelsWorkflows } from "../../src/client/features/models/application/models-workflows.js";

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

    await workflows.createProvider({ baseUrl: "https://example.test", apiKey: "sk-test" });
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
        providers = [{ providerId: "a", models: body.models as readonly WebuiModelEntry[] }];
        return { ok: true };
      },
    });

    await workflows.loadProviders();
    workflows.patchProviderModels("a", [{ modelId: "m1", enabled: false }]);
    expect(
      (workflows.getSnapshot().providers.value?.[0]?.models as readonly WebuiModelEntry[])[0]
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
      (workflows.getSnapshot().providers.value?.[0]?.models as readonly WebuiModelEntry[])[0]
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

// The keyed resources behind the owner (T03; plan §4.5, §3 P3).
//
// These are the ticket's criterion-6 claims asserted through the owner's own
// public commands: keyed independence, freshness coverage across a write, and a
// disposed owner accepting nothing. The adversarial part is the scheduling —
// two reads in flight, resolved out of order — because that is the shape the old
// destination field failed.
describe("the catalogue is keyed, not one destination", () => {
  const model = (modelId: string) => ({ modelId }) as unknown as WebuiModelEntry;

  it("keeps a late answer for another session out of the shown catalogue", async () => {
    let resolveA!: (value: readonly WebuiModelEntry[]) => void;
    const slowA = new Promise<readonly WebuiModelEntry[]>((resolve) => {
      resolveA = resolve;
    });
    const workflows = build({
      listModels: async (request) =>
        request?.sessionId === "A" ? slowA : [model("b")],
    });

    const pendingA = workflows.loadModels("A");
    await workflows.loadModels("B");
    expect(workflows.getSnapshot().models.value).toEqual([model("b")]);

    resolveA([model("a")]);
    await pendingA;

    // A's answer landed in A's own entry: the shown catalogue is still B's, which
    // is the invariant the old seam could not state.
    expect(workflows.getSnapshot().models.value).toEqual([model("b")]);
  });

  it("refuses a catalogue answer that was in flight when a provider write retired it", async () => {
    let resolveRead!: (value: readonly WebuiModelEntry[]) => void;
    const slow = new Promise<readonly WebuiModelEntry[]>((resolve) => {
      resolveRead = resolve;
    });
    const workflows = build({
      listModels: () => slow,
      listUserModelProviders: async () => [],
      createUserModelProvider: async () => ({ ok: true }),
    });

    const pending = workflows.loadModels();
    expect(workflows.getSnapshot().models.status).toBe("loading");

    await workflows.createProvider({ baseUrl: "https://example.test", apiKey: "sk-test" });
    resolveRead([model("stale")]);
    await pending;

    // The write advanced the configuration generation and retired the answer, so
    // the pre-write read never becomes the current catalogue.
    expect(workflows.getSnapshot().models.value).toBeUndefined();
  });

  it("accepts nothing after disposal", async () => {
    let resolveRead!: (value: readonly WebuiModelEntry[]) => void;
    const slow = new Promise<readonly WebuiModelEntry[]>((resolve) => {
      resolveRead = resolve;
    });
    const workflows = build({ listModels: () => slow });

    const pending = workflows.loadModels();
    workflows.dispose();
    resolveRead([model("late")]);
    await pending;

    expect(workflows.getSnapshot().models.value).toBeUndefined();
  });
});
