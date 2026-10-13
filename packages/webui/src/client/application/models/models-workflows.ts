// The models workflow owner (plan §5.6's `models` row; §5.7's provider-form
// attribution; §16.10's `models` rows).
//
// One owner for the model catalogue, the selection, and the provider list and
// presets. These states and their commands used to be published by
// `settings-workflows.ts`, which owned none of them: §5.6 gives `models` "the
// model catalogue query state, selection command state, thinking state, the
// provider list", and §5.7 states that the provider form's commands are
// `models`' while `settings` renders the page. The two owners now hold their
// own state and their own snapshot.
//
// The cached-read fence is not this module's either: `query-store.ts` holds the
// one implementation of the snapshot, the listener set and the version guard
// (§16.3), and both owners read through it.
//
// One call crosses a boundary: writing a provider key is `models`' command, but
// the api-key *status* it invalidates is `settings`' read, so this owner invokes
// that owner's published command (`refreshApiKeyStatus`) rather than keeping a
// second copy of the read. Nothing else crosses: both counters stay inside the
// owner that owns the state they describe.
//
// Framework-free: no React, no DOM, no storage.

import type { ModelsPort } from "../../contracts/models/provider-port.js";
import type { WebuiModelEntry } from "../../../shared/contracts/models.js";
import {
  createWebuiQueryStore,
  idleWebuiQueryState,
  type WebuiQueryState,
} from "../query-store.js";

/** The provider half of the port re-file (plan §9, ticket #59). */
export type WebuiModelsPortSlice = Pick<
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

export interface WebuiModelsWorkflowsState {
  /** Bumps when the model list must be re-read (a provider or a selection changed). */
  readonly modelsRevision: number;
  readonly models: WebuiQueryState<readonly WebuiModelEntry[]>;
  readonly providers: WebuiQueryState<readonly Record<string, unknown>[]>;
  readonly presets: WebuiQueryState<readonly Record<string, unknown>[]>;
}

export const initialWebuiModelsWorkflowsState: WebuiModelsWorkflowsState = {
  modelsRevision: 0,
  models: idleWebuiQueryState(),
  providers: idleWebuiQueryState(),
  presets: idleWebuiQueryState(),
};

export interface WebuiModelsWorkflows {
  readonly getSnapshot: () => WebuiModelsWorkflowsState;
  readonly subscribe: (listener: () => void) => () => void;

  readonly canReadModels: boolean;
  readonly canSelectModel: boolean;
  readonly canManageProviders: boolean;
  readonly canReadPresets: boolean;
  readonly canUpsertApiKey: boolean;

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
  readonly upsertApiKey: (body: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }) => Promise<unknown>;
  readonly refreshModels: () => Promise<unknown>;
}

export function createWebuiModelsWorkflows(deps: {
  readonly port: WebuiModelsPortSlice;
  /** `settings`' api-key status read, invoked after `upsertApiKey` writes. */
  readonly refreshApiKeyStatus: () => Promise<void>;
}): WebuiModelsWorkflows {
  const { port, refreshApiKeyStatus } = deps;
  const { getSnapshot, subscribe, set, readInto, unavailable } =
    createWebuiQueryStore(initialWebuiModelsWorkflowsState);

  const markModels = (): void => {
    set((current) => ({ ...current, modelsRevision: current.modelsRevision + 1 }));
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
    // follows, and bump this owner's revision so its readers refresh.
    await loadModels(request.sessionId);
    markModels();
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

  const upsertApiKey = async (body: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }): Promise<unknown> => {
    if (!port.upsertMiniMaxApiKey) throw new Error("当前运行时不支持保存 API key。");
    const result = await port.upsertMiniMaxApiKey(body);
    markModels();
    // The api-key *status* read is `settings`' (§5.6), so this owner calls that
    // owner's published command instead of holding a second copy of the read.
    await refreshApiKeyStatus();
    return result;
  };

  const refreshModels = async (): Promise<unknown> => {
    if (!port.refreshModels) throw new Error("当前运行时不支持刷新模型。");
    const result = await port.refreshModels();
    await loadModels();
    return result;
  };

  return {
    getSnapshot,
    subscribe,
    canReadModels: port.listModels !== undefined,
    canSelectModel: port.selectModel !== undefined,
    canManageProviders: port.listUserModelProviders !== undefined,
    canReadPresets: port.listProviderPresets !== undefined,
    canUpsertApiKey: port.upsertMiniMaxApiKey !== undefined,
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
    upsertApiKey,
    refreshModels,
  };
}
