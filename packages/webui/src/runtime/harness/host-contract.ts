// The surface of the runtime `cliService` the WebUI forwards to, and the
// harness host handle the runtime assembly hands to the adapter.
//
// This file states the members the WebUI forwards, and its member types are the
// WebUI's own wire projections of what the runtime returns. `runtime/assembly.ts`
// types the *options* it forwards against the real `CreateLocalRuntimeHostOptions`
// (the inputs are checked, not mirrored). The results are the remaining gap: a
// runtime view type (`SessionPage`, `GetMessagesResult`, ...) does not satisfy the
// wire projection declared for it here, which is why the factory's return still
// carries one assertion. Closing that gap means deriving each member and
// converting explicitly at the adapter.
//
// The six personalization members this interface used to declare
// (`getGlobalInstructions`, `setGlobalInstructions`, `getAgentMemory`,
// `setAgentMemory`, `getUserProfile`, `setUserProfile`) were called by no
// adapter and exist on no runtime host: the settings adapter reads and writes
// the profile files itself (`harness/settings.ts` -> `profile-files.ts`).

import type {
  WebuiSessionListRequest,
  WebuiSessionPage,
  WebuiSessionTreeRequest,
  WebuiSessionTreePage,
  WebuiProjectRecord,
  WebuiCreateSessionRequest,
  WebuiCreateSessionResult,
  WebuiGetSessionDiffRequest,
  WebuiGetSessionDiffResult,
  WebuiGetTurnDiffRequest,
  WebuiGetTurnDiffResult,
  WebuiRevertTurnDiffRequest,
  WebuiRevertTurnDiffResult,
  WebuiReapplyTurnDiffRequest,
  WebuiReapplyTurnDiffResult,
  WebuiGetSessionForkOptionsRequest,
  WebuiGetSessionForkOptionsResult,
  WebuiForkSessionRequest,
  WebuiForkSessionResult,
  WebuiGetSessionRewindPreviewRequest,
  WebuiGetSessionRewindPreviewResult,
  WebuiRewindSessionRequest,
  WebuiRewindSessionResult,
  WebuiEditSessionMessageRequest,
  WebuiEditSessionMessageResult,
} from "../../shared/contracts/session.js";
import type {
  WebuiSendMessageRequest,
  WebuiSendMessageResult,
  WebuiResumeSessionRequest,
  WebuiStreamResult,
  WebuiRuntimeEvent,
} from "../../shared/contracts/stream.js";
import type {
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiQueueItem,
} from "../../shared/contracts/queue.js";
import type {
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
  WebuiQuestionnaireAnswer,
  WebuiInteractionReplyResult,
  WebuiPermissionDecision,
} from "../../shared/contracts/interactions.js";
import type {
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
  WebuiWorkspaceArchiveListing,
  WebuiWorkspaceArchiveExtractResult,
  WebuiWorkspaceEnvironment,
  WebuiWorkspaceGitMutationRequest,
} from "../../shared/contracts/workspace.js";
import type {
  WebuiWorkspaceReviewDiffs,
  WebuiWorkspaceReviewFileContent,
  WebuiWorkspaceReviewSearchResult,
  WebuiWorkspaceReviewSummary,
} from "../../shared/contracts/review.js";
import type { WebuiCanvasDocument } from "../../shared/contracts/canvas.js";
import type { WebuiModelEntry } from "../../shared/contracts/models.js";
import type {
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalPatchRequest,
} from "../../shared/contracts/goal.js";
import type { WebuiMemorySettingsView } from "../../shared/contracts/personalization.js";

/**
 * The members the WebUI forwards to the runtime `cliService`. The runtime
 * harness satisfies this shape, and the WebUI's only job is to forward requests
 * here. Methods optional on the live cliService stay optional here too —
 * `createHarnessPortFromHost` projects them back with `requireCliService` so
 * every wire-error is a single, uniform `runtime host does not expose the CLI
 * service` message.
 *
 * Exported as the single source of truth so the assembly layer can type its
 * `cliService?: WebuiRuntimeCliService` slot without re-spelling it.
 */
