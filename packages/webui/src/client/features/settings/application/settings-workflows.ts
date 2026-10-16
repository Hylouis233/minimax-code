// The settings workflow owner.
//
// One owner for every *settings* surface the browser reads and writes:
// personalization (global instructions, the user profile, agent memory and the
// memory switches), the model source, the api-key status and the Codex OAuth
// status. The model catalogue, the selection and the provider list are `models`'
// (`models-workflows.ts`) — the provider form's commands belong to that business
// while this owner renders the page. The settings dialog and the usage page used
// to hold their own copies of each answer and decide their own error strings;
// here one cache answers both.
//
// Two boundaries are deliberate:
//
//  - **A read reports its own outcome.** Every read below returns the
//    `WebuiResourceLoadOutcome` of *its* request, so a caller learns what it got
//    without re-reading a shared mutable snapshot and hoping it still holds that
//    request's answer. The snapshot remains what a surface *renders*; it is not
//    how a caller discovers its own result.
//  - **A submitted write is a fact, an uncommitted form is not.** A write returns
//    its result to the caller and invalidates exactly the caches it affects. The
//    uncommitted text stays in the component — that is the boundary, not an
//    omission — and the application owns only what was submitted.
//
// The memory panel reads twice, deliberately: a summary (existence, size,
// timestamp) and the body. Those are two request identities, not one overloaded
// value, so a stale body can never be presented as the current summary and the
// two settle independently.
//
// This module is framework-free — no React, no DOM, no storage — so it can be
// unit-tested against a scripted port.

import type { WebuiIdentityEpochs } from "../../../application/identity-epochs.js";
import {
  createWebuiQueryStore,
  idleWebuiQueryState,
  webuiQueryMessage,
  type WebuiQueryState,
} from "../../../application/query-store.js";
import {
  createWebuiKeyedResource,
  type WebuiKeyedResource,
  type WebuiResourceKey,
  type WebuiResourceLoadOutcome,
} from "../../../conversation/request-freshness.js";
import {
  type SettingsPort,
  type WebuiPermissionMode,
} from "../contracts/settings-port.js";
import type { WebuiVersionInfo } from "../../../../shared/contracts/version.js";
import type {
  WebuiAgentMemoryView,
  WebuiGlobalInstructionsView,
  WebuiMemorySettingsView,
  WebuiUserProfileFields,
  WebuiUserProfileView,
} from "../../../../shared/contracts/personalization.js";

/**
 * The settings half of the port. The provider half this workflow used to consume
 * is `models`' now: `models-workflows.ts` declares `WebuiModelsPortSlice` over
 * the same port, so the two owners no longer share one slice.
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
  | "getPermissionMode"
  | "setPermissionMode"
  | "version"
>;

export type WebuiModelSource = "token_plan" | "minimax_api_key";

/**
 * The preference a runtime answer carries, or `undefined` when it carries none
 * this client can act on. The wire answer may be the bare mode or an object with
 * a `mode` field — `getPermissionMode` returns `unknown`, so the coercion has to
 * happen somewhere, and it happens at the owner rather than in the surface that
 * renders the switch.
 */
export function readWebuiPermissionMode(value: unknown): WebuiPermissionMode | undefined {
  const mode = typeof value === "string"
    ? value
    : value && typeof value === "object" && "mode" in value
      ? (value as { mode?: unknown }).mode
      : undefined;
  return mode === "default" || mode === "auto" || mode === "bypassPermissions"
    ? mode
    : undefined;
}

export interface WebuiSettingsWorkflowsState {
  /** Bumps after any successful settings write, so a reader can refresh. */
  readonly revision: number;
  readonly instructions: WebuiQueryState<WebuiGlobalInstructionsView>;
  readonly profile: WebuiQueryState<WebuiUserProfileView>;
  /**
   * The memory *summary*: existence, size and timestamp, without the body.
   *
   * Separate from `agentMemoryContent` because they are two request identities.
   * One field holding either would let a pending body read report as though the
   * summary had settled, and would make the summary's freshness depend on a read
   * the panel only sometimes makes.
   */
  readonly agentMemorySummary: WebuiQueryState<WebuiAgentMemoryView>;
  /** The memory *body*, read only when the editor is open. */
  readonly agentMemoryContent: WebuiQueryState<WebuiAgentMemoryView>;
  readonly memorySettings: WebuiQueryState<WebuiMemorySettingsView>;
  readonly modelSource: WebuiQueryState<WebuiModelSource>;
  /**
   * The runtime handshake fact (version, protocolVersion, dataDir).
   *
   * It is a `SettingsPort` method like any other, so it is read through this
   * owner rather than invoked by a component: the shell and the surfaces it
   * feeds read `runtimeVersion.value` from the snapshot.
   */
  readonly runtimeVersion: WebuiQueryState<WebuiVersionInfo>;
  /**
   * The permission preference, read from the runtime.
   *
   * It is a cached read like the others, and the surface that renders the switch
   * reads `permissionMode.value` / `.error` off the snapshot instead of holding
   * a copy: one owner, one answer.
   */
  readonly permissionMode: WebuiQueryState<WebuiPermissionMode>;
}

