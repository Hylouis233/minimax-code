// The per-business port slices (plan §8 Phase 2, ticket #60).
//
// **Why this module exists.** Phase 1 re-filed the port *declarations* by
// business (§9). That made the seam legible; it did not narrow it. Until this
// module, the shell still held one composed object and forwarded 47 of its
// members as props, so every business could reach every capability and the
// boundary was a naming convention. A directory re-file does not narrow the
// seam — only narrowing the seam does, and narrowing it means handing each
// business a *slice* it cannot see out of.
//
// So each business gets one slice here, built from an explicit key list, and a
// slice is a new object: it carries the members the business is allowed to use
// and nothing else. The key lists are the old-to-new mapping, recorded as data:
//
// | business | slice | port(s) | the shell props it replaces |
// | --- | --- | --- | --- |
// | `sessions` | `WebuiSessionsSlice` | `SessionPort` | `loadProjects`, `listArchivedSessions`, `loadSessions`, `loadSessionTree`, `createSession`, `archiveSession`, `deleteSession`, `updateSession`, `getSessionForkOptions`, `forkSession`, `getSessionUsage` |
// | `transcript` | `WebuiTranscriptSlice` | `TranscriptPort` | `loadMessages`, `getSessionDiff`, `getTurnDiff`, `revertTurnDiff`, `reapplyTurnDiff`, `getSessionRewindPreview`, `rewindSession`, `editSessionMessage` |
// | `workspace` | `WebuiWorkspaceSlice` | `WorkspacePort` + `TerminalPort` | the fourteen workspace members plus the six terminal ones |
// | `composer` | `WebuiComposerSlice` | `ComposerPort` | `runCommand`, `enqueueMessage`, `listQueueMessages`, `deleteQueueItem` |
// | `interactions` | `WebuiInteractionsSlice` | `InteractionPort` | `listPendingPermissions`, `getPendingQuestionnaire`, `replyPermission`, `replyQuestionnaire`, `dismissQuestionnaire` |
// | `goal` | `WebuiGoalSlice` | `GoalPort` | `isGoalEnabled`, `getGoal`, `createGoal`, `patchGoal`, `clearGoal` |
// | `models` | `WebuiModelsSlice` | `ModelsPort` | the fifteen catalogue, selection and provider members |
// | `plugins` | `WebuiPluginsSlice` | `PluginPort` | `pluginManagement`, `listSkills` |
// | `settings` | `WebuiSettingsSlice` | `SettingsPort` | the seventeen instruction / memory / profile / permission / source members |
// | `account` | `WebuiAccountSlice` | `AccountPort` | the eight login, signin and quota members |
// | `shell` | `WebuiShellSlice` | `ShellEventPort` | `watchEvents` |
// | `turn` | `WebuiTurnCapabilitySlice` | `TurnExecutionPort` (+ the queue write, the message loader and the session creator its send path needs) | the capability slice ticket #57 published |
//
// **`turn` is not a `Pick` of one port, and that is the plan's shape, not an
// exception.** §4.12 has `turn` read the execution slice *and* the session slice
// for messages, and §8 Phase 1 step 1 already published exactly that object. This
// module re-uses `createWebuiTurnCapabilitySlice` rather than declaring a second
// turn slice, so there is one construction site for it.
//
// **Optionality is carried verbatim, and that is the whole risk.** Every port
// member is optional. A slice copies the member's value, so an operation the host
// does not wire stays `undefined` in the slice, exactly as it was `undefined` on
// the composed transport — `WebuiClientFoundationApp`'s `transport?` prop and its
// "not wired" mode keep working, and a consumer reads `slice.X === undefined` the
// way it used to read `transport?.X === undefined`. `Partial` is preserved in the
// same places: `sendMessage?`, `resumeSession?`, `watchEvents?` among them.
//
// Nothing consumes these slices yet: ticket #60 only makes them exist and be
// injectable, so reverting its commit leaves the tree green. A4-s2 wires the
// provider, A4-s3/s4 move the consumers, A4-s5 is where the shell forwards zero
// transport members.

import type { AccountPort } from "../contracts/account/account-port.js";
import type { ComposerPort } from "../contracts/composer/command-port.js";
import type { GoalPort } from "../contracts/goal/goal-port.js";
import type { InteractionPort } from "../contracts/interactions/interaction-port.js";
import type { ModelsPort } from "../contracts/models/provider-port.js";
import type { PluginPort } from "../contracts/plugins/plugin-port.js";
import type { SessionPort } from "../contracts/sessions/session-port.js";
import type { SettingsPort } from "../contracts/settings/settings-port.js";
import type { ShellEventPort } from "../contracts/shell/watch-port.js";
import type { TranscriptPort } from "../features/transcript/contracts/session-read-port.js";
import type { TurnExecutionPort } from "../contracts/turn/execution-port.js";
import type { TerminalPort } from "../contracts/workspace/terminal-port.js";
import type { WorkspacePort } from "../contracts/workspace/workspace-port.js";
import {
  createWebuiTurnCapabilitySlice,
  type WebuiTurnCapabilitySlice,
} from "./turn/turn-capabilities.js";