export interface WebuiRuntimeCliService {
  listVisibleProjects?(limit?: number): Promise<readonly WebuiProjectRecord[]>;
  listSessions(
    request: WebuiSessionListRequest,
    context?: Record<string, never>,
  ): Promise<WebuiSessionPage>;
  pluginManagement(request: import("../../shared/plugin-management.js").WebuiPluginManagementRequest): Promise<unknown>;
  getSessionTree(
    request: WebuiSessionTreeRequest,
    context?: Record<string, never>,
  ): Promise<WebuiSessionTreePage>;
  archiveSession(
    request: { readonly id: string; readonly archived?: boolean },
    context?: Record<string, never>,
  ): Promise<{ readonly success?: boolean }>;
  deleteSession(
    request: { readonly id: string },
    context?: Record<string, never>,
  ): Promise<{ readonly success?: boolean }>;
  updateSession(
    request: import("../../shared/contracts/session.js").WebuiUpdateSessionRequest,
    context?: Record<string, never>,
  ): Promise<import("../../shared/contracts/session.js").WebuiUpdateSessionResult>;
  getSessionForkOptions(
    request: WebuiGetSessionForkOptionsRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetSessionForkOptionsResult>;
  forkSession(
    request: WebuiForkSessionRequest,
    context?: Record<string, never>,
  ): Promise<WebuiForkSessionResult>;
  createSession(
    request: WebuiCreateSessionRequest,
    context?: Record<string, never>,
  ): Promise<WebuiCreateSessionResult>;
  getSession(
    request: import("../../shared/contracts/session.js").WebuiSessionLookupRequest,
    context?: Record<string, never>,
  ): Promise<import("../../shared/contracts/session.js").WebuiSessionLookupResult>;
  getMessages(
    request: import("../../shared/contracts/messages.js").WebuiMessagesRequest,
    context?: Record<string, never>,
  ): Promise<import("../../shared/contracts/messages.js").WebuiMessagesResult>;
  exportSessionTransfer(sessionId: string): Promise<import("../../shared/contracts/session.js").WebuiSessionTransferFile>;
  importSessionTransfer(
    request: import("../../shared/contracts/session.js").WebuiImportSessionTransferRequest,
  ): Promise<import("../../shared/contracts/session.js").WebuiImportSessionTransferResult>;
  getSessionDiff(
    request: WebuiGetSessionDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetSessionDiffResult>;
  getTurnDiff(
    request: WebuiGetTurnDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetTurnDiffResult>;
  revertTurnDiff(
    request: WebuiRevertTurnDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiRevertTurnDiffResult>;
  reapplyTurnDiff(
    request: WebuiReapplyTurnDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiReapplyTurnDiffResult>;
  getSessionRewindPreview(
    request: WebuiGetSessionRewindPreviewRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetSessionRewindPreviewResult>;
  rewindSession(
    request: WebuiRewindSessionRequest,
    context?: Record<string, never>,
  ): Promise<WebuiRewindSessionResult>;
  editSessionMessage(
    request: WebuiEditSessionMessageRequest,
    context?: Record<string, never>,
  ): Promise<WebuiEditSessionMessageResult>;
  getActiveTurn(
    sessionId: string,
  ): Promise<import("../../shared/contracts/session.js").WebuiActiveTurn | undefined>;
  isGoalEnabled(): boolean;
  getGoal(sessionId: string): Promise<WebuiGoal | undefined>;
  createGoal(request: WebuiGoalCreateRequest): Promise<WebuiGoal>;
  patchGoal(
    sessionId: string,
    patch: Omit<WebuiGoalPatchRequest, "sessionId">,
  ): Promise<WebuiGoal>;
  clearGoal(sessionId: string): Promise<boolean>;
  listWorkspaceFileTree?(request: { readonly workspaceDir: string; readonly path?: string }): Promise<readonly WebuiWorkspaceFile[]>;
  readWorkspaceFile?(request: { readonly workspaceDir: string; readonly path: string }): Promise<WebuiWorkspaceFileContent>;
  searchWorkspaceFiles?(input: { readonly workspaceDir: string; readonly query: string; readonly limit: number }): Promise<readonly string[]>;
  /**
   * Archive listing and extraction are served by this package
   * (`./workspace-archive.ts`, Node built-ins only) rather than by the runtime,
   * so these two stay optional: a host that has a richer implementation of its
   * own still wins, and a host that has none gets the WebUI's reader instead of
   * an error the panel can only show.
   */
  readWorkspaceArchive?(request: { readonly workspaceDir: string; readonly path: string; readonly prefix?: string }): Promise<WebuiWorkspaceArchiveListing>;
  extractWorkspaceArchive?(request: { readonly workspaceDir: string; readonly path: string; readonly destination: string; readonly prefix?: string }): Promise<WebuiWorkspaceArchiveExtractResult>;
  getWorkspaceGitEnvironment?(workspaceDir: string): Promise<{ readonly metadata: Record<string, unknown>; readonly changes: Record<string, unknown> }>;
  mutateWorkspaceGit?(request: WebuiWorkspaceGitMutationRequest): Promise<Record<string, unknown>>;
  /**
   * The review and canvas members below answer with the runtime's own view
   * types, not with the WebUI's wire projections. That is deliberate: the
   * adapter owns the conversion (see `result-conversion.ts`), and declaring the
   * WebUI's shape here would have made the runtime's answer structurally
   * incompatible with the declaration it is checked against — which is what the
   * assembly's single whole-layer assertion used to paper over.
   *
   * They are therefore declared as records, which is the honest statement of
   * "the runtime decides the shape and the adapter reads it". A member whose
   * answer the adapter passes through unchanged keeps its precise type below.
   */
  getWorkspaceReviewSummary?(workspaceDir: string): Promise<unknown>;
  listWorkspaceReviewFileDiffs?(input: {
    workspaceDir: string;
    reviewSnapshotId: string;
    fileIds?: string[];
  }): Promise<unknown>;
  getWorkspaceReviewFileContent?(input: {
    workspaceDir: string;
    reviewSnapshotId: string;
    fileId: string;
    side: "old" | "new";
  }): Promise<unknown>;
  searchWorkspaceReviewDiffs?(input: {
    workspaceDir: string;
    reviewSnapshotId: string;
    query: string;
    includeUntrackedFiles: boolean;
    pageIndex?: number;
    pageSize?: number;
  }): Promise<unknown>;
  readCanvas?(request: { readonly sessionId: string }): Promise<unknown>;
  applyCanvas?(request: { readonly sessionId: string; readonly operation: Record<string, unknown> }): Promise<unknown>;
  sendMessage(
    request: WebuiSendMessageRequest,
    context?: { readonly signal?: AbortSignal },
  ): Promise<WebuiSendMessageResult>;
  enqueueMessage(
    request: WebuiEnqueueMessageRequest,
    context?: { readonly signal?: AbortSignal },
  ): Promise<WebuiEnqueueMessageResult>;
  resumeSession(
    request: WebuiResumeSessionRequest,
    context?: { readonly signal?: AbortSignal },
  ): Promise<WebuiStreamResult>;
  watchEvents(signal?: AbortSignal): AsyncIterable<WebuiRuntimeEvent>;
  /**
   * The runtime's result makes `requests` optional (`ListPendingPermissionsResult.requests?`)
   * and its own input type is an empty record, so the adapter passes `{}`-shaped
   * calls and normalises a missing list to `[]` — see the comment in
   * `harness/interactions.ts`. The declaration stays hand-written for now: its
   * element type (`PendingPermissionItem`, every field optional) does not satisfy
   * `WebuiPendingPermission` (every field required), which is a wire-shape
   * decision the derivation pass has to make member by member.
   */
  listPendingPermissions(): Promise<{
    readonly requests: readonly WebuiPendingPermission[];
  }>;
  getPendingQuestionnaire(request: {
    readonly name: string;
    readonly sessionId: string;
  }): Promise<{ readonly request?: WebuiQuestionnaireRequest }>;
  replyPermission(request: {
    readonly name: string;
    readonly requestId: string;
    readonly reply: number;
  }): Promise<WebuiInteractionReplyResult>;
  replyQuestionnaire(request: {
    readonly name: string;
    readonly requestId: string;
    readonly schemaVersion: number;
    readonly answers: readonly WebuiQuestionnaireAnswer[];
  }): Promise<WebuiInteractionReplyResult>;
  dismissQuestionnaire(request: {
    readonly name: string;
    readonly requestId: string;
  }): Promise<WebuiInteractionReplyResult>;
  abortSession(request: {
    readonly id: string;
  }): Promise<{ readonly success?: boolean }>;
  listQueueMessages(request: { readonly id: string }): Promise<{
    readonly items?: readonly WebuiQueueItem[];
    readonly paused?: boolean;
    readonly pendingCount?: number;
  }>;
  deleteQueueItem(request: {
    readonly id: string;
    readonly itemId: string;
  }): Promise<{ readonly item?: WebuiQueueItem }>;
  listModels(request?: {
    readonly sessionId?: string;
  }): Promise<readonly WebuiModelEntry[]>;
  /**
   * The cliService returns the harness `SkillInfo[]`; the host then projects
   * it down to `WebuiSkillEntry[]` for the WebUI client. The structural type
   * spells out the wider shape (incl. `displayDescription` for i18n) so the
   * field-selection logic in `listSkills()` below type-checks.
   */
  listSkills(request?: {
    readonly agentName?: string;
  }): Promise<{
    readonly skills: readonly {
      readonly name: string;
      readonly displayName?: string;
      readonly description?: string;
      readonly displayDescription?: string;
    }[];
  }>;
  getPermissionMode(): Promise<unknown>;
  setPermissionMode(request: {
    readonly mode: "default" | "auto" | "bypassPermissions";
  }): Promise<unknown>;
  /**
   * Optional on purpose: a host without the configuration capability still has
   * to type-check. `requireMemorySettings` fails closed with one clear message
   * rather than crashing on `undefined` — a missing method is not the same
   * statement as `enabled: false`.
   */
  getMemorySettings?(): Promise<WebuiMemorySettingsView>;
  setMemorySettings?(request: {
    readonly enabled?: boolean;
    readonly proactive?: boolean;
  }): Promise<WebuiMemorySettingsView>;
  /**
   * The model selection the runtime answers with a verdict, not an object.
   *
   * Declared here rather than as `CliService["selectModel"]`: this file is the
   * WebUI's own statement of the runtime surface, and reaching into the runtime
   * package's types made the WebUI's boundary a function of a type it does not
   * own — a rename on the runtime side would then move the WebUI's result
   * contract, which is supposed to stay independently owned. The runtime's
   * signature is `{ providerId, modelId, variant?, contextLimit?, sessionId? }`
   * in, `Promise<boolean>` out; this is that, written down.
   *
   * The application contract is `models.select(input): Promise<boolean>`, so the
   * adapter maps that verdict to the wire's `{ success }` instead of forwarding
   * it. Declaring `Promise<{ success?: boolean }>` here (as this mirror once did)
   * is exactly what made the raw forward look correct while the client's refusal
   * check could not fire.
   */
  selectModel(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly contextLimit?: number;
    readonly sessionId?: string;
  }): Promise<boolean>;
  getSessionUsage(request: {
    readonly id: string;
  }): Promise<Record<string, unknown>>;
  getAccountStatus(request?: {
    readonly sessionId?: string;
  }): Promise<Record<string, unknown>>;
  listUserModelProviders(): Promise<readonly Record<string, unknown>[]>;
  createUserModelProvider(request: Record<string, unknown>): Promise<unknown>;
  updateUserModelProvider(request: Record<string, unknown>): Promise<unknown>;
  deleteUserModelProvider(request: { readonly providerId: string }): Promise<unknown>;
  testUserModelProvider(request: { readonly providerId: string; readonly apiKey?: string }): Promise<unknown>;
  testUserModel(request: { readonly providerId: string; readonly modelId: string }): Promise<unknown>;
  discoverUserModelsCandidate(request: Record<string, unknown>): Promise<unknown>;
  saveUserModelProviderCandidate(request: Record<string, unknown>): Promise<unknown>;
  listProviderPresets(): Promise<readonly Record<string, unknown>[]>;
  getMiniMaxApiKeyStatus(): Promise<Record<string, unknown>>;
  upsertMiniMaxApiKey(request: { readonly apiKey: string; readonly saveAndUse?: boolean }): Promise<unknown>;
  getCodexOAuthStatus(): Promise<Record<string, unknown>>;
  getMiniMaxModelSource(): Promise<"token_plan" | "minimax_api_key">;
  setMiniMaxModelSource(request: { readonly source: "token_plan" | "minimax_api_key" }): Promise<"token_plan" | "minimax_api_key">;
  testUserModelCandidate(request: { readonly candidate: Record<string, unknown>; readonly modelId: string }): Promise<unknown>;
  revealModelProviderApiKey(request: { readonly providerId: string }): Promise<string>;
  startCodexOAuthLogin(request?: Record<string, unknown>): Promise<unknown>;
  cancelCodexOAuthLogin(request: { readonly loginId: string }): Promise<unknown>;
  refreshModels(): Promise<unknown>;
  /**
   * Compaction is opt-in on the live harness: the `CliService` exposes it
   * only when the host has a meaningful reducer, and the WebUI surface
   * surfaces `runtime host does not expose requestCompaction` for any host
   * that omits it. The runner's `/compact` path therefore can't assume the
   * method always exists, which is why the port's `requestCompaction` is
   * a required harness-port method: the assembly is responsible for
   * projecting an `optional` cliService hook into a `required` port entry,
   * and failing closed otherwise. See `createHarnessPortFromHost` for the
   * nested-guard pattern that turns that `?` into a clear error.
   */
  requestCompaction?(request: {
    readonly name: string;
    readonly id: string;
    readonly reason: "ui_request";
    readonly customInstructions?: string;
  }): Promise<Record<string, unknown>>;
}

export interface WebuiRuntimeHostHandle {
  readonly apiHost: { close(): Promise<void> };
  readonly appVersion?: string;
  readonly dataDir?: string;
  readonly invalidateAuth?: () => void;
  /**
   * Cloud quota for the usage panel. Backed by `usage-quota.ts`, not the
   * harness — the assembly supplies the client alongside the host.
   */
  readonly getUsageQuota?: (request?: {
    readonly forceRefresh?: boolean;
  }) => Promise<import("../../shared/contracts/usage-quota.js").WebuiUsageQuotaResult>;
  /**
   * Daily check-in status/claim. Backed by `check-in.ts` (cloud), supplied
   * by the assembly alongside the host.
   */
  readonly getSigninPanel?: () => Promise<import("../../shared/contracts/account.js").WebuiSigninPanelView>;
  readonly claimSignin?: () => Promise<import("../../shared/contracts/account.js").WebuiClaimSigninView>;
  /**
   * Account login (device authorization) and real sign-out. Supplied by the
   * assembly from its `MCodeOAuthCore` — the same credential store the quota
   * lease reads — so a login completed in the browser is the same credential
   * the terminal client uses, and a sign-out actually removes it.
   */
  readonly beginAccountLogin?: () => Promise<import("../../shared/contracts/account.js").WebuiAccountLoginView>;
  readonly getAccountLoginStatus?: () => Promise<import("../../shared/contracts/account.js").WebuiAccountLoginView>;
  readonly cancelAccountLogin?: () => Promise<void>;
  readonly signOutAccount?: () => Promise<{ readonly status: string; readonly generation: number }>;
  /**
   * Source of every harness command the WebUI maps to operations. Owned by
   * the runtime host; the WebUI only needs the structural shape to forward.
   */
  readonly cliService?: WebuiRuntimeCliService;
}
