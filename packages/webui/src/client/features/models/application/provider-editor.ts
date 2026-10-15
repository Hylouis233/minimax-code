// The Models-owned provider editor (plan §5.5, P05).
//
// Models defines the editing policy — identity, draft, candidate construction,
// test validity, pending operation/error state and command outcomes — and the
// binding owns **one instance for a Usage page visit**, above the
// `sourceTab === "custom"` conditional. Today those live as fourteen `useState`s
// in `UsageModelSettings` handed down to `ProviderFormPanel` as setters, which
// makes the parent the editor's storage and the panel the editor's policy.
//
// It is framework-free on purpose: no React, no DOM. The binding supplies the
// command set and renders the snapshot; the editor never writes a cache of its
// own, so a catalogue mutation goes through the Models workflow and the
// invalidation that follows stays the workflow's.
//
// Two fences are the reason this is a module rather than inline handlers:
//
//   * a **draft generation** — a field edit changes what the candidate means, so
//     a test that started before the edit can no longer mark the draft tested;
//   * an **operation generation** — closing the form or disposing the editor
//     fences every late completion, so a save that lands afterwards cannot
//     repopulate a disposed editor.

import type {
  WebuiModelProviderCandidateInput,
  WebuiModelProviderView,
  WebuiUserModelInput,
} from "../../../../shared/contracts/models.js";
import { formatWebuiError } from "../../../contracts/value-readers.js";
import { projectProviderHeaders } from "../projection/usage-settings.js";
import type { ProviderHeaderDraft } from "../contracts/provider-editor.js";
import type {
  WebuiProviderEditor,
  WebuiProviderEditorCommands,
  WebuiProviderEditorOptions,
  WebuiProviderEditorSnapshot,
} from "../contracts/provider-editor.js";

export type {
  WebuiProviderEditor,
  WebuiProviderEditorCommands,
  WebuiProviderEditorOptions,
  WebuiProviderEditorSnapshot,
} from "../contracts/provider-editor.js";

const EMPTY_DRAFT = {
  name: "",
  baseUrl: "",
  apiKey: "",
  apiFormat: "openai-completions",
  modelIdText: "",
} as const;

