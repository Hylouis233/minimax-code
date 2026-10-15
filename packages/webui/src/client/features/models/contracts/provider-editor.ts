// The provider editor's published surface (plan §5.5).
//
// The editor's *policy* lives in `features/models/application/provider-editor.ts`;
// these are its public shapes, and they live in `contracts/` because the surface
// they publish is read by three roles that may not import an application module:
// the Models binding that owns the instance, the Settings UI that hosts it above
// the custom-tab conditional, and the panel that renders it. `contracts/` is the
// leaf every one of them may depend on.

import type {
  WebuiCreateUserModelProviderRequest,
  WebuiDiscoverUserModelsCandidateRequest,
  WebuiSaveUserModelProviderCandidateRequest,
  WebuiTestUserModelCandidateRequest,
  WebuiUpdateUserModelProviderRequest,
} from "../../../../shared/contracts/models.js";

/**
 * One editable header row. The read carries header *names* only, so a saved row
 * starts blank and keeps whatever is stored unless its row is renamed or removed
 * (`persistedName` is the name it was seeded from). Declared here rather than in
 * the projection that consumes it: this is the shape the editor publishes, and a
 * contract cannot import a projection.
 */
export interface ProviderHeaderDraft {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly persistedName?: string;
}

/**
 * The Models commands the editor drives. Structurally the provider CRUD members
 * of the models workflow, so the composition passes the workflow itself rather
 * than a second hand-built object.
 */
export interface WebuiProviderEditorCommands {
  readonly canManageProviders: boolean;
  readonly revealApiKey: (providerId: string) => Promise<string>;
  readonly createProvider: (
    body: WebuiCreateUserModelProviderRequest,
  ) => Promise<unknown>;
  readonly updateProvider: (
    body: WebuiUpdateUserModelProviderRequest,
  ) => Promise<unknown>;
  readonly deleteProvider: (providerId: string) => Promise<unknown>;
  readonly discoverCandidate: (
    body: WebuiDiscoverUserModelsCandidateRequest,
  ) => Promise<unknown>;
  readonly saveCandidate: (
    body: WebuiSaveUserModelProviderCandidateRequest,
  ) => Promise<unknown>;
  readonly testCandidate: (
    body: WebuiTestUserModelCandidateRequest,
  ) => Promise<unknown>;
}

export interface WebuiProviderEditorSnapshot {
  readonly open: boolean;
  readonly editingProviderId?: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiFormat: string;
  /** The model ids as typed, one per line. */
  readonly modelIdText: string;
  readonly headers: readonly ProviderHeaderDraft[];
  readonly skipConnectionTest: boolean;
  /** True while an operation is in flight; the form disables its controls on it. */
  readonly busy: boolean;
  readonly pending?: "test" | "discover" | "save" | "delete" | "open";
  readonly error?: string;
  /** Whether the *current* draft passed a connection test. */
  readonly tested: boolean;
  readonly canManageProviders: boolean;
  /** Whether the saved provider's revision is known, so discovery can be offered. */
  readonly canDiscover: boolean;
  /** The revision a write must carry; absent for a new provider. */
  readonly configRevision?: string;
}

export interface WebuiProviderEditorOptions {
  readonly commands: WebuiProviderEditorCommands;
  /** Called with the error the panel shows; absent reports nothing to the host. */
  readonly onError?: (message: string | undefined) => void;
}

export interface WebuiProviderEditor {
  readonly getSnapshot: () => WebuiProviderEditorSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** Start a new provider: a blank draft, no identity, no revision. */
  readonly openNew: () => void;
  /**
   * Edit a saved provider. The draft starts from the view, the engine field
   * carries the revision the write must present, and the connection test state
   * starts unproven — a saved provider has not been tested *in this draft*.
   */
  readonly openExisting: (provider: import("../../../../shared/contracts/models.js").WebuiModelProviderView) => Promise<void>;
  readonly changeField: (
    field: "name" | "baseUrl" | "apiKey" | "apiFormat" | "modelIdText",
    value: string,
  ) => void;
  readonly setHeaders: (rows: readonly ProviderHeaderDraft[]) => void;
  readonly addHeader: () => void;
  readonly removeHeader: (id: string) => void;
  readonly setSkipConnectionTest: (skip: boolean) => void;
  readonly test: () => Promise<void>;
  readonly discover: () => Promise<void>;
  readonly save: () => Promise<void>;
  readonly remove: () => Promise<void>;
  /**
   * End the form view. The draft is kept (the parent's tab-switch behaviour),
   * transient operation feedback is reset, and late completions are fenced.
   */
  readonly close: () => void;
  /** Clear the current error (a caller that routes it elsewhere). */
  readonly clearError: () => void;
  /**
   * Dispose the editor (leaving the Usage category or closing Settings). The
   * credential-bearing fields are cleared and every late completion is fenced; a
   * mutation already on its way still settles, in the workflow that owns it.
   */
  readonly dispose: () => void;
}