export const initialWebuiSettingsWorkflowsState: WebuiSettingsWorkflowsState = {
  revision: 0,
  instructions: idleWebuiQueryState(),
  profile: idleWebuiQueryState(),
  agentMemorySummary: idleWebuiQueryState(),
  agentMemoryContent: idleWebuiQueryState(),
  memorySettings: idleWebuiQueryState(),
  modelSource: idleWebuiQueryState(),
  runtimeVersion: idleWebuiQueryState(),
  permissionMode: idleWebuiQueryState(),
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
  readonly canStartCodexOAuth: boolean;
  readonly canReadModelSource: boolean;
  readonly canSetModelSource: boolean;
  readonly canReadVersion: boolean;
  readonly canReadPermissionMode: boolean;
  readonly canWritePermissionMode: boolean;

  /**
   * Read the permission preference. The outcome is this request's own: a
   * superseded answer says so instead of the caller re-reading the snapshot and
   * assuming it holds this request's value, and an answer this client cannot act
   * on is reported as an error rather than as a silent absence.
   */
  readonly loadPermissionMode: () => Promise<WebuiResourceLoadOutcome<WebuiPermissionMode>>;
  /** Write; returns the mode the runtime answered with, or fails. */
  readonly savePermissionMode: (mode: WebuiPermissionMode) => Promise<WebuiPermissionMode>;

  /**
   * Read the runtime handshake fact, reporting this request's own outcome.
   */
  readonly loadVersion: () => Promise<WebuiResourceLoadOutcome<WebuiVersionInfo>>;

  readonly loadInstructions: () => Promise<WebuiResourceLoadOutcome<WebuiGlobalInstructionsView>>;
  /** Save; returns the runtime's answer and refreshes the cached read. */
  readonly saveInstructions: (content: string) => Promise<WebuiGlobalInstructionsView>;

  readonly loadProfile: () => Promise<WebuiResourceLoadOutcome<WebuiUserProfileView>>;
  readonly saveProfile: (fields: WebuiUserProfileFields) => Promise<WebuiUserProfileView>;

  /**
   * Read memory. `includeContent` selects which identity is read: the summary and
   * the body are cached under separate keys, so an overlapping pair settles in
   * either order without either being presented as the other.
   */
  readonly loadAgentMemory: (
    includeContent?: boolean,
  ) => Promise<WebuiResourceLoadOutcome<WebuiAgentMemoryView>>;
  readonly saveAgentMemory: (content: string) => Promise<WebuiAgentMemoryView>;

  readonly loadMemorySettings: () => Promise<WebuiResourceLoadOutcome<WebuiMemorySettingsView>>;
  readonly saveMemorySettings: (patch: {
    readonly enabled?: boolean;
    readonly proactive?: boolean;
  }) => Promise<WebuiMemorySettingsView>;

  readonly startCodexOAuth: (body?: Record<string, unknown>) => Promise<unknown>;
  readonly cancelCodexOAuth: (loginId: string) => Promise<unknown>;
  readonly loadModelSource: () => Promise<WebuiResourceLoadOutcome<WebuiModelSource>>;
  readonly setModelSource: (source: WebuiModelSource) => Promise<void>;
  /**
   * Release every cached read.
   *
   * Disposal is what makes a read that never answers distinguishable from one
   * that was superseded: an answer still in flight can no longer commit, and a
   * read issued afterwards reports `disposed` without reaching the transport.
   */
  readonly dispose: () => void;
}

