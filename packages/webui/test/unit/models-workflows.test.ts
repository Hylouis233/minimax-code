// Unit tests for the models workflow owner.
//
// These cases used to run against `settings-workflows.ts`, which published the
// model catalogue, the selection and the provider list without owning them. The
// owner moved, so its cases move with it; `settings-workflows.test.ts` keeps the
// settings ones. What is asserted here that could not be asserted before is the
// boundary: the owner keeps its own revision, and its one call into another
// business goes through that business's published command.

import { describe, expect, it, vi } from "vitest";

import type {
  WebuiModelEntry,
  WebuiModelProviderModelEntry,
  WebuiModelProviderView,
} from "../../src/shared/contracts/models.js";

import { createWebuiModelsWorkflows } from "../../src/client/features/models/application/models-workflows.js";
import {
  decodeWebuiProviderSaveOutcome,
  decodeWebuiProviderTestOutcome,
  unavailableWebuiProviderOutcome,
} from "../../src/client/features/models/contracts/provider-outcome.js";
import {
  buildWebuiModelSelectionRequest,
  webuiModelFromOptionValue,
  webuiModelOptionValue,
} from "../../src/client/features/models/contracts/model-selection.js";

const noStatusRefresh = async (): Promise<void> => {};

const build = (
  port: Parameters<typeof createWebuiModelsWorkflows>[0]["port"],
  refreshApiKeyStatus = noStatusRefresh,
) => createWebuiModelsWorkflows({ port, refreshApiKeyStatus });

/** A provider row shaped like the one the `listUserModelProviders` read returns. */
const providerRow = (
  overrides: Partial<WebuiModelProviderView> & { readonly providerId: string },
): WebuiModelProviderView => ({
  name: overrides.providerId,
  source: "custom",
  kind: "custom",
  enabled: true,
  hasApiKey: true,
  models: [],
  ...overrides,
});

const modelRow = (modelId: string, enabled: boolean): WebuiModelProviderModelEntry => ({
  providerId: "a",
  modelId,
  modelConfigId: modelId,
  displayName: modelId,
  enabled,
  selected: false,
});

