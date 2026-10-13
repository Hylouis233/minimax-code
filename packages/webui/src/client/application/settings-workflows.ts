// The settings workflow owner (plan §7.1 `application/settings-workflows.ts`;
// §7.6 "Settings" row; §7.7 stage 5; ticket #52).
//
// One owner for every settings surface the browser reads and writes:
// personalization (global instructions, the user profile, agent memory and the
// memory switches) and the model/provider configuration. The settings dialog
// and the usage page used to hold their own copies of each answer and decide
// their own error strings; here one cache answers both.
//
// The split between *cached reads* and *submitted writes* is deliberate and is
// what the ticket asks for:
//
//  - A read is cached in the snapshot with a request version per key, so a
//    superseded answer is dropped rather than applied over a newer one, and
//    the dialog re-opens onto the last answer instead of refetching blind.
//  - A write returns its result to the caller and invalidates exactly the
//    caches it affects. The uncommitted form stays in the component — that is
//    the boundary, not an omission — and the application owns only what was
//    submitted.
//
// This module is framework-free — no React, no DOM, no storage — so it can be
// unit-tested against a scripted port.

import type { ModelsPort } from "../contracts/models/models-port.js";
import {
  createWebuiQueryStore,
  idleWebuiQueryState,
  type WebuiQueryState,
} from "./query-store.js";
import type { SettingsPort } from "../contracts/settings/settings-port.js";
import type { WebuiVersionInfo } from "../../shared/contracts/version.js";
import type { WebuiModelEntry } from "../../shared/contracts/models.js";
import type {
  WebuiAgentMemoryView,
  WebuiGlobalInstructionsView,
  WebuiMemorySettingsView,
  WebuiUserProfileFields,
  WebuiUserProfileView,
} from "../../shared/contracts/personalization.js";

/**
 * The settings-and-models slice this workflow drives. The port re-file (plan §9,
 * ticket #59) split the former `SettingsPort` in two, so the slice is now an
 * intersection: the settings half comes from `settings/settings-port.js` and the
 * provider half from `models/models-port.js`. The intersection preserves exactly
 * the surface this workflow consumed, with each member resolved against the port
 * that now owns it.
 */
export type WebuiSettingsPortSlice = Pick<
  SettingsPort,
  | "getGlobalInstructions"
  | "setGlobalInstructions"
  | "getUserProfile"
  | "setUserProfile"
  | "getAgentMemory"
  | "setAgentMemory"
  | "getMemorySettings"
  | "setMemorySettings"
  | "getMiniMaxApiKeyStatus"
  | "getCodexOAuthStatus"
  | "getMiniMaxModelSource"
  | "setMiniMaxModelSource"
  | "startCodexOAuthLogin"
  | "cancelCodexOAuthLogin"
  | "version"
> &
  Pick<
    ModelsPort,
    | "listModels"
    | "selectModel"
    | "listUserModelProviders"
    | "createUserModelProvider"
    | "updateUserModelProvider"
    | "deleteUserModelProvider"
    | "testUserModelProvider"
    | "testUserModel"
    | "discoverUserModelsCandidate"
    | "saveUserModelProviderCandidate"
    | "listProviderPresets"
    | "upsertMiniMaxApiKey"
    | "testUserModelCandidate"
    | "revealModelProviderApiKey"
    | "refreshModels"
  >;

export type WebuiModelSource = "token_plan" | "minimax_api_key";

export interface WebuiSettingsWorkflowsState {
  /** Bumps after any successful settings write, so a reader can refresh. */
  readonly revision: number;
  /** Bumps when the model list must be re-read (a provider changed). */
  readonly modelsRevision: number;
  readonly instructions: WebuiQueryState<WebuiGlobalInstructionsView>;
  readonly profile: WebuiQueryState<WebuiUserProfileView>;
  readonly agentMemory: WebuiQueryState<WebuiAgentMemoryView>;
  readonly memorySettings: WebuiQueryState<WebuiMemorySettingsView>;
  readonly models: WebuiQueryState<readonly WebuiModelEntry[]>;
  readonly providers: WebuiQueryState<readonly Record<string, unknown>[]>;
  readonly presets: WebuiQueryState<readonly Record<string, unknown>[]>;
  readonly apiKeyStatus: WebuiQueryState<Record<string, unknown>>;
  readonly codexOAuth: WebuiQueryState<Record<string, unknown>>;
  readonly modelSource: WebuiQueryState<WebuiModelSource>;
  /**
   * The runtime handshake fact (version, protocolVersion, dataDir).
   *
   * It is a `SettingsPort` method like any other, so it is read through this
   * owner rather than invoked by a component: the shell and the surfaces it
   * feeds read `runtimeVersion.value` from the snapshot.
   */
  readonly runtimeVersion: WebuiQueryState<WebuiVersionInfo>;
}