/**
 * The port object the slices are cut from. `WebuiTransport` satisfies it
 * structurally, and so does a partial fixture — every member is optional, so a
 * test can hand in only the two operations it exercises.
 */
export interface WebuiPortSliceSource
  extends SessionPort,
    TranscriptPort,
    TurnExecutionPort,
    ComposerPort,
    ShellEventPort,
    InteractionPort,
    GoalPort,
    WorkspacePort,
    TerminalPort,
    SettingsPort,
    ModelsPort,
    AccountPort,
    PluginPort {}

// The key lists below are the old-to-new mapping as data. Each is checked
// against its port by `satisfies`, so a renamed or removed member stops the
// build instead of silently dropping out of a slice.
const SESSIONS_KEYS = [
  "loadProjects",
  "listArchivedSessions",
  "loadSessions",
  "loadSessionTree",
  "createSession",
  "archiveSession",
  "deleteSession",
  "updateSession",
  "getSessionForkOptions",
  "forkSession",
  "getSessionUsage",
] as const satisfies readonly (keyof SessionPort)[];

const TRANSCRIPT_KEYS = [
  "loadMessages",
  "getSessionDiff",
  "getTurnDiff",
  "revertTurnDiff",
  "reapplyTurnDiff",
  "getSessionRewindPreview",
  "rewindSession",
  "editSessionMessage",
] as const satisfies readonly (keyof TranscriptPort)[];

const WORKSPACE_KEYS = [
  "listWorkspaceFileTree",
  "browseWorkspaceDirs",
  "readWorkspaceFile",
  "getWorkspaceEnvironment",
  "mutateWorkspaceGit",
  "getWorkspaceReviewSummary",
  "listWorkspaceReviewFileDiffs",
  "getWorkspaceReviewFileContent",
  "searchWorkspaceReviewDiffs",
  "readCanvas",
  "applyCanvas",
  "workspaceFileUrl",
  "readWorkspaceArchive",
  "extractWorkspaceArchive",
] as const satisfies readonly (keyof WorkspacePort)[];

const TERMINAL_KEYS = [
  "createTerminal",
  "listTerminals",
  "writeTerminal",
  "resizeTerminal",
  "disposeTerminal",
  "watchTerminal",
] as const satisfies readonly (keyof TerminalPort)[];

const COMPOSER_KEYS = [
  "runCommand",
  "enqueueMessage",
  "listQueueMessages",
  "deleteQueueItem",
] as const satisfies readonly (keyof ComposerPort)[];

const INTERACTIONS_KEYS = [
  "listPendingPermissions",
  "getPendingQuestionnaire",
  "replyPermission",
  "replyQuestionnaire",
  "dismissQuestionnaire",
] as const satisfies readonly (keyof InteractionPort)[];

const GOAL_KEYS = [
  "isGoalEnabled",
  "getGoal",
  "createGoal",
  "patchGoal",
  "clearGoal",
] as const satisfies readonly (keyof GoalPort)[];

const MODELS_KEYS = [
  "listModels",
  "selectModel",
  "listUserModelProviders",
  "createUserModelProvider",
  "updateUserModelProvider",
  "deleteUserModelProvider",
  "testUserModelProvider",
  "testUserModel",
  "discoverUserModelsCandidate",
  "saveUserModelProviderCandidate",
  "listProviderPresets",
  "upsertMiniMaxApiKey",
  "testUserModelCandidate",
  "revealModelProviderApiKey",
  "refreshModels",
] as const satisfies readonly (keyof ModelsPort)[];

const PLUGINS_KEYS = [
  "pluginManagement",
  "listSkills",
] as const satisfies readonly (keyof PluginPort)[];

const SETTINGS_KEYS = [
  "version",
  "getPermissionMode",
  "setPermissionMode",
  "getGlobalInstructions",
  "setGlobalInstructions",
  "getAgentMemory",
  "setAgentMemory",
  "getUserProfile",
  "setUserProfile",
  "getMemorySettings",
  "setMemorySettings",
  "getMiniMaxApiKeyStatus",
  "getCodexOAuthStatus",
  "getMiniMaxModelSource",
  "setMiniMaxModelSource",
  "startCodexOAuthLogin",
  "cancelCodexOAuthLogin",
] as const satisfies readonly (keyof SettingsPort)[];