describe("a provider change", () => {
  it("re-reads the provider list and marks the model list stale", async () => {
    let providers: readonly WebuiModelProviderView[] = [providerRow({ providerId: "a" })];
    const workflows = build({
      listUserModelProviders: async () => providers,
      createUserModelProvider: async () => {
        providers = [...providers, providerRow({ providerId: "b" })];
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
    let providers: readonly WebuiModelProviderView[] = [
      providerRow({ providerId: "a", models: [modelRow("m1", true)] }),
    ];
    const workflows = build({
      listUserModelProviders: async () => providers,
      updateUserModelProvider: async (body) => {
        providers = [
          providerRow({
            providerId: "a",
            models: (body.models ?? []).map((entry) => modelRow(entry.modelId, entry.enabled ?? true)),
          }),
        ];
        return { ok: true };
      },
    });

    await workflows.loadProviders();
    workflows.patchProviderModels("a", [modelRow("m1", false)]);
    expect(workflows.getSnapshot().providers.value?.[0]?.models[0]?.enabled).toBe(false);
  });

  it("reloads the truth when the write fails", async () => {
    const workflows = build({
      listUserModelProviders: async () => [
        providerRow({ providerId: "a", models: [modelRow("m1", true)] }),
      ],
      updateUserModelProvider: async () => Promise.reject(new Error("nope")),
    });

    await workflows.loadProviders();
    workflows.patchProviderModels("a", [modelRow("m1", false)]);
    await expect(workflows.updateProvider({ providerId: "a" })).rejects.toThrow("nope");
    expect(workflows.getSnapshot().providers.value?.[0]?.models[0]?.enabled).toBe(true);
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

// The keyed resources behind the owner.
//
// These are asserted through the owner's own public commands: keyed
// independence, freshness coverage across a write, and a disposed owner
// accepting nothing. The adversarial part is the scheduling — two reads in
// flight, resolved out of order — because that is the shape the old destination
// field failed.
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

describe("a provider operation answers with a typed outcome", () => {
  // The editor used to cast each result to a record and pick fields out of it,
  // which put "what counts as success" and "what does a refusal say" in the
  // surface, once per operation, unchecked. These are the three answers it can
  // now be given.
  it("separates a success from a refusal and from a revision conflict", () => {
    const ok = decodeWebuiProviderTestOutcome({ ok: true, status: { state: "ready" } });
    const refused = decodeWebuiProviderTestOutcome({
      ok: false,
      code: "invalid_api_key",
      message: "接口密钥无效",
    });
    const conflicted = decodeWebuiProviderSaveOutcome({
      success: false,
      code: "revision_conflict",
      message: "已被更新",
    });

    expect(ok.outcome).toBe("success");
    expect(refused.outcome).toBe("refusal");
    expect(conflicted.outcome).toBe("conflict");
  });

  it("keeps an unknown error code rather than collapsing it to one failure", () => {
    // A runtime that raises a code of its own has said something more precise
    // than "harness error". The editor shows the runtime's own message, so a
    // code this build has not heard of must survive to the branch that uses it.
    const outcome = decodeWebuiProviderTestOutcome({
      ok: false,
      code: "provider_quota_exhausted",
      message: "该提供商额度已用尽",
    });
    expect(outcome.outcome).toBe("refusal");
    if (outcome.outcome !== "refusal") throw new Error("unreachable");
    expect(outcome.code).toBe("provider_quota_exhausted");
    expect(outcome.message).toBe("该提供商额度已用尽");
  });

  it("keeps the extension fields the runtime sent", () => {
    // The editor passes a candidate through to a save, so a runtime field this
    // build has not named yet still belongs to the answer. Decoding to a closed
    // shape would drop it, and the next runtime version would look like data
    // loss rather than an addition.
    const outcome = decodeWebuiProviderTestOutcome({
      ok: true,
      models: [{ modelId: "m1", contextWindowTokens: 128000 }],
      status: { state: "ready", fetchedAtMs: 1 },
      traceId: "trace-7",
    });
    expect(outcome.outcome).toBe("success");
    if (outcome.outcome !== "success") throw new Error("unreachable");
    expect(outcome.models[0]).toMatchObject({ modelId: "m1", contextWindowTokens: 128000 });
    expect(outcome.status).toMatchObject({ fetchedAtMs: 1 });
    expect(outcome.traceId).toBe("trace-7");
  });

  it("reads the reason from wherever the runtime put it", () => {
    // A test that answered with a cache status has the reason on that status;
    // one that did not has it at the top. Defaulting both to a generic
    // "连接失败" would throw away the only useful part of the answer.
    const fromStatus = decodeWebuiProviderTestOutcome({
      ok: false,
      status: { lastErrorMessage: "bad key" },
    });
    const fromTop = decodeWebuiProviderTestOutcome({
      ok: false,
      message: "连接超时",
    });
    expect(fromStatus.outcome === "refusal" && fromStatus.message).toBe("bad key");
    expect(fromTop.outcome === "refusal" && fromTop.message).toBe("连接超时");
  });

  it("treats a stale base as a conflict, not as a refusal", () => {
    // They want opposite follow-up: a refusal is the user's draft being
    // rejected, a conflict is the editor's base being out of date and retrying
    // unchanged would overwrite someone else's edit.
    const outcome = decodeWebuiProviderSaveOutcome({
      success: false,
      skippedTest: true,
      status: { state: "stale" },
    });
    expect(outcome.outcome).toBe("conflict");
  });

  it("answers an operation this build cannot run as a capability refusal", () => {
    // The fallback editor used to answer `undefined` and rely on the editor
    // noticing, which made "unsupported" and "refused" the same absence — and
    // the one the user must never retry was the one the panel could offer.
    const outcome = unavailableWebuiProviderOutcome("当前运行时不支持模型测试。");
    expect(outcome.outcome).toBe("refusal");
    if (outcome.outcome !== "refusal") throw new Error("unreachable");
    expect(outcome.code).toBe("capability_unavailable");
  });
});

describe("the model-selection request is built by Models", () => {
  it("lets a per-pick override replace the model's projection", () => {
    const model: WebuiModelEntry = {
      providerId: "p",
      modelId: "m",
      variant: "thinking",
      contextLimit: 64000,
    };
    expect(buildWebuiModelSelectionRequest(model, {})).toEqual({
      providerId: "p",
      modelId: "m",
      variant: "thinking",
      contextLimit: 64000,
    });
    expect(
      buildWebuiModelSelectionRequest(model, { variant: "", contextLimit: 128000 }),
    ).toEqual({ providerId: "p", modelId: "m", variant: "", contextLimit: 128000 });
  });

  it("keeps an empty variant, which is how thinking is turned off", () => {
    // Treated as absence, the model's default would stay in force: the picker
    // would appear to accept the choice and the model would behave as before.
    const model: WebuiModelEntry = { providerId: "p", modelId: "m", variant: "thinking" };
    const request = buildWebuiModelSelectionRequest(model, { variant: "" });
    expect(request.variant).toBe("");
    expect("variant" in request).toBe(true);
  });

  it("round-trips a model through its option value", () => {
    // Two halves of one round trip, so they live beside each other: a value
    // written by one and read by the other is where the trailing-slash bug is.
    const model: WebuiModelEntry = { providerId: "p", modelId: "m", variant: "fast" };
    const plain: WebuiModelEntry = { providerId: "p", modelId: "m" };
    expect(webuiModelOptionValue(model)).toBe("p/m/fast");
    // The trailing variant is kept even when empty so the lookup after a change
    // selects the entry the user actually chose.
    expect(webuiModelOptionValue(plain)).toBe("p/m/");
    expect(webuiModelFromOptionValue([model, plain], "p/m/")).toBe(plain);
  });
});