export const initialWebuiSettingsWorkflowsState: WebuiSettingsWorkflowsState = {
  revision: 0,
  modelsRevision: 0,
  instructions: idleWebuiQueryState(),
  profile: idleWebuiQueryState(),
  agentMemory: idleWebuiQueryState(),
  memorySettings: idleWebuiQueryState(),
  models: idleWebuiQueryState(),
  providers: idleWebuiQueryState(),
  presets: idleWebuiQueryState(),
  apiKeyStatus: idleWebuiQueryState(),
  codexOAuth: idleWebuiQueryState(),
  modelSource: idleWebuiQueryState(),
  runtimeVersion: idleWebuiQueryState(),
};

export interface WebuiSettingsWorkflows {
  readonly getSnapshot: () => WebuiSettingsWorkflowsState;
  readonly subscribe: (listener: () => void) => () => void;

  readonly canReadInstructions: boolean;
  readonly canWriteInstructions: boolean;
  readonly canReadProfile: boolean;
  readonly canWriteProfile: boolean;
  readonly canReadMemory: boolean;
  readonly canWriteMemory: boolean;
  readonly canReadMemorySettings: boolean;
  readonly canWriteMemorySettings: boolean;
  readonly canReadModels: boolean;
  readonly canSelectModel: boolean;
  readonly canManageProviders: boolean;
  readonly canReadPresets: boolean;
  readonly canReadApiKeyStatus: boolean;
  readonly canUpsertApiKey: boolean;
  readonly canReadCodexOAuth: boolean;
  readonly canStartCodexOAuth: boolean;
  readonly canReadModelSource: boolean;
  readonly canSetModelSource: boolean;
  readonly canReadVersion: boolean;

  /**
   * Read the runtime handshake fact. A superseded answer is dropped, exactly
   * like every other cached read here.
   */
  readonly loadVersion: () => Promise<void>;

  readonly loadInstructions: () => Promise<void>;
  /** Save; returns the runtime's answer and refreshes the cached read. */
  readonly saveInstructions: (content: string) => Promise<WebuiGlobalInstructionsView>;

  readonly loadProfile: () => Promise<void>;
  readonly saveProfile: (fields: WebuiUserProfileFields) => Promise<WebuiUserProfileView>;

  readonly loadAgentMemory: (includeContent?: boolean) => Promise<void>;
  readonly saveAgentMemory: (content: string) => Promise<WebuiAgentMemoryView>;

  readonly loadMemorySettings: () => Promise<void>;
  readonly saveMemorySettings: (patch: {
    readonly enabled?: boolean;
    readonly proactive?: boolean;
  }) => Promise<WebuiMemorySettingsView>;

  readonly loadModels: (sessionId?: string) => Promise<void>;
  readonly selectModel: (request: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly sessionId?: string;
  }) => Promise<void>;

  readonly loadProviders: () => Promise<void>;
  /**
   * Apply an optimistic local patch to one provider's `models` list, so a
   * toggle or a reorder shows immediately. The reload that follows the write is
   * the truth, and a failed write rolls the patch back by reloading.
   */
  readonly patchProviderModels: (
    providerId: string,
    models: readonly Record<string, unknown>[],
  ) => void;
  readonly createProvider: (body: Record<string, unknown>) => Promise<unknown>;
  readonly updateProvider: (body: Record<string, unknown>) => Promise<unknown>;
  readonly deleteProvider: (providerId: string) => Promise<unknown>;
  readonly testProvider: (body: {
    readonly providerId: string;
    readonly apiKey?: string;
  }) => Promise<unknown>;
  readonly testModel: (body: {
    readonly providerId: string;
    readonly modelId: string;
  }) => Promise<unknown>;
  readonly discoverCandidate: (body: Record<string, unknown>) => Promise<unknown>;
  readonly saveCandidate: (body: Record<string, unknown>) => Promise<unknown>;
  readonly testCandidate: (body: {
    readonly candidate: Record<string, unknown>;
    readonly modelId: string;
  }) => Promise<unknown>;
  readonly revealApiKey: (providerId: string) => Promise<string>;
  readonly loadPresets: () => Promise<void>;
  readonly loadApiKeyStatus: () => Promise<void>;
  readonly upsertApiKey: (body: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }) => Promise<unknown>;
  readonly loadCodexOAuthStatus: () => Promise<void>;
  readonly startCodexOAuth: (body?: Record<string, unknown>) => Promise<unknown>;
  readonly cancelCodexOAuth: (loginId: string) => Promise<unknown>;
  readonly loadModelSource: () => Promise<void>;
  readonly setModelSource: (source: WebuiModelSource) => Promise<void>;
  readonly refreshModels: () => Promise<unknown>;
}