export function createWebuiProviderEditor(
  options: WebuiProviderEditorOptions,
): WebuiProviderEditor {
  const { commands } = options;
  const listeners = new Set<() => void>();
  let editingProviderId: string | undefined;
  let configRevision: string | undefined;
  let draft: {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: string;
    modelIdText: string;
  } = { ...EMPTY_DRAFT };
  let headers: readonly ProviderHeaderDraft[] = [];
  let originalHeaderNames: readonly string[] = [];
  let skipConnectionTest = false;
  let tested = false;
  let pending: WebuiProviderEditorSnapshot["pending"];
  let error: string | undefined;
  let open = false;
  /** Bumped by every edit: a test that started earlier cannot mark this draft tested. */
  let draftGeneration = 0;
  /** Bumped by close/dispose: a completion that lands later writes nothing. */
  let operationGeneration = 0;
  let disposed = false;

  let snapshot: WebuiProviderEditorSnapshot = currentSnapshot();

  function currentSnapshot(): WebuiProviderEditorSnapshot {
    return {
      open,
      ...(editingProviderId === undefined ? {} : { editingProviderId }),
      ...draft,
      headers,
      skipConnectionTest,
      busy: pending !== undefined,
      ...(pending === undefined ? {} : { pending }),
      ...(error === undefined ? {} : { error }),
      tested,
      canManageProviders: commands.canManageProviders,
      canDiscover: editingProviderId !== undefined && configRevision !== undefined,
      ...(configRevision === undefined ? {} : { configRevision }),
    };
  }

  const publish = (): void => {
    if (disposed) return;
    snapshot = currentSnapshot();
    for (const listener of [...listeners]) listener();
  };

  const setError = (message: string | undefined): void => {
    error = message;
    options.onError?.(message);
  };

  const begin = (next: NonNullable<WebuiProviderEditorSnapshot["pending"]>): number => {
    pending = next;
    error = undefined;
    return operationGeneration;
  };
  /**
   * End one operation. A completion that lands after `close`/`dispose` (a stale
   * generation) or after disposal writes nothing at all — not even the error.
   */
  const settle = (generation: number, message?: string): void => {
    if (generation !== operationGeneration || disposed) return;
    pending = undefined;
    if (message !== undefined) setError(message);
    publish();
  };

  /** The candidate the current draft describes, or the reason it cannot be built. */
  const candidate = ():
    | { readonly ok: true; readonly value: WebuiModelProviderCandidateInput }
    | { readonly ok: false; readonly reason: string } => {
    const projection = projectProviderHeaders(headers, originalHeaderNames);
    if (projection.error !== undefined)
      return {
        ok: false,
        reason:
          projection.error === "duplicate-name"
            ? "Header 名称不能重复"
            : "新增 Header 必须填写值",
      };
    return {
      ok: true,
      value: {
        ...(editingProviderId === undefined ? {} : { providerId: editingProviderId }),
        ...(configRevision === undefined ? {} : { expectedRevision: configRevision }),
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey,
        apiFormat: draft.apiFormat,
        ...(projection.headers === undefined ? {} : { headers: projection.headers }),
        ...(projection.removeHeaders === undefined
          ? {}
          : { removeHeaders: projection.removeHeaders }),
        models: modelInputs(),
      },
    };
  };

  const modelInputs = (): readonly WebuiUserModelInput[] =>
    draft.modelIdText
      .split("\n")
      .map((modelId) => modelId.trim())
      .filter(Boolean)
      .map((modelId) => ({ modelId }));

  /** The first typed model id, which is what a test or a save targets. */
  const firstModelId = (): string => draft.modelIdText.split("\n")[0]?.trim() ?? "";

  return {
    getSnapshot: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    openNew: () => {
      editingProviderId = undefined;
      configRevision = undefined;
      draft = { ...EMPTY_DRAFT };
      headers = [];
      originalHeaderNames = [];
      skipConnectionTest = false;
      tested = false;
      pending = undefined;
      setError(undefined);
      open = true;
      draftGeneration += 1;
      publish();
    },

    openExisting: async (provider) => {
      editingProviderId = provider.providerId || undefined;
      configRevision = provider.configRevision;
      draft = {
        name: provider.name,
        baseUrl: provider.baseUrl ?? "",
        apiKey: "",
        apiFormat: provider.apiFormat ?? "openai-completions",
        modelIdText: provider.models.map((model) => model.modelId).filter(Boolean).join("\n"),
      };
      // Saved rows are names only: a blank value with its persisted name keeps
      // the stored value unless the row is renamed or removed.
      originalHeaderNames = provider.headerNames ?? [];
      headers = originalHeaderNames.map((name, index) => ({
        id: `${provider.providerId || "new"}-${index}`,
        name,
        value: "",
        persistedName: name,
      }));
      skipConnectionTest = false;
      tested = false;
      open = true;
      draftGeneration += 1;
      const generation = begin("open");
      publish();
      try {
        // Reveal-on-open keeps its current permission semantics: the runtime
        // decides whether the value may be read at all.
        const revealed = await commands.revealApiKey(provider.providerId);
        if (generation !== operationGeneration || disposed) return;
        draft = { ...draft, apiKey: revealed };
        tested = false;
      } catch (reason) {
        settle(generation, formatWebuiError(reason));
        return;
      }
      settle(generation);
    },

    changeField: (field, value) => {
      draft = { ...draft, [field]: value };
      // A changed field changes what the candidate means: any earlier test no
      // longer describes this draft.
      tested = false;
      draftGeneration += 1;
      publish();
    },

    setHeaders: (rows) => {
      headers = rows;
      tested = false;
      draftGeneration += 1;
      publish();
    },

    addHeader: () => {
      headers = [...headers, { id: `new-${Date.now()}-${headers.length}`, name: "", value: "" }];
      tested = false;
      draftGeneration += 1;
      publish();
    },

    removeHeader: (id) => {
      headers = headers.filter((row) => row.id !== id);
      tested = false;
      draftGeneration += 1;
      publish();
    },

    setSkipConnectionTest: (skip) => {
      skipConnectionTest = skip;
      publish();
    },

    test: async () => {
      const modelId = firstModelId();
      if (!modelId) return;
      const built = candidate();
      if (!built.ok) {
        setError(built.reason);
        publish();
        return;
      }
      const generation = begin("test");
      const draftAtStart = draftGeneration;
      publish();
      try {
        const result = await commands.testCandidate({ candidate: built.value, modelId });
        if (generation !== operationGeneration || disposed) return;
        const record =
          result !== null && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        // The producer answers `{ ok, status }` for this operation; a refusal
        // carries the reason on its status.
        if (record.ok !== true) {
          const status =
            record.status !== null && typeof record.status === "object"
              ? (record.status as Record<string, unknown>)
              : {};
          const message =
            typeof status.lastErrorMessage === "string" && status.lastErrorMessage
              ? status.lastErrorMessage
              : "连接失败";
          settle(generation, message);
          return;
        }
        // Only the draft this test described may be marked tested.
        tested = draftAtStart === draftGeneration;
        settle(generation);
      } catch (reason) {
        settle(generation, formatWebuiError(reason));
      }
    },

    discover: async () => {
      if (editingProviderId === undefined || configRevision === undefined) return;
      const baseUrl = draft.baseUrl.trim();
      if (!baseUrl) {
        setError("请先填写接口地址");
        publish();
        return;
      }
      const generation = begin("discover");
      publish();
      try {
        const result = await commands.discoverCandidate({
          providerId: editingProviderId,
          expectedRevision: configRevision,
          baseUrl,
        });
        if (generation !== operationGeneration || disposed) return;
        const ids = Array.isArray(result)
          ? result
              .map((entry) =>
                entry !== null && typeof entry === "object"
                  ? (entry as Record<string, unknown>).modelId
                  : undefined,
              )
              .filter((modelId): modelId is string => typeof modelId === "string")
          : [];
        if (ids.length) draft = { ...draft, modelIdText: ids.join("\n") };
        tested = false;
        settle(generation);
      } catch (reason) {
        settle(generation, formatWebuiError(reason));
      }
    },

    save: async () => {
      if (!tested && !skipConnectionTest) return;
      const built = candidate();
      if (!built.ok) {
        setError(built.reason);
        publish();
        return;
      }
      const generation = begin("save");
      const first = firstModelId();
      publish();
      try {
        const result = await commands.saveCandidate({
          candidate: built.value,
          modelId: first,
          saveAndUse: false,
          skipConnectionTest,
        });
        if (generation !== operationGeneration || disposed) return;
        const record =
          result !== null && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        if (record.success !== true) {
          settle(generation, "保存失败");
          return;
        }
        // The form view ends on a successful save; the Models workflow owns the
        // catalogue invalidation that follows.
        open = false;
        settle(generation);
        publish();
      } catch (reason) {
        settle(generation, formatWebuiError(reason));
      }
    },

    remove: async () => {
      if (editingProviderId === undefined) return;
      const target = editingProviderId;
      const generation = begin("delete");
      publish();
      try {
        await commands.deleteProvider(target);
        if (generation !== operationGeneration || disposed) return;
        settle(generation);
      } catch (reason) {
        settle(generation, formatWebuiError(reason));
      }
    },

    close: () => {
      open = false;
      pending = undefined;
      operationGeneration += 1;
      setError(undefined);
      publish();
    },

    clearError: () => {
      if (disposed) return;
      setError(undefined);
      publish();
    },

    dispose: () => {
      if (disposed) return;
      disposed = true;
      open = false;
      pending = undefined;
      operationGeneration += 1;
      // Credential-bearing fields do not outlive the editor.
      draft = { ...draft, apiKey: "" };
      headers = [];
      originalHeaderNames = [];
      // Refresh what a reader sees without notifying: disposal is terminal, so
      // there is no transition for a subscriber to react to.
      snapshot = currentSnapshot();
      listeners.clear();
    },
  };
}
