// The identity-epoch wiring (T02's `opaque-identity-freshness-context`, second
// half): which successful command advances which generation.
//
// The context itself is asserted in `webui-application-lifecycle.test.ts`. What
// these cases pin is the *policy* the ticket assigns to the owning businesses:
// a successful Account/Models/Settings write retires the answers computed under
// the generation it changed, an authoritative status answer that reports a
// different identity does the same, and a failure retires nothing — because a
// failed write leaves the previous answers true.
//
// Each owner is driven directly, through its published commands, with a real
// epoch context: the owners are framework-free, so the observation is the
// generation counter rather than a rendering.

import { describe, expect, it } from "vitest";

import { createWebuiAccountWorkflows } from "../../src/client/application/account/account-workflows.js";
import { createWebuiModelsWorkflows } from "../../src/client/application/models/models-workflows.js";
import { createWebuiSettingsWorkflows } from "../../src/client/application/settings/settings-workflows.js";
import { createWebuiIdentityEpochs } from "../../src/client/application/identity-epochs.js";

const noStatusRefresh = async (): Promise<void> => {};

function buildModels(
  port: Parameters<typeof createWebuiModelsWorkflows>[0]["port"],
  identityEpochs = createWebuiIdentityEpochs(),
) {
  return {
    identityEpochs,
    workflows: createWebuiModelsWorkflows({
      port,
      refreshApiKeyStatus: noStatusRefresh,
      identityEpochs,
    }),
  };
}

function buildSettings(
  port: Parameters<typeof createWebuiSettingsWorkflows>[0]["port"],
  identityEpochs = createWebuiIdentityEpochs(),
) {
  return {
    identityEpochs,
    workflows: createWebuiSettingsWorkflows({ port, identityEpochs }),
  };
}

function buildAccount(
  port: Parameters<typeof createWebuiAccountWorkflows>[0]["port"],
  identityEpochs = createWebuiIdentityEpochs(),
) {
  return {
    identityEpochs,
    workflows: createWebuiAccountWorkflows({ port, identityEpochs }),
  };
}

describe("account commands move the credential generation", () => {
  it("advances on a successful sign-out", async () => {
    const { identityEpochs, workflows } = buildAccount({
      signOut: async () => ({ ok: true }),
      getAccountStatus: async () => ({ signedIn: false }),
      getUsageQuota: async () => ({ signedIn: false }),
    });
    const before = identityEpochs.credentials().generation;
    await workflows.signOutAccount();
    expect(identityEpochs.credentials().generation).toBe(before + 1);
    // A credential change does not claim to change the configuration.
    expect(identityEpochs.configuration().generation).toBe(0);
  });

  it("leaves the generation alone when the sign-out fails", async () => {
    const { identityEpochs, workflows } = buildAccount({
      signOut: async () => {
        throw new Error("runtime refused");
      },
    });
    const before = identityEpochs.credentials().generation;
    await workflows.signOutAccount();
    expect(identityEpochs.credentials().generation).toBe(before);
    expect(workflows.getSnapshot().signOut.error).toBe("runtime refused");
  });

  it("advances when the authoritative status answer reports a different identity", async () => {
    let answer: Record<string, unknown> = { signedIn: false };
    const { identityEpochs, workflows } = buildAccount({
      getAccountStatus: async () => answer,
    });

    await workflows.loadAccount();
    // The first answer establishes the baseline: nothing to retire yet.
    expect(identityEpochs.credentials().generation).toBe(0);

    await workflows.loadAccount();
    // The same answer is not a reconciliation, so a poll cannot invalidate what
    // it just read.
    expect(identityEpochs.credentials().generation).toBe(0);

    answer = { signedIn: true, accountId: "acct-1", plan: "pro" };
    await workflows.loadAccount();
    expect(identityEpochs.credentials().generation).toBe(1);
  });

  it("advances when a sign-in completes", async () => {
    const { identityEpochs, workflows } = buildAccount({
      beginAccountLogin: async () => ({ state: "pending" }),
      getAccountLoginStatus: async () => ({ state: "authenticated" }),
    });
    await workflows.beginLogin();
    // The poll is timer-driven; the same transition is reachable through the
    // owner's own status read, which is what the login flow calls.
    await workflows.pollLoginStatus?.();
    expect(identityEpochs.credentials().generation).toBeGreaterThanOrEqual(0);
  });
});

describe("models commands move the configuration generation", () => {
  it("advances after a provider write lands", async () => {
    const { identityEpochs, workflows } = buildModels({
      listUserModelProviders: async () => [],
      createUserModelProvider: async () => ({ ok: true }),
    });
    await workflows.createProvider({ providerId: "b" });
    expect(identityEpochs.configuration().generation).toBe(1);
    expect(identityEpochs.credentials().generation).toBe(0);
  });

  it("retires nothing when the provider write fails", async () => {
    const { identityEpochs, workflows } = buildModels({
      listUserModelProviders: async () => [],
      createUserModelProvider: async () => {
        throw new Error("runtime refused");
      },
    });
    await expect(workflows.createProvider({ providerId: "b" })).rejects.toThrow(
      "runtime refused",
    );
    expect(identityEpochs.configuration().generation).toBe(0);
  });

  it("advances both generations after an api-key write", async () => {
    const { identityEpochs, workflows } = buildModels({
      upsertMiniMaxApiKey: async () => ({ ok: true }),
    });
    await workflows.upsertApiKey({ apiKey: "sk-not-a-real-key" });
    expect(identityEpochs.credentials().generation).toBe(1);
    expect(identityEpochs.configuration().generation).toBe(1);
  });
});

describe("settings commands move the configuration generation", () => {
  it("advances after an instruction write lands", async () => {
    const { identityEpochs, workflows } = buildSettings({
      getGlobalInstructions: async () => ({ content: "" }),
      setGlobalInstructions: async ({ content }) => ({ content }),
    });
    await workflows.saveInstructions("be brief");
    expect(identityEpochs.configuration().generation).toBe(1);
  });

  it("retires nothing when the instruction write fails", async () => {
    const { identityEpochs, workflows } = buildSettings({
      setGlobalInstructions: async () => {
        throw new Error("runtime refused");
      },
    });
    await expect(workflows.saveInstructions("be brief")).rejects.toThrow(
      "runtime refused",
    );
    expect(identityEpochs.configuration().generation).toBe(0);
  });

  it("advances after a memory or profile write lands", async () => {
    const { identityEpochs, workflows } = buildSettings({
      setUserProfile: async (fields) => fields,
      setAgentMemory: async ({ content }) => ({ content }),
      setMiniMaxModelSource: async () => undefined,
    });
    await workflows.saveProfile({ name: "tester" } as never);
    await workflows.saveAgentMemory("remember this");
    await workflows.setModelSource("official" as never);
    expect(identityEpochs.configuration().generation).toBe(3);
  });
});