export function createWebuiSettingsWorkflows(deps: {
  readonly port: WebuiSettingsPortSlice;
  /**
   * The application's opaque generation context. An instruction, memory, profile
   * or preference write changes the configuration answers were computed under,
   * so the write advances that generation.
   */
  readonly identityEpochs?: WebuiIdentityEpochs;
}): WebuiSettingsWorkflows {
  const { port } = deps;
  /** Called after a write landed: only a successful write retires answers. */
  const afterConfigurationWrite = (): void => {
    deps.identityEpochs?.advance("configuration");
  };
  // The cached-read fence is not this module's: `query-store.ts` holds the one
  // implementation of the snapshot, the listener set and the version guard, and
  // every owner that caches transport answers reads through it.
  const { getSnapshot, subscribe, set, withQuery, unavailable } =
    createWebuiQueryStore(initialWebuiSettingsWorkflowsState);

  /**
   * One cached read, keyed by identity.
   *
   * The key is the read's own identity — which resource, and for memory whether
   * the body was asked for — so the body and the summary are separate requests
   * that settle independently instead of two writes into one field. Every read
   * publishes into the snapshot for the surface to render *and* returns the
   * outcome of its own request, which is how a caller stops re-reading the
   * snapshot to find out what it got.
   */
  const readInto = <Field extends keyof WebuiSettingsWorkflowsState, T>(
    field: Field,
    resource: WebuiKeyedResource<T>,
    key: WebuiResourceKey,
    fetch: () => Promise<T>,
  ): Promise<WebuiResourceLoadOutcome<T>> => {
    resource.subscribe(() => {
      const entry = resource.read(key);
      set((current) => withQuery(current, field, entry ?? idleWebuiQueryState()));
    });
    return resource.load(key, fetch);
  };

  const instructions = createWebuiKeyedResource<WebuiGlobalInstructionsView>();
  const profile = createWebuiKeyedResource<WebuiUserProfileView>();
  const memorySummary = createWebuiKeyedResource<WebuiAgentMemoryView>();
  const memoryContent = createWebuiKeyedResource<WebuiAgentMemoryView>();
  const memorySettings = createWebuiKeyedResource<WebuiMemorySettingsView>();
  const modelSource = createWebuiKeyedResource<WebuiModelSource>();
  const runtimeVersion = createWebuiKeyedResource<WebuiVersionInfo>();
  const permissionMode = createWebuiKeyedResource<WebuiPermissionMode>();

  /**
   * Which cached reads the configuration generation is responsible for.
   *
   * A settings write advances that generation, so the answers it invalidates are
   * not decided one call site at a time — they are every key this generation
   * participates in. Binding them here means an in-flight read is retired by the
   * write that makes it wrong, and reports `superseded`, instead of landing on
   * top of the value the write just committed.
   *
   * `permissionMode` is deliberately absent. Its write does not advance this
   * generation, and retiring a cached answer on a change that does not affect it
   * would be an invalidation the current behaviour does not have.
   */
  const boundReads: Array<WebuiKeyedResource<unknown>> = [];
  const bindToConfiguration = <T>(resource: WebuiKeyedResource<T>, key: WebuiResourceKey): void => {
    const epochs = deps.identityEpochs;
    if (!epochs) return;
    resource.bindEpoch(
      {
        token: () => epochs.configuration().token,
        subscribe: (listener) =>
          epochs.subscribe((advanced) => {
            if (advanced.key === "configuration") listener();
          }),
      },
      key,
    );
    boundReads.push(resource as WebuiKeyedResource<unknown>);
  };
  bindToConfiguration(instructions, { read: "instructions" });
  bindToConfiguration(profile, { read: "profile" });
  bindToConfiguration(memorySummary, { read: "agentMemory", content: false });
  bindToConfiguration(memoryContent, { read: "agentMemory", content: true });
  bindToConfiguration(memorySettings, { read: "memorySettings" });
  bindToConfiguration(modelSource, { read: "modelSource" });
  bindToConfiguration(runtimeVersion, { read: "version" });

  /**
   * A read whose capability is absent.
   *
   * Reported as a failure carrying this owner's own message, so a caller waiting
   * on the outcome learns the same thing the snapshot shows instead of finding an
   * idle field and inventing its own wording.
   */
  const unsupported = <T>(error: string): Promise<WebuiResourceLoadOutcome<T>> => {
    const reason = new Error(error);
    return Promise.resolve({ status: "failed", error: reason });
  };

  const markRevision = (): void => {
    set((current) => ({ ...current, revision: current.revision + 1 }));
  };

  /** A provider change can add or remove models, so the model list is stale. */

  const loadInstructions = (): Promise<WebuiResourceLoadOutcome<WebuiGlobalInstructionsView>> => {
    if (!port.getGlobalInstructions) {
      unavailable("instructions", "当前运行时不支持自定义指令读写。");
      return unsupported("当前运行时不支持自定义指令读写。");
    }
    return readInto("instructions", instructions, { read: "instructions" }, () =>
      port.getGlobalInstructions!(),
    );
  };

  const saveInstructions = async (content: string): Promise<WebuiGlobalInstructionsView> => {
    if (!port.setGlobalInstructions) throw new Error("当前运行时不支持自定义指令读写。");
    const value = await port.setGlobalInstructions({ content });
    afterConfigurationWrite();
    instructions.commit(instructions.capture({ read: "instructions" }), { status: "ready", value });
    set((current) => ({ ...current, revision: current.revision + 1 }));
    return value;
  };

  const loadProfile = (): Promise<WebuiResourceLoadOutcome<WebuiUserProfileView>> => {
    if (!port.getUserProfile) {
      unavailable("profile", "当前运行时不支持「关于你」读写。");
      return unsupported("当前运行时不支持「关于你」读写。");
    }
    return readInto("profile", profile, { read: "profile" }, () => port.getUserProfile!());
  };

  const saveProfile = async (fields: WebuiUserProfileFields): Promise<WebuiUserProfileView> => {
    if (!port.setUserProfile) throw new Error("当前运行时不支持「关于你」读写。");
    const value = await port.setUserProfile(fields);
    afterConfigurationWrite();
    profile.commit(profile.capture({ read: "profile" }), { status: "ready", value });
    set((current) => ({ ...current, revision: current.revision + 1 }));
    return value;
  };

  /**
   * Read memory — summary or body.
   *
   * The two go to different keyed resources, which is the whole point: the panel
   * reads the summary on open and the body only when the editor appears, and an
   * overlapping pair must not have one request's answer presented as the other's.
   * They are published into separate snapshot fields for the same reason.
   */
  const loadAgentMemory = (
    includeContent = false,
  ): Promise<WebuiResourceLoadOutcome<WebuiAgentMemoryView>> => {
    if (!port.getAgentMemory) {
      unavailable(includeContent ? "agentMemoryContent" : "agentMemorySummary", "当前运行时不支持长期记忆读写。");
      return unsupported("当前运行时不支持长期记忆读写。");
    }
    return includeContent
      ? readInto(
          "agentMemoryContent",
          memoryContent,
          { read: "agentMemory", content: true },
          () => port.getAgentMemory!({ includeContent: true }),
        )
      : readInto(
          "agentMemorySummary",
          memorySummary,
          { read: "agentMemory", content: false },
          () => port.getAgentMemory!(),
        );
  };

  const saveAgentMemory = async (content: string): Promise<WebuiAgentMemoryView> => {
    if (!port.setAgentMemory) throw new Error("当前运行时不支持长期记忆读写。");
    const value = await port.setAgentMemory({ content });
    afterConfigurationWrite();
    // The write answers with the body it committed, so both identities are
    // refreshed from it: a summary still showing the pre-write size would be
    // reporting a file state that no longer exists.
    memoryContent.commit(
      memoryContent.capture({ read: "agentMemory", content: true }),
      { status: "ready", value },
    );
    memorySummary.commit(
      memorySummary.capture({ read: "agentMemory", content: false }),
      { status: "ready", value: { ...value, content: undefined } },
    );
    set((current) => ({ ...current, revision: current.revision + 1 }));
    return value;
  };

  const loadMemorySettings = (): Promise<WebuiResourceLoadOutcome<WebuiMemorySettingsView>> => {
    if (!port.getMemorySettings) {
      unavailable("memorySettings", "当前运行时不支持记忆开关。");
      return unsupported("当前运行时不支持记忆开关。");
    }
    return readInto("memorySettings", memorySettings, { read: "memorySettings" }, () =>
      port.getMemorySettings!(),
    );
  };

  const saveMemorySettings = async (patch: {
    readonly enabled?: boolean;
    readonly proactive?: boolean;
  }): Promise<WebuiMemorySettingsView> => {
    if (!port.setMemorySettings) throw new Error("当前运行时不支持记忆开关。");
    const value = await port.setMemorySettings(patch);
    afterConfigurationWrite();
    memorySettings.commit(memorySettings.capture({ read: "memorySettings" }), {
      status: "ready",
      value,
    });
    set((current) => ({ ...current, revision: current.revision + 1 }));
    return value;
  };

  /** A provider mutation refreshes the provider list and marks models stale. */

  const startCodexOAuth = async (body?: Record<string, unknown>): Promise<unknown> => {
    if (!port.startCodexOAuthLogin) throw new Error("当前运行时不支持 Codex 登录。");
    return port.startCodexOAuthLogin(body);
  };

  const cancelCodexOAuth = async (loginId: string): Promise<unknown> => {
    if (!port.cancelCodexOAuthLogin) throw new Error("当前运行时不支持取消 Codex 登录。");
    return port.cancelCodexOAuthLogin({ loginId });
  };

  const loadModelSource = (): Promise<WebuiResourceLoadOutcome<WebuiModelSource>> => {
    if (!port.getMiniMaxModelSource) {
      unavailable("modelSource", "当前运行时不支持模型来源。");
      return unsupported("当前运行时不支持模型来源。");
    }
    return readInto("modelSource", modelSource, { read: "modelSource" }, () =>
      port.getMiniMaxModelSource!(),
    );
  };

  const setModelSource = async (source: WebuiModelSource): Promise<void> => {
    if (!port.setMiniMaxModelSource) throw new Error("当前运行时不支持切换模型来源。");
    const value = await port.setMiniMaxModelSource(source);
    afterConfigurationWrite();
    modelSource.commit(modelSource.capture({ read: "modelSource" }), { status: "ready", value });
    set((current) => ({ ...current, revision: current.revision + 1 }));
  };

  const loadVersion = (): Promise<WebuiResourceLoadOutcome<WebuiVersionInfo>> => {
    const read = port.version;
    if (!read) {
      unavailable("runtimeVersion", "当前运行时不支持版本信息。");
      return unsupported("当前运行时不支持版本信息。");
    }
    return readInto("runtimeVersion", runtimeVersion, { read: "version" }, () => read());
  };

  /**
   * Read the permission preference.
   *
   * The preference is a runtime setting, so the answer is a runtime answer this
   * owner caches — and an answer no client can act on is an error, not an
   * absence: the surface must be able to say "the runtime returned a mode this
   * build does not know" rather than render an empty switch.
   *
   * The write does not advance the configuration epoch. It used to be a raw port
   * call from the composer, so advancing it here would add an invalidation the
   * current behaviour does not have; whether a permission-preference change
   * should retire cached answers is a separate decision with its own evidence.
   */
  const loadPermissionMode = (): Promise<WebuiResourceLoadOutcome<WebuiPermissionMode>> => {
    const read = port.getPermissionMode;
    if (!read) {
      unavailable("permissionMode", "当前运行时不支持授权模式读写。");
      return unsupported("当前运行时不支持授权模式读写。");
    }
    return readInto("permissionMode", permissionMode, { read: "permissionMode" }, async () => {
      const mode = readWebuiPermissionMode(await read());
      if (!mode) throw new Error("运行时返回了不支持的授权模式");
      return mode;
    });
  };

  const savePermissionMode = async (mode: WebuiPermissionMode): Promise<WebuiPermissionMode> => {
    if (!port.setPermissionMode) throw new Error("当前运行时不支持授权模式读写。");
    const answer = readWebuiPermissionMode(await port.setPermissionMode({ mode }));
    if (!answer) throw new Error("运行时返回了不支持的授权模式");
    permissionMode.commit(permissionMode.capture({ read: "permissionMode" }), {
      status: "ready",
      value: answer,
    });
    set((current) => ({ ...current, revision: current.revision + 1 }));
    return answer;
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
    canStartCodexOAuth: port.startCodexOAuthLogin !== undefined,
    canReadModelSource: port.getMiniMaxModelSource !== undefined,
    canSetModelSource: port.setMiniMaxModelSource !== undefined,
    canReadVersion: port.version !== undefined,
    canReadPermissionMode: port.getPermissionMode !== undefined,
    canWritePermissionMode: port.setPermissionMode !== undefined,
    loadInstructions,
    saveInstructions,
    loadProfile,
    saveProfile,
    loadAgentMemory,
    saveAgentMemory,
    loadMemorySettings,
    saveMemorySettings,
    startCodexOAuth,
    cancelCodexOAuth,
    loadModelSource,
    setModelSource,
    loadPermissionMode,
    savePermissionMode,
    loadVersion,
    dispose: () => {
      // Disposal fences every read: an answer still in flight can no longer
      // commit, and a read started afterwards reports `disposed` without issuing
      // a request. This is the same rule the primitive applies everywhere, not a
      // settings-local variant.
      for (const resource of [
        instructions,
        profile,
        memorySummary,
        memoryContent,
        memorySettings,
        modelSource,
        runtimeVersion,
        permissionMode,
      ]) {
        resource.dispose();
      }
      boundReads.length = 0;
    },
  };
}
