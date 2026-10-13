// Models capability port (plan §9; ticket #59).
//
// The model catalogue, the selection command and the provider CRUD. §9 sends
// "models + providers" here, and §5.6 confirms the provider CRUD is this row's duty
// rather than `settings`' — `upsertMiniMaxApiKey` included, even though the *status*
// read beside it stays with `settings`.
//
// Every method stays optional — `undefined` means "the operation is not wired".

import type { WebuiModelEntry } from "../../../shared/contracts/models.js";
import type { WebuiModelSelectionRequest } from ".././models/model-view.js";

export interface ModelsPort {
  readonly listModels?: (request?: {
    readonly sessionId?: string;
  }) => Promise<readonly WebuiModelEntry[]>;
  readonly selectModel?: (
    request: WebuiModelSelectionRequest,
  ) => Promise<{ readonly success?: boolean }>;
  readonly listUserModelProviders?: () => Promise<readonly Record<string, unknown>[]>;
  readonly createUserModelProvider?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly updateUserModelProvider?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly deleteUserModelProvider?: (providerId: string) => Promise<unknown>;
  readonly testUserModelProvider?: (request: { readonly providerId: string; readonly apiKey?: string }) => Promise<unknown>;
  readonly testUserModel?: (request: {
    readonly providerId: string;
    readonly modelId: string;
  }) => Promise<unknown>;
  readonly discoverUserModelsCandidate?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly saveUserModelProviderCandidate?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly listProviderPresets?: () => Promise<readonly Record<string, unknown>[]>;
  readonly upsertMiniMaxApiKey?: (request: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }) => Promise<unknown>;
  readonly testUserModelCandidate?: (request: { readonly candidate: Record<string, unknown>; readonly modelId: string }) => Promise<unknown>;
  readonly revealModelProviderApiKey?: (request: { readonly providerId: string }) => Promise<string>;
  readonly refreshModels?: () => Promise<unknown>;
}
