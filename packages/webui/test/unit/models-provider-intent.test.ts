// The Models owner's provider mutations.
//
// The row this answers (V10) asks for owner-captured semantic intent, applied to
// the owner's current pending projection and serialized per provider, with earlier
// responses and reloads unable to erase later pending intent. It is deliberately
// not a test of a rendering path: the whole defect was a *caller* building a model
// array from rendered props, so these cases call the owner's commands the way the
// panel now does — by intent.

import { describe, expect, it, vi } from "vitest";

import { createWebuiModelsWorkflows } from "../../src/client/features/models/application/models-workflows.js";
import { WebuiRefusedError } from "../../src/client/conversation/request-freshness.js";

/** Let the write chain's queued steps run: the owner opens the write in a microtask. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
};

const provider = (models: readonly { modelId: string; enabled?: boolean }[]) => ({
  providerId: "p1",
  name: "P1",
  models: models.map((model) => ({ ...model })),
});

function workflowsWith(port: Record<string, unknown>) {
  return createWebuiModelsWorkflows({
    port: port as never,
    refreshApiKeyStatus: async () => undefined,
  });
}

describe("V10 · provider intent is the owner's, not the caller's array", () => {
  it("applies a toggle to the owner's pending projection and shows it", async () => {
    const update = deferred<unknown>();
    let models = [provider([{ modelId: "m1", enabled: false }, { modelId: "m2", enabled: true }])];
    const workflows = workflowsWith({
      // A live runtime serves the list it accepted; a fixture that kept serving the
      // pre-write list would make "the reload is the truth" mean "the reload is the
      // old value".
      listUserModelProviders: async () => models,
      updateUserModelProvider: (body: { models: readonly { modelId: string; enabled?: boolean }[] }) => {
        models = [provider(body.models)];
        return update.promise;
      },
      listModels: async () => [],
    });
    await workflows.loadProviders();

    const pending = workflows.setProviderModelEnabled({
      providerId: "p1",
      modelId: "m1",
      enabled: true,
    });
    await flush();
    // The intent is applied to the owner's own state as soon as the write opens,
    // without waiting for the runtime to answer.
    const shown = workflows.getSnapshot().providers.value?.[0]?.models ?? [];
    expect(shown.map((model) => model.enabled)).toEqual([true, true]);

    update.resolve({ success: true });
    await pending;
    const settled = workflows.getSnapshot().providers.value?.[0]?.models ?? [];
    expect(settled.map((model) => model.enabled)).toEqual([true, true]);
  });

  it("serializes two writes to one provider and keeps the later intent", async () => {
    const order: string[] = [];
    const first = deferred<unknown>();
    let models = [provider([{ modelId: "m1", enabled: false }, { modelId: "m2", enabled: false }])];
    const workflows = workflowsWith({
      // A live runtime reflects the write it accepted; a fixture that keeps
      // serving the pre-write list would test a reload that never happens.
      listUserModelProviders: async () => models,
      updateUserModelProvider: (body: { models: readonly { modelId: string; enabled?: boolean }[] }) => {
        order.push(body.models.map((model) => `${model.modelId}:${model.enabled}`).join(","));
        models = [provider(body.models)];
        return order.length === 1 ? first.promise : Promise.resolve({ success: true });
      },
      listModels: async () => [],
    });
    await workflows.loadProviders();

    const one = workflows.setProviderModelEnabled({ providerId: "p1", modelId: "m1", enabled: true });
    const two = workflows.setProviderModelEnabled({ providerId: "p1", modelId: "m2", enabled: true });
    await flush();
    // Only the first write is in flight; the second waits.
    expect(order).toHaveLength(1);

    first.resolve({ success: true });
    await one;
    await two;
    expect(order).toEqual(["m1:true,m2:false", "m1:true,m2:true"]);
  });

  it("does not serialize across providers", async () => {
    const order: string[] = [];
    const gate = deferred<unknown>();
    const two = [
      provider([{ modelId: "m1", enabled: false }]),
      { providerId: "p2", name: "P2", models: [{ modelId: "n1", enabled: false }] },
    ];
    const workflows = workflowsWith({
      listUserModelProviders: async () => two,
      updateUserModelProvider: (body: { providerId: string }) => {
        order.push(body.providerId);
        return body.providerId === "p1" ? gate.promise : Promise.resolve({ success: true });
      },
      listModels: async () => [],
    });
    await workflows.loadProviders();

    const a = workflows.setProviderModelEnabled({ providerId: "p1", modelId: "m1", enabled: true });
    const b = workflows.setProviderModelEnabled({ providerId: "p2", modelId: "n1", enabled: true });
    await flush();

    // Different resources stay independent: the second provider's change did not
    // wait behind the first provider's pending write.
    expect(order).toEqual(["p1", "p2"]);
    gate.resolve({ success: true });
    await a;
    await b;
  });

  it("reorder resolves identities against the owner's list, ignoring ones it does not hold", async () => {
    const sent: string[] = [];
    const models = [
      provider([{ modelId: "m1" }, { modelId: "m2" }, { modelId: "m3" }]),
    ];
    const workflows = workflowsWith({
      listUserModelProviders: async () => models,
      updateUserModelProvider: (body: { models: readonly { modelId: string }[] }) => {
        sent.push(body.models.map((model) => model.modelId).join(","));
        return Promise.resolve({ success: true });
      },
      listModels: async () => [],
    });
    await workflows.loadProviders();

    // An identity that is gone makes the reorder a no-op rather than a write that
    // silently drops a model.
    const ignored = await workflows.reorderProviderModels({
      providerId: "p1",
      orderedModelIds: ["m3", "m1", "gone"],
    });
    expect(ignored.status).toBe("settled");
    expect(sent).toEqual([]);

    await workflows.reorderProviderModels({ providerId: "p1", orderedModelIds: ["m3", "m1", "m2"] });
    expect(sent).toEqual(["m3,m1,m2"]);
  });

  it("keeps the committed list when the runtime refuses the write", async () => {
    const models = [provider([{ modelId: "m1", enabled: false }])];
    const workflows = workflowsWith({
      listUserModelProviders: async () => models,
      updateUserModelProvider: async () => {
        // The runtime's own refusal, which is what the classifier keys on.
        throw new WebuiRefusedError("runtime refused");
      },
      listModels: async () => [],
    });
    await workflows.loadProviders();

    const outcome = await workflows.setProviderModelEnabled({
      providerId: "p1",
      modelId: "m1",
      enabled: true,
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.category).toBe("refused");
    // A refusal is a settled verdict: the change is not left on screen as if it had
    // happened.
    expect(workflows.getSnapshot().providers.value?.[0]?.models?.[0]?.enabled).toBe(false);
  });

  it("has no command that takes a caller-built model array", () => {
    const workflows = workflowsWith({ listModels: async () => [] });
    // The removed API is the defect: a replacement array came from rendered props
    // and could resurrect a list the owner had already changed.
    expect("patchProviderModels" in workflows).toBe(false);
    expect(vi.isMockFunction(workflows.setProviderModelEnabled)).toBe(false);
  });
});