const ACCOUNT_KEYS = [
  "getUsageQuota",
  "getSigninPanel",
  "claimSignin",
  "beginAccountLogin",
  "getAccountLoginStatus",
  "cancelAccountLogin",
  "getAccountStatus",
  "signOut",
] as const satisfies readonly (keyof AccountPort)[];

const SHELL_KEYS = ["watchEvents"] as const satisfies readonly (keyof ShellEventPort)[];

export type WebuiSessionsSlice = Pick<SessionPort, (typeof SESSIONS_KEYS)[number]>;
export type WebuiTranscriptSlice = Pick<TranscriptPort, (typeof TRANSCRIPT_KEYS)[number]>;
export type WebuiWorkspaceSlice = Pick<WorkspacePort, (typeof WORKSPACE_KEYS)[number]> &
  Pick<TerminalPort, (typeof TERMINAL_KEYS)[number]>;
export type WebuiComposerSlice = Pick<ComposerPort, (typeof COMPOSER_KEYS)[number]>;
export type WebuiInteractionsSlice = Pick<
  InteractionPort,
  (typeof INTERACTIONS_KEYS)[number]
>;
export type WebuiGoalSlice = Pick<GoalPort, (typeof GOAL_KEYS)[number]>;
export type WebuiModelsSlice = Pick<ModelsPort, (typeof MODELS_KEYS)[number]>;
export type WebuiPluginsSlice = Pick<PluginPort, (typeof PLUGINS_KEYS)[number]>;
export type WebuiSettingsSlice = Pick<SettingsPort, (typeof SETTINGS_KEYS)[number]>;
export type WebuiAccountSlice = Pick<AccountPort, (typeof ACCOUNT_KEYS)[number]>;
export type WebuiShellSlice = Pick<ShellEventPort, (typeof SHELL_KEYS)[number]>;
export type WebuiTurnSlice = WebuiTurnCapabilitySlice;

/** One slice per business. */
export interface WebuiPortSlices {
  readonly sessions: WebuiSessionsSlice;
  readonly transcript: WebuiTranscriptSlice;
  readonly workspace: WebuiWorkspaceSlice;
  readonly composer: WebuiComposerSlice;
  readonly interactions: WebuiInteractionsSlice;
  readonly goal: WebuiGoalSlice;
  readonly models: WebuiModelsSlice;
  readonly plugins: WebuiPluginsSlice;
  readonly settings: WebuiSettingsSlice;
  readonly account: WebuiAccountSlice;
  readonly shell: WebuiShellSlice;
  readonly turn: WebuiTurnSlice;
}

/** The businesses a slice exists for. Sorted; the interface above mirrors it. */
export type WebuiPortSliceBusiness = keyof WebuiPortSlices;

/**
 * Cut a slice: a **new object** holding the named members and nothing else.
 * Copying rather than casting is the point — a cast to `Pick<…>` would leave the
 * rest of the composed transport reachable at runtime, which is exactly the
 * property this module exists to remove.
 */
function cut<S extends object, K extends keyof S>(
  source: S,
  keys: readonly K[],
): Pick<S, K> {
  const slice = {} as Pick<S, K>;
  for (const key of keys) slice[key] = source[key];
  return slice;
}

export function createWebuiPortSlices(
  source: WebuiPortSliceSource,
): WebuiPortSlices {
  return {
    sessions: cut(source, SESSIONS_KEYS),
    transcript: cut(source, TRANSCRIPT_KEYS),
    // Two ports, one business: §9 puts the terminal capability inside
    // `workspace`, so its slice is the intersection of the two cuts.
    workspace: { ...cut(source, WORKSPACE_KEYS), ...cut(source, TERMINAL_KEYS) },
    composer: cut(source, COMPOSER_KEYS),
    interactions: cut(source, INTERACTIONS_KEYS),
    goal: cut(source, GOAL_KEYS),
    models: cut(source, MODELS_KEYS),
    plugins: cut(source, PLUGINS_KEYS),
    settings: cut(source, SETTINGS_KEYS),
    account: cut(source, ACCOUNT_KEYS),
    shell: cut(source, SHELL_KEYS),
    // `turn`'s published slice, built by its own factory so there is exactly one
    // construction site for it (ticket #57). That factory drops an absent member
    // instead of storing `undefined` under it, so `turn` is the one slice whose
    // not-wired state is an absent key rather than a key holding `undefined` —
    // the same thing to every reader, and pinned by a test so it stays a
    // decision.
    turn: createWebuiTurnCapabilitySlice(source),
  };
}