export function createWebuiSettingsWorkflows(deps: {
  readonly port: WebuiSettingsPortSlice;
}): WebuiSettingsWorkflows {
  const { port } = deps;
  // The cached-read fence is not this module's: `query-store.ts` holds the one
  // implementation of the snapshot, the listener set and the version guard, and
  // every owner that caches transport answers reads through it (§16.3).
  const { getSnapshot, subscribe, set, withQuery, readInto, unavailable } =
    createWebuiQueryStore(initialWebuiSettingsWorkflowsState);

  const markRevision = (): void => {
    set((current) => ({ ...current, revision: current.revision + 1 }));
  };

  /** A provider change can add or remove models, so the model list is stale. */
  const markModels = (): void => {
    set((current) => ({ ...current, modelsRevision: current.modelsRevision + 1 }));
  };

  const loadInstructions = async (): Promise<void> => {
    if (!port.getGlobalInstructions) {
      unavailable("instructions", "当前运行时不支持自定义指令读写。");
      return;
    }
    await readInto("instructions", "instructions", () => port.getGlobalInstructions!());
  };

  const saveInstructions = async (content: string): Promise<WebuiGlobalInstructionsView> => {
    if (!port.setGlobalInstructions) throw new Error("当前运行时不支持自定义指令读写。");
    const value = await port.setGlobalInstructions({ content });
    set((current) => ({
      ...current,
      instructions: { status: "ready", value },
      revision: current.revision + 1,
    }));
    return value;
  };

  const loadProfile = async (): Promise<void> => {
    if (!port.getUserProfile) {
      unavailable("profile", "当前运行时不支持「关于你」读写。");
      return;
    }
    await readInto("profile", "profile", () => port.getUserProfile!());
  };

  const saveProfile = async (fields: WebuiUserProfileFields): Promise<WebuiUserProfileView> => {
    if (!port.setUserProfile) throw new Error("当前运行时不支持「关于你」读写。");
    const value = await port.setUserProfile(fields);
    set((current) => ({
      ...current,
      profile: { status: "ready", value },
      revision: current.revision + 1,
    }));
    return value;
  };

  const loadAgentMemory = async (includeContent = false): Promise<void> => {
    if (!port.getAgentMemory) {
      unavailable("agentMemory", "当前运行时不支持长期记忆读写。");
      return;
    }
    await readInto("agentMemory", "agentMemory", () => port.getAgentMemory!(includeContent ? { includeContent: true } : undefined));
  };

  const saveAgentMemory = async (content: string): Promise<WebuiAgentMemoryView> => {
    if (!port.setAgentMemory) throw new Error("当前运行时不支持长期记忆读写。");
    const value = await port.setAgentMemory({ content });
    set((current) => ({
      ...current,
      agentMemory: { status: "ready", value },
      revision: current.revision + 1,
    }));
    return value;
  };

  const loadMemorySettings = async (): Promise<void> => {
    if (!port.getMemorySettings) {
      unavailable("memorySettings", "当前运行时不支持记忆开关。");
      return;
    }
    await readInto("memorySettings", "memorySettings", () => port.getMemorySettings!());
  };

  const saveMemorySettings = async (patch: {
    readonly enabled?: boolean;
    readonly proactive?: boolean;
  }): Promise<WebuiMemorySettingsView> => {
    if (!port.setMemorySettings) throw new Error("当前运行时不支持记忆开关。");
    const value = await port.setMemorySettings(patch);
    set((current) => ({
      ...current,
      memorySettings: { status: "ready", value },
      revision: current.revision + 1,
    }));
    return value;
  };

  const loadModels = async (sessionId?: string): Promise<void> => {
    if (!port.listModels) {
      unavailable("models", "当前运行时不支持模型列表。");
      return;
    }
    await readInto("models", "models", () => port.listModels!(sessionId ? { sessionId } : undefined));
  };

  const selectModel = async (request: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly sessionId?: string;
  }): Promise<void> => {
    if (!port.selectModel) throw new Error("当前运行时不支持模型切换。");
    await port.selectModel(request);
    // The selection is a property of the model list: re-read so the marked row
    // follows, and bump the revision so other readers refresh.
    await loadModels(request.sessionId);
    markRevision();
  };

  const loadProviders = async (): Promise<void> => {
    if (!port.listUserModelProviders) {
      unavailable("providers", "当前运行时不支持自定义提供商。");
      return;
    }
    await readInto("providers", "providers", () => port.listUserModelProviders!());
  };

  /** A provider mutation refreshes the provider list and marks models stale. */
  const afterProviderMutation = async (): Promise<void> => {
    markModels();
    markRevision();
    await loadProviders();
  };

  const patchProviderModels = (
    providerId: string,
    models: readonly Record<string, unknown>[],
  ): void => {
    set((current) => {
      const providers = current.providers.value;
      if (!providers) return current;
      return {
        ...current,
        providers: {
          status: "ready",
          value: providers.map((provider) =>
            provider.providerId === providerId ? { ...provider, models } : provider,
          ),
        },
      };
    });
  };

  const createProvider = async (body: Record<string, unknown>): Promise<unknown> => {
    if (!port.createUserModelProvider) throw new Error("当前运行时不支持自定义提供商。");
    const result = await port.createUserModelProvider(body);
    await afterProviderMutation();
    return result;
  };

  const updateProvider = async (body: Record<string, unknown>): Promise<unknown> => {
    if (!port.updateUserModelProvider) throw new Error("当前运行时不支持自定义提供商。");
    try {
      const result = await port.updateUserModelProvider(body);
      await afterProviderMutation();
      return result;
    } catch (reason) {
      // Undo an optimistic patch by re-reading the truth.
      await loadProviders();
      throw reason;
    }
  };

  const deleteProvider = async (providerId: string): Promise<unknown> => {
    if (!port.deleteUserModelProvider) throw new Error("当前运行时不支持自定义提供商。");
    const result = await port.deleteUserModelProvider(providerId);
    await afterProviderMutation();
    return result;
  };

  const testProvider = async (body: {
    readonly providerId: string;
    readonly apiKey?: string;
  }): Promise<unknown> => {
    if (!port.testUserModelProvider) throw new Error("当前运行时不支持提供商连通性测试。");
    return port.testUserModelProvider(body);
  };

  const testModel = async (body: {
    readonly providerId: string;
    readonly modelId: string;
  }): Promise<unknown> => {
    if (!port.testUserModel) throw new Error("当前运行时不支持模型测试。");
    return port.testUserModel(body);
  };

  const discoverCandidate = async (body: Record<string, unknown>): Promise<unknown> => {
    if (!port.discoverUserModelsCandidate) throw new Error("当前运行时不支持模型发现。");
    return port.discoverUserModelsCandidate(body);
  };

  const saveCandidate = async (body: Record<string, unknown>): Promise<unknown> => {
    if (!port.saveUserModelProviderCandidate) throw new Error("当前运行时不支持保存提供商。");
    const result = await port.saveUserModelProviderCandidate(body);
    await afterProviderMutation();
    return result;
  };

  const testCandidate = async (body: {
    readonly candidate: Record<string, unknown>;
    readonly modelId: string;
  }): Promise<unknown> => {
    if (!port.testUserModelCandidate) throw new Error("当前运行时不支持模型测试。");
    return port.testUserModelCandidate(body);
  };

  const revealApiKey = async (providerId: string): Promise<string> => {
    if (!port.revealModelProviderApiKey) throw new Error("当前运行时不支持查看密钥。");
    return port.revealModelProviderApiKey({ providerId });
  };

  const loadPresets = async (): Promise<void> => {
    if (!port.listProviderPresets) {
      unavailable("presets", "当前运行时不支持提供商预设。");
      return;
    }
    await readInto("presets", "presets", () => port.listProviderPresets!());
  };

  const loadApiKeyStatus = async (): Promise<void> => {
    if (!port.getMiniMaxApiKeyStatus) {
      unavailable("apiKeyStatus", "MiniMax API key status unavailable");
      return;
    }
    await readInto("apiKeyStatus", "apiKeyStatus", () => port.getMiniMaxApiKeyStatus!());
  };

  const upsertApiKey = async (body: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }): Promise<unknown> => {
    if (!port.upsertMiniMaxApiKey) throw new Error("当前运行时不支持保存 API key。");
    const result = await port.upsertMiniMaxApiKey(body);
    markRevision();
    markModels();
    await loadApiKeyStatus();
    return result;
  };

  const loadCodexOAuthStatus = async (): Promise<void> => {
    if (!port.getCodexOAuthStatus) {
      unavailable("codexOAuth", "当前运行时不支持 Codex 登录状态。");
      return;
    }
    await readInto("codexOAuth", "codexOAuth", () => port.getCodexOAuthStatus!());
  };

  const startCodexOAuth = async (body?: Record<string, unknown>): Promise<unknown> => {
    if (!port.startCodexOAuthLogin) throw new Error("当前运行时不支持 Codex 登录。");
    return port.startCodexOAuthLogin(body);
  };

  const cancelCodexOAuth = async (loginId: string): Promise<unknown> => {
    if (!port.cancelCodexOAuthLogin) throw new Error("当前运行时不支持取消 Codex 登录。");
    return port.cancelCodexOAuthLogin({ loginId });
  };

  const loadModelSource = async (): Promise<void> => {
    if (!port.getMiniMaxModelSource) {
      unavailable("modelSource", "当前运行时不支持模型来源。");
      return;
    }
    await readInto("modelSource", "modelSource", () => port.getMiniMaxModelSource!());
  };

  const setModelSource = async (source: WebuiModelSource): Promise<void> => {
    if (!port.setMiniMaxModelSource) throw new Error("当前运行时不支持切换模型来源。");
    const value = await port.setMiniMaxModelSource(source);
    set((current) => ({
      ...current,
      modelSource: { status: "ready", value },
      revision: current.revision + 1,
    }));
    markModels();
  };

  const refreshModels = async (): Promise<unknown> => {
    if (!port.refreshModels) throw new Error("当前运行时不支持刷新模型。");
    const result = await port.refreshModels();
    await loadModels();
    return result;
  };

  const loadVersion = async (): Promise<void> => {
    const read = port.version;
    if (!read) {
      unavailable("runtimeVersion", "当前运行时不支持版本信息。");
      return;
    }
    await readInto("runtimeVersion", "runtimeVersion", () => read());
  };

  return {
    getSnapshot,
    subscribe,
    canReadInstructions: port.getGlobalInstructions !== undefined,
    canWriteInstructions: port.setGlobalInstructions !== undefined,
    canReadProfile: port.getUserProfile !== undefined,
    canWriteProfile: port.setUserProfile !== undefined,
    canReadMemory: port.getAgentMemory !== undefined,
    canWriteMemory: port.setAgentMemory !== undefined,
    canReadMemorySettings: port.getMemorySettings !== undefined,
    canWriteMemorySettings: port.setMemorySettings !== undefined,
    canReadModels: port.listModels !== undefined,
    canSelectModel: port.selectModel !== undefined,
    canManageProviders: port.listUserModelProviders !== undefined,
    canReadPresets: port.listProviderPresets !== undefined,
    canReadApiKeyStatus: port.getMiniMaxApiKeyStatus !== undefined,
    canUpsertApiKey: port.upsertMiniMaxApiKey !== undefined,
    canReadCodexOAuth: port.getCodexOAuthStatus !== undefined,
    canStartCodexOAuth: port.startCodexOAuthLogin !== undefined,
    canReadModelSource: port.getMiniMaxModelSource !== undefined,
    canSetModelSource: port.setMiniMaxModelSource !== undefined,
    canReadVersion: port.version !== undefined,
    loadInstructions,
    saveInstructions,
    loadProfile,
    saveProfile,
    loadAgentMemory,
    saveAgentMemory,
    loadMemorySettings,
    saveMemorySettings,
    loadModels,
    selectModel,
    loadProviders,
    patchProviderModels,
    createProvider,
    updateProvider,
    deleteProvider,
    testProvider,
    testModel,
    discoverCandidate,
    saveCandidate,
    testCandidate,
    revealApiKey,
    loadPresets,
    loadApiKeyStatus,
    upsertApiKey,
    loadCodexOAuthStatus,
    startCodexOAuth,
    cancelCodexOAuth,
    loadModelSource,
    setModelSource,
    refreshModels,
    loadVersion,
  };
}
