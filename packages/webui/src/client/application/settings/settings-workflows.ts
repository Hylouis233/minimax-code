// The settings workflow owner (plan §7.1 `application/settings-workflows.ts`;
// §7.6 "Settings" row; §7.7 stage 5; ticket #52).
//
// One owner for every *settings* surface the browser reads and writes:
// personalization (global instructions, the user profile, agent memory and the
// memory switches), the model source, the api-key status and the Codex OAuth
// status. The model catalogue, the selection and the provider list are `models`'
// (`models-workflows.ts`) — §5.6 gives them to that business, and §5.7 states
// that the provider form's commands are `models`' while this owner renders the
// page. The settings dialog and the usage page used to hold their own copies of
// each answer and decide their own error strings; here one cache answers both.
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

import {
  createWebuiQueryStore,
  idleWebuiQueryState,
  type WebuiQueryState,
} from "../query-store.js";
import type { SettingsPort } from "../../contracts/settings/settings-port.js";
import type { WebuiVersionInfo } from "../../../shared/contracts/version.js";
import type {
  WebuiAgentMemoryView,
  WebuiGlobalInstructionsView,
  WebuiMemorySettingsView,
  WebuiUserProfileFields,
  WebuiUserProfileView,
} from "../../../shared/contracts/personalization.js";

/**
 * The settings half of the port re-file (plan §9, ticket #59). The provider half
 * this workflow used to consume is `models`' now: `models-workflows.ts` declares
 * `WebuiModelsPortSlice` over the same port, so the two owners no longer share
 * one slice.
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
>;

export type WebuiModelSource = "token_plan" | "minimax_api_key";

export interface WebuiSettingsWorkflowsState {
  /** Bumps after any successful settings write, so a reader can refresh. */
  readonly revision: number;
  readonly instructions: WebuiQueryState<WebuiGlobalInstructionsView>;
  readonly profile: WebuiQueryState<WebuiUserProfileView>;
  readonly agentMemory: WebuiQueryState<WebuiAgentMemoryView>;
  readonly memorySettings: WebuiQueryState<WebuiMemorySettingsView>;
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
  instructions: idleWebuiQueryState(),
  profile: idleWebuiQueryState(),
  agentMemory: idleWebuiQueryState(),
  memorySettings: idleWebuiQueryState(),
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
  readonly canReadApiKeyStatus: boolean;
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

  readonly loadApiKeyStatus: () => Promise<void>;
  readonly loadCodexOAuthStatus: () => Promise<void>;
  readonly startCodexOAuth: (body?: Record<string, unknown>) => Promise<unknown>;
  readonly cancelCodexOAuth: (loginId: string) => Promise<unknown>;
  readonly loadModelSource: () => Promise<void>;
  readonly setModelSource: (source: WebuiModelSource) => Promise<void>;
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

  /** A provider mutation refreshes the provider list and marks models stale. */

  const loadApiKeyStatus = async (): Promise<void> => {
    if (!port.getMiniMaxApiKeyStatus) {
      unavailable("apiKeyStatus", "MiniMax API key status unavailable");
      return;
    }
    await readInto("apiKeyStatus", "apiKeyStatus", () => port.getMiniMaxApiKeyStatus!());
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
    canReadApiKeyStatus: port.getMiniMaxApiKeyStatus !== undefined,
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
    loadApiKeyStatus,
    loadCodexOAuthStatus,
    startCodexOAuth,
    cancelCodexOAuth,
    loadModelSource,
    setModelSource,
    loadVersion,
  };
}
