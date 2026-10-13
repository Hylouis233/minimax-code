// SessionComposer — the message composer: slash palette, model picker,
// permission/questionnaire panels, goal banner, and submit
// pipeline.
//
// The shell imports `WebuiComposer` from this business module directly; there
// is no central component re-export layer.
//
// The component reads the stream/sending slices through the application
// bindings (`useWebuiSessionState` / `useWebuiSessionCommands`), which subscribe
// to the one application store and submit purpose-named commands and turn
// intents; the component holds no store writer and no sink factory.

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
} from "react";
import type {WebuiClientMessageEnqueuer} from "../../contracts/composer/command-port.js";
import type {WebuiClientMessageSender} from "../../contracts/turn/execution-port.js";
import { WebuiWorkspaceDirectoryBrowser } from "../workspace/WebuiWorkspaceDirectoryBrowser.js";
import type { WebuiClientMessageLoader } from "../../contracts/transcript/message-view.js";
import type { WebuiModelSelectionRequest } from "../../contracts/models/model-view.js";
import type { WebuiClientSessionCreator } from "../../contracts/sessions/session-port.js";
import type { WebuiClientSessionPage, WebuiClientSession } from "../../contracts/sessions/session-view.js";
import type { WebuiTransport } from "../../contracts/transport.js";
import { projectWebuiMessageToStreamMessage, readUsageNumber } from "../../projection/transcript/message-projection.js";
import { createWebuiGoalCoordinator } from "../../application/goal/goal-coordinator.js";
import {
  createWebuiInteractionCoordinator,
} from "../../application/interactions/interaction-coordinator.js";
import { latestContextUsage, readContextUsageSnapshot } from "../../projection/composer/context-usage.js";
import {
  contextUsagePopoverStyle,
  positionContextUsagePopover,
  sameContextUsagePlacement,
  type ContextUsagePlacement,
} from "../../projection/composer/context-usage-popover.js";
import {
  breakdownSegmentPercent,
  breakdownShareLabel,
  breakdownSwatchStyle,
  contextBreakdownRows,
  drawableBreakdownRows,
} from "../../projection/composer/context-breakdown.js";
import { isTokenPlanModel } from "../../projection/models/token-plan-model.js";
import type {
  WebuiComposerAttachment,
  WebuiComposerUrlReference,
} from "../../projection/composer/composer-interactions.js";
import { createWebuiComposerAttachStreamEffect } from "../../application/turn/turn-commands.js";
import {
  useWebuiInteractionCommands,
  useWebuiSessionCommands,
  useWebuiSessionGoal,
  useWebuiSessionPermissions,
  useWebuiSessionQuestionnaire,
  useWebuiSessionState,
} from "../../bindings/use-session-state.js";
import { useWebuiBrowserCapabilities } from "../../bindings/browser-capabilities.js";
import { ContextUsageIndicator } from "../sessions/ContextUsageIndicator.js";
import { useWebuiPortSlice } from "../../bindings/port-slices-context.js";
import { useWebuiEventEffectsRegistry } from "../../bindings/event-effects-context.js";
import { useWebuiVersionCells } from "../../bindings/version-cells.js";
import { useWebuiComposerStore } from "../../bindings/composer-store.js";
import { webuiSessionStatusType } from "../../projection/turn/stream-state.js";

/** Capability subset the session composer consumes. Single source of truth
 *  lives in `WebuiTransport`; this alias keeps the prop block free of
 *  per-key `WebuiTransport["x"]` redeclarations. */
type WebuiSessionComposerCapabilities = Pick<
  WebuiTransport,
  | "loadMessages"
  | "getTurnDiff"
  | "revertTurnDiff"
  | "reapplyTurnDiff"
  | "getSessionForkOptions"
  | "forkSession"
  | "getSessionRewindPreview"
  | "rewindSession"
  | "editSessionMessage"
>;
import type {
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalEnabledResult,
  WebuiGoalSessionRequest,
} from "../../../shared/contracts/goal.js";
import type {
  WebuiActiveTurnRequest,
  WebuiActiveTurnResult,
} from "../../../shared/contracts/session.js";
import type {
  WebuiInteractionReplyResult,
  WebuiPendingPermission,
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireRequest,
} from "../../../shared/contracts/interactions.js";
import type { WebuiModelEntry } from "../../../shared/contracts/models.js";
import type { WebuiQueueItem } from "../../../shared/contracts/queue.js";
import type {
  WebuiWorkspaceDirectoryListing,
  WebuiWorkspaceFile,
} from "../../../shared/contracts/workspace.js";
import type { WebuiUsageQuotaResult } from "../../../shared/contracts/usage-quota.js";
import { formatUsageResetLabel } from "../../projection/account/usage.js";
import { WebuiGoalBanner } from "../goal/GoalBanner.js";
import { WebuiInteractionPanel } from "../interactions/InteractionPanel.js";
import { WebuiQueuePanel } from "./QueuePanel.js";
import {
  WebuiModelPicker,
  type WebuiModelPickerDraft,
} from "../models/ModelPicker.js";
import { ThinkingTrigger } from "./ThinkingTrigger.js";
import {
  chipLevelLabel,
  resolveEffortOptions,
  thinkingDraftPatch,
} from "../../projection/models/thinking-control.js";
import {
  WebuiIconAttach,
  WebuiIconCheck,
  WebuiIconChevronDown,
  WebuiIconCommandGoal,
  WebuiIconCommandPlan,
  WebuiIconFolder,
  WebuiIconPermissionAuto,
  WebuiIconPermissionFull,
  WebuiIconPermissionRequest,
  WebuiIconPlugins,
  WebuiIconSend,
  WebuiIconSkillGeneric,
  type WebuiIconProps,
} from "../shell/icons.js";
import { OutputError } from "../transcript/OutputError.js";
import {
  resolveWebuiSubmissionIntent,
  resolveWebuiComposerEnterAction,
  isTurnLive,
} from "../../projection/composer/composer-state.js";
import {
  submitWebuiGoal,
} from "../../application/composer/composer-workflows.js";
import { evaluateComposerDismiss, evaluateOutsideClose } from "../../projection/common/outside-close.js";
import {
  buildWebuiModelSelectionRequest,
} from "../../projection/sessions/action-requests.js";
import { workspaceProjectName } from "../../projection/workspace/workspace-name.js";
import {
  findWebuiMentionRange,
  findWebuiSlashRange,
  insertWebuiMention,
  removeWebuiSlashToken,
  replaceWebuiSlashToken,
  webuiAttachmentLimitError,
  webuiTextAttachmentDataUrl,
} from "../../projection/composer/composer-interactions.js";
import {
  shouldRecallWebuiHistory,
  startWebuiHistoryBrowse,
  stepWebuiHistoryBrowse,
  type WebuiHistoryBrowse,
} from "../../application/composer/composer-history.js";
import {
  slashSkillSummaryToEntry,
  WEBUI_BUILTIN_COMMANDS,
  type SlashCommandEntry,
  type WebuiSlashSkillSummary,
} from "./slash-palette.js";
import {
  isWebuiRunnableCommand,
  rankWebuiSlashPalette,
  sectionWebuiSlashPalette,
  type WebuiRunCommandName,
} from "../../contracts/composer/slash-command.js";
import { planWebuiRetryResend, resendRecordedWebuiTurn } from "../../application/composer/turn-retry.js";

const WEBUI_SLASH_FALLBACK_SECTIONED: SlashCommandEntry[] = await (async () => {
  const { resolveWebuiSlashSkills } = await import("./slash-palette.js");
  const resolved = await resolveWebuiSlashSkills();
  return sectionWebuiSlashPalette(WEBUI_BUILTIN_COMMANDS, resolved.skills);
})();

// Desktop keeps the viewport pinned through the short hand-off window where
// the live turn is replaced by the refreshed historical transcript.

interface ComposerCatalogEntry {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
}

type ComposerMentionChoice =
  | { readonly kind: "plugin"; readonly name: string; readonly label: string; readonly detail?: string; readonly section: string }
  | { readonly kind: "file"; readonly path: string; readonly label: string; readonly section: string }
  | { readonly kind: "local-file"; readonly label: string; readonly section: string }
  | { readonly kind: "local-folder"; readonly label: string; readonly section: string }
  | { readonly kind: "agent"; readonly session: WebuiClientSession; readonly label: string; readonly section: string };

type WebuiComposerPermissionMode = "default" | "auto" | "bypassPermissions";

const PERMISSION_MODE_ORDER = ["default", "auto", "bypassPermissions"] as const;

interface WebuiComposerPermissionOption {
  readonly label: string;
  readonly description: string;
  readonly Icon: (props: WebuiIconProps) => ReactElement;
}

/** The popover's own question, and where "了解更多" points. The docs page is the
 *  public one the README already links; `/permission` is documented there. */
const PERMISSION_MODE_QUESTION = "应如何批准 minimax code 操作?";
const PERMISSION_MODE_LEARN_MORE = "了解更多";
const PERMISSION_MODE_DOCS_URL = "https://agent.minimax.io/docs/cli/features";

/** Default for `recentWorkspaceDirs`. A module constant, not an inline `[]`, so
 *  the prop keeps one identity across renders when the parent does not supply
 *  it — an inline default would be a fresh array every render. */
const EMPTY_WORKSPACE_DIRS: readonly string[] = [];

/** Ordered most-restrictive first, mirroring the `ask` / `auto` / `full` actions
 *  the `/permission` command takes. */
const PERMISSION_MODE_OPTION: Readonly<Record<WebuiComposerPermissionMode, WebuiComposerPermissionOption>> = {
  default: {
    label: "请求批准",
    description: "编辑外部文件和使用互联网时始终询问",
    Icon: WebuiIconPermissionRequest,
  },
  auto: {
    label: "帮我批准",
    description: "仅对检测到的风险操作请求批准",
    Icon: WebuiIconPermissionAuto,
  },
  bypassPermissions: {
    label: "完全访问权限",
    description: "可不受限制地访问互联网和你电脑上的任何文件",
    Icon: WebuiIconPermissionFull,
  },
};

/** The trigger and the rows share one glyph per mode, so the pill always
 *  previews the icon the popover marks as selected. */
function PermissionModeIcon({ mode }: { readonly mode: WebuiComposerPermissionMode }): ReactElement {
  const { Icon } = PERMISSION_MODE_OPTION[mode];
  return <Icon className="webui-composer-permission-icon" />;
}

function readPermissionMode(value: unknown): WebuiComposerPermissionMode | undefined {
  const mode = typeof value === "string"
    ? value
    : value && typeof value === "object" && "mode" in value
      ? (value as { mode?: unknown }).mode
      : undefined;
  return mode === "default" || mode === "auto" || mode === "bypassPermissions"
    ? mode
    : undefined;
}

function composerRows(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const items = Array.isArray(row.plugins) ? row.plugins : Array.isArray(row.items) ? row.items : [];
  return items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

function flattenWorkspaceFiles(files: readonly WebuiWorkspaceFile[]): readonly { readonly path: string; readonly name: string; readonly type?: string }[] {
  const flattened: { path: string; name: string; type?: string }[] = [];
  const visit = (items: readonly WebuiWorkspaceFile[]) => {
    for (const item of items) {
      flattened.push({ path: item.path, name: item.name, ...(item.type ? { type: item.type } : {}) });
      if (item.children) visit(item.children);
    }
  };
  visit(files);
  return flattened;
}

function readBrowserFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取文件：${file.name}`));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error(`无法读取文件：${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Directory browser behind the composer's "选择新项目".
 *
 * A browser cannot name a directory for us: the File System Access API
 * hands back a bare directory name, `File.path` exists only inside
 * Electron, and `webkitRelativePath` is relative by definition — while
 * the server requires a real absolute path for a session's working
 * directory. So the server enumerates this machine's directories and the
 * user picks from what it reports.
 *
 * When the transport has no `browseWorkspaceDirs` — a static fixture
 * transport, or a server that predates the operation — the browser falls
 * back to a manual absolute-path field. Either way a failure is shown in
 * the popover; it never resolves to a silent no-op.
 */

export function WebuiComposer({
  sessionId,
  sessionStatus,
  sessionLayout = false,
  usageQuota,
  agentName,
  createSession,
  createSessionWorkspaceDir,
  onWorkspaceChange,
  workspaceMenuOpen,
  setWorkspaceMenuOpen,
  recentWorkspaceDirs = EMPTY_WORKSPACE_DIRS,
  runCommand,
  sendMessage,
  loadMessages,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  getSessionForkOptions,
  forkSession,
  getSessionRewindPreview,
  rewindSession,
  editSessionMessage,
  getActiveTurn,
  listQueueMessages,
  deleteQueueItem,
  listModels,
  listSkills,
  selectModel,
  getAccountStatus,
  draft,
  onDraftChange,
  inputHistory = [],
  onInputSubmitted,
  onNeedsSession,
  onSessionCreated,
  enqueueMessage,
  teamModeOff,
  listWorkspaceFileTree,
  browseWorkspaceDirs,
  pluginManagement,
  getPermissionMode,
  setPermissionMode,
  sessions = [],
  workspaceDir,
  onSelectSession,
  onOpenPluginManagement,
  seedAttachment,
  favoritesStorage,
}: {
  readonly sessionId?: string;
  readonly sessionStatus?: unknown;
  readonly sessionLayout?: boolean;
  readonly usageQuota?: WebuiUsageQuotaResult;
  readonly agentName: string;
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly onWorkspaceChange: (workspaceDir?: string) => void;
  /** Open state for the workspace picker; owned by the parent so the
   *  parent's workspace-change handler can also close the popover. */
  readonly workspaceMenuOpen: boolean;
  readonly setWorkspaceMenuOpen: (open: boolean) => void;
  /** Workspace directories offered as `最近`, newest first. Derived from
   *  session history by `deriveRecentWorkspaceDirs`; empty when the user has
   *  no project sessions yet. */
  readonly recentWorkspaceDirs?: readonly string[];
  readonly runCommand?: (request: { readonly command: WebuiRunCommandName; readonly input?: string; readonly sessionId?: string; readonly agentName?: string; readonly workspaceDir?: string; }) => Promise<Record<string, unknown>>;
  readonly sendMessage?: WebuiClientMessageSender;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;

  /** Authoritative active-turn probe; resolves the `recheck` case and the
   * missed-event gap that a reconnect or a slow subscribe can open. */
  readonly getActiveTurn?: (request: WebuiActiveTurnRequest) => Promise<WebuiActiveTurnResult>;

  readonly listQueueMessages?: (request: { readonly id: string }) => Promise<{ readonly items?: readonly WebuiQueueItem[]; readonly paused?: boolean; readonly pendingCount?: number }>;
  readonly deleteQueueItem?: (request: { readonly id: string; readonly itemId: string }) => Promise<{ readonly item?: WebuiQueueItem }>;
  readonly listModels?: (request?: { readonly sessionId?: string }) => Promise<readonly WebuiModelEntry[]>;
  readonly listSkills?: (request?: { readonly agentName?: string }) => Promise<{ readonly skills: readonly { readonly name: string; readonly displayName?: string; readonly description?: string }[] }>;
  readonly selectModel?: (request: WebuiModelSelectionRequest) => Promise<{ readonly success?: boolean }>;
  readonly getAccountStatus?: (request?: { readonly sessionId?: string }) => Promise<Record<string, unknown>>;
  /** The draft lives on the shell so it survives silent first-session creation. */
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  /**
   * A file dropped into the composer from outside it — 记忆摘要's 「在会话中创建」
   * hands the memory file over this way, because the composer is the only
   * surface that can render an attachment chip and the only one that can put it
   * on the wire.
   *
   * One-shot by `token`: the shell keeps the seed around across the view switch
   * that opens the composer, so an effect keyed on anything else would re-attach
   * the same 74KB file on every re-render of this 3000-line component.
   */
  readonly seedAttachment?: {
    readonly token: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly content: string;
  };
  /**
   * Submitted-input history for ↑ recall (roadmap Module B: 输入历史/草稿).
   * Keyed by session on the shell; the composer only walks it with the pure
   * helpers from `composer-history.ts`.
   */
  readonly inputHistory?: readonly string[];
  /** Records one committed submission into the shell's history store. */
  readonly onInputSubmitted?: (text: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onSessionCreated?: (sessionId: string) => void;
  readonly teamModeOff: boolean;
  readonly favoritesStorage: {
    readonly read: () => string[];
    readonly write: (ids: readonly string[]) => void;
  };
  readonly listWorkspaceFileTree?: WebuiTransport["listWorkspaceFileTree"];
  readonly browseWorkspaceDirs?: WebuiTransport["browseWorkspaceDirs"];
  readonly pluginManagement?: WebuiTransport["pluginManagement"];
  readonly getPermissionMode?: WebuiTransport["getPermissionMode"];
  readonly setPermissionMode?: WebuiTransport["setPermissionMode"];
  readonly sessions?: readonly WebuiClientSession[];
  readonly workspaceDir?: string;
  readonly onSelectSession?: (sessionId: string) => void;
  readonly onOpenPluginManagement?: (area: "plugins" | "skills") => void;
} & WebuiSessionComposerCapabilities): ReactElement {

  // The two slices this carve owns (plan §8 Phase 3 B1, ticket #66). The composer
  // reads them and hands each to the owner that drives it; the calls themselves
  // happen in `goal-coordinator.ts` and `interaction-coordinator.ts`, which are
  // application modules. What the presentation invokes is therefore the owners'
  // published command surface and nothing else — which is why these businesses'
  // findings clear at this carve and could not clear in Phase 2: the capability
  // needed an owner to move into first.
  const goalPort = useWebuiPortSlice("goal");
  const interactionsPort = useWebuiPortSlice("interactions");
  // The two interaction members this component still names directly, for the
  // registration effect's dependencies (below). A host with no provider has no
  // slice, hence the optional read: the dependency is `undefined` there, which is
  // the same "not wired" value the props carried.
  const getPendingQuestionnaire = interactionsPort?.getPendingQuestionnaire;
  const listPendingPermissions = interactionsPort?.listPendingPermissions;

  const { dom } = useWebuiBrowserCapabilities();
  const { stream, sending } = useWebuiSessionState(sessionId);
  const {
    phase,
    lifecycle,
    attachTurn,
    recheckTurn,
    recoverTurn,
    sendTurn: submitTurn,
    stopTurn,
  } = useWebuiSessionCommands(sessionId);
  // The per-session effects registry the shell provides (ticket #45). The
  // composer registers this session's event handlers here so the application
  // event coordinator — the sole consumer of the process-event channel — runs
  // them for events addressed to this session; it holds no channel and
  // registers nothing when no provider is mounted (SSR, tests).
  const effectsRegistry = useWebuiEventEffectsRegistry();
  // The interaction slices live on the one application store, read here through
  // selectors and kept nowhere else (plan §7.6; ticket #45). The commands write
  // through the store's interaction writer; the composer holds no store writer
  // and no local copy of permissions, questionnaire or goal.
  const permissions = useWebuiSessionPermissions(sessionId);
  const questionnaire = useWebuiSessionQuestionnaire(sessionId);
  const goal = useWebuiSessionGoal(sessionId);
  const interactionCommands = useWebuiInteractionCommands(sessionId);
  // The interaction flows (plan §7.1 `client/application/interactions/interaction-coordinator.ts`).
  // The policy — what counts as an accepted reply, what state transition follows
  // it, which permissions a re-read keeps — lives there. This component supplies
  // the wiring and keeps the one error slot that every other flow in this file
  // also writes, which is why the flows return an outcome instead of an error.
  // The two fence cells come from the application, not from this component
  // (§4.2 field 6: the composer owns neither the goal's fence nor interactions'
  // late-read protection). Bumped by every write, so a steering re-read that
  // lands after a newer update can tell it is stale and stand down; EVERY goal
  // writer must go through `applyGoal`, because a direct store write would let
  // an in-flight read resurrect the state it was meant to replace. The policy is
  // each coordinator's; the cell has to outlive a render, which is why the
  // application creates it — a counter inside a per-render coordinator would
  // reset and silently disable the guard it protects.
  const versionCells = useWebuiVersionCells();
  const goalVersionRef = versionCells.goal;
  const pendingVersionRef = versionCells.pending;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const interactionCoordinator = createWebuiInteractionCoordinator({
    port: { ...interactionsPort },
    sink: {
      replacePendingPermissions: interactionCommands.replacePendingPermissions,
      removePendingPermission: interactionCommands.removePendingPermission,
      applyQuestionnaire: interactionCommands.applyQuestionnaire,
    },
    // turn's published stream-phase commands (plan §8 Phase 3 B1; §5.1
    // prohibition 1). The four transitions used to be handed in as sink
    // callbacks, which is the "injected optional object" shape §5.2 calls the
    // violation; an owner may invoke another business's published command, and
    // the outcome→transition policy now lives with the flow that owns it rather
    // than in this wiring.
    streams: phase,
    sessionId,
    agentName,
    pendingVersionRef,
  });
  // The goal duty has its own owner (plan §8 Phase 3 B1; §5.6: this component's
  // interaction coordinator "loses the goal duty it absorbed"). Two owners, two
  // version cells: a goal write cannot fence a pending read, and a pending reply
  // cannot fence a goal read — which is the property `goal-coordinator.test.ts`
  // asserts rather than assumes.
  const goalCoordinator = createWebuiGoalCoordinator({
    port: { ...goalPort },
    sink: {
      applyGoal: interactionCommands.applyGoal,
      afterGoalReRead: (next) => {
        if (next) setGoalMode(next.status !== "complete");
      },
    },
    sessionId,
    goalVersionRef,
  });
  const applyGoal = goalCoordinator.applyGoal;
  const [goalEnabled, setGoalEnabled] = useState(true);
  // The composer's owner, read once for everything this component keeps in it
  // (§4.2 field 1: the input modes, the retry record, the queue; §5.6's may-write
  // cell for the staging). One store, one subscription.
  const composerStore = useWebuiComposerStore();
  const composerSnapshot = useSyncExternalStore(
    composerStore.subscribe,
    composerStore.getSnapshot,
    composerStore.getSnapshot,
  );
  // The input modes are the composer's own state (§4.2 field 1), kept by its owner.
  const goalMode = composerSnapshot.modes.goal;
  const planMode = composerSnapshot.modes.plan;
  const setGoalMode = useCallback(
    (next: boolean) => {
      composerStore.setModes({ goal: next });
    },
    [composerStore],
  );
  const setPlanMode = useCallback(
    (next: boolean) => {
      composerStore.setModes({ plan: next });
    },
    [composerStore],
  );
  const [goalSubmitting, setGoalSubmitting] = useState(false);
  const [interactionError, setInteractionError] = useState<string>();
  // The queue mirror is the composer's own state, and its owner is the composer
  // store (§4.2 field 1: "the queue's state (`queueItems`, `queuePaused` —
  // component-local today)"; §5.6's composer row names the owner module). It is
  // live state: not persisted, and not per-slot, because unlike the draft it does
  // not survive a session switch.
  const queueState = composerSnapshot.queue;
  const queueItems = queueState.items;
  const queuePaused = queueState.paused;
  const setQueueItems = composerStore.setQueue;
  const [models, setModels] = useState<readonly WebuiModelEntry[]>([]);
  const [accountStatus, setAccountStatus] = useState<Record<string, unknown>>();
  const [commandOutput, setCommandOutput] = useState<string>();
  const [commandRunning, setCommandRunning] = useState(false);
  // The staged attachments and URL references are the composer's own state, kept
  // by its owner module (§5.6) and read from the same snapshot as the queue.
  const attachments = composerSnapshot.staging.attachments;
  const urlReferences = composerSnapshot.staging.urlReferences;
  const attachmentBusy = composerSnapshot.staging.busy;
  const setAttachments = useCallback(
    (
      next:
        | readonly WebuiComposerAttachment[]
        | ((current: readonly WebuiComposerAttachment[]) => readonly WebuiComposerAttachment[]),
    ) => {
      composerStore.setStaging((current) => ({
        attachments: typeof next === "function" ? next(current.attachments) : next,
      }));
    },
    [composerStore],
  );
  const setUrlReferences = useCallback(
    (
      next:
        | readonly WebuiComposerUrlReference[]
        | ((current: readonly WebuiComposerUrlReference[]) => readonly WebuiComposerUrlReference[]),
    ) => {
      composerStore.setStaging((current) => ({
        urlReferences: typeof next === "function" ? next(current.urlReferences) : next,
      }));
    },
    [composerStore],
  );
  const setAttachmentBusy = useCallback(
    (next: boolean) => {
      composerStore.setStaging({ busy: next });
    },
    [composerStore],
  );
  const [composerMenu, setComposerMenu] = useState<"root" | "skills" | "plugins">();
  const [installedPlugins, setInstalledPlugins] = useState<readonly ComposerCatalogEntry[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState<string>();
  const [skillsMenuLoading, setSkillsMenuLoading] = useState(false);
  const [skillsMenuError, setSkillsMenuError] = useState<string>();
  const [workspaceFiles, setWorkspaceFiles] = useState<readonly { readonly path: string; readonly name: string; readonly type?: string }[]>([]);
  const [workspaceBrowserOpen, setWorkspaceBrowserOpen] = useState(false);
  // The mention range is the composer's own state (§5.6: mention/slash ranges); the
  // slash range is derived (`commandRange` below), so only this half is state.
  const mentionRange = composerSnapshot.mentionRange;
  const setMentionRange = composerStore.setMentionRange;
  const [mentionIndex, setMentionIndex] = useState(0);
  const [permissionMode, setPermissionModeValue] = useState<WebuiComposerPermissionMode>();
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionUnavailable, setPermissionUnavailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const mentionCaretRef = useRef<number>();
  const pendingMentionCaretRef = useRef<number>();
  // The slash palette follows the caret, so its position is state rather than a
  // ref: a click or an arrow key that only moves the caret still has to
  // re-derive whether a slash token is under it.
  const [composerCaret, setComposerCaret] = useState(0);
  // ↑ recall browse state (roadmap Module B). `undefined` = not browsing.
  // While set, ↑/↓ walk `inputHistory` and any manual edit exits (the
  // textarea's onChange only fires for real user edits — a programmatic
  // recall swap never ends its own browse); stepping past the newest
  // restores the stashed pre-browse draft.
  const [historyBrowse, setHistoryBrowse] = useState<WebuiHistoryBrowse>();
  useEffect(() => {
    // Switching sessions swaps the history list under the browse cursor;
    // restart clean rather than trusting the index still means anything.
    setHistoryBrowse(undefined);
  }, [sessionId]);
  const applyHistoryDraft = (next: string) => {
    handleDraftChange(next);
    setComposerCaret(next.length);
    // The DOM caret lags the controlled value swap by a render; pin it to
    // the end once the new value is on screen, the way a terminal leaves the
    // cursor after a recall.
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(next.length, next.length);
    });
  };
  const editingGoalDraftRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRegionRef = useRef<HTMLDivElement | null>(null);
  // The permission popover's own container: the trigger button plus the popover
  // body. Distinct from `composerRegionRef` on purpose — the popover is a
  // dropdown hinged to the footer button, so "inside" means "inside this wrap",
  // not "anywhere in the composer".
  const permissionWrapRef = useRef<HTMLDivElement | null>(null);
  // The `+` menu's own container: the attach button plus the panel it opens.
  // Distinct from `composerRegionRef` on purpose — a dropdown hinged to that
  // button dismisses on any other click, the textarea included.
  const composerAddWrapRef = useRef<HTMLDivElement | null>(null);
  // The workspace picker's own container: the 选择文件夹 trigger plus whichever
  // panel it has open (the 最近 list or the directory browser). The picker has
  // to be judged against THIS, not `composerRegionRef` — see the effect below.
  const workspacePickerRef = useRef<HTMLDivElement | null>(null);
  const fieldId = useId();
  const contextUsage = stream.contextUsage ?? stream.messages.at(-1)?.contextUsage;
  useEffect(() => {
    if (!sessionId || webuiSessionStatusType(sessionStatus) === "started" || !loadMessages) return;
    let cancelled = false;
    void loadMessages({ id: sessionId }).then((page) => {
      if (cancelled) return;
      const snapshot = readContextUsageSnapshot(page.contextSnapshot);
      const fromMessages = latestContextUsage((page.messages ?? []).map(projectWebuiMessageToStreamMessage));
      const contextUsage = snapshot ?? fromMessages;
      if (contextUsage) lifecycle.setContextUsage(contextUsage);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionId, sessionStatus, loadMessages]);

  useEffect(() => {
    if (!sessionId) {
      // Inspection data belongs to a session. Clear it when New Task returns to
      // home so the previous session's model/account state cannot bleed into the composer.
      setModels([]);
      setAccountStatus(undefined);
      // The live turn bleeds the same way: the module-level runtime map kept
      // the previous turn's stream under the welcome hero on every 新建任务.
      lifecycle.clearStream();
      lifecycle.setTurnSending(false);
      return undefined;
    }
    let cancelled = false;
    const refreshPending = async () => {
      const outcome = await interactionCoordinator.refresh();
      if (cancelled) return;
      if (!outcome.ok) setInteractionError(outcome.error);
      if (listQueueMessages) {
        const queue = await listQueueMessages({ id: sessionId });
        if (cancelled) return;
        setQueueItems({
          items: queue.items ?? [],
          paused: queue.paused === true,
        });
      }
    };
    void refreshPending().catch((error: unknown) => {
      if (!cancelled)
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
    });
    // The attach/recheck/gap-recovery commands live in the application layer
    // (`application/turn/turn-commands.ts`), behind the binding: the probe, the
    // store writer, the attempt's sink and the record key are all chosen there.
    // This component submits intents and holds no factory of its own (T04).
    const attachToTurn = (turnId: string | undefined) => {
      attachTurn({ turnId });
    };

    /** `session.start` named a turn we do not hold while holding another. */
    const recheckSubscription = (turnId: string | undefined) => {
      recheckTurn(turnId);
    };

    /**
     * Gap recovery. A `session.start` can arrive before this client finished
     * subscribing, or be missed entirely while `watchEvents` reconnects, and
     * the session list cannot answer the question — its `status` carries no
     * turn id and never refreshes on those events. Ask the server instead.
     */
    const recoverMissedTurn = () => {
      recoverTurn();
    };

    // Goal steering events announce that the objective moved without carrying
    // the new goal, so the banner is re-read rather than patched. The read is
    // eventually consistent, so a late answer must not undo a newer goal that
    // arrived while it was in flight: the version guard makes that decision,
    // and it has one implementation here, shared by the event callback and the
    // registered effects.
    const refreshGoal = () => goalCoordinator.refreshGoal();

    // The mount probe. A turn that started before this client read the server
    // is still running, so `getActiveTurn` returns it; a turn that starts after
    // announces itself on the single process-event channel, which the
    // application event coordinator owns. The composer no longer opens its own
    // `watchEvents` subscription — the coordinator is the channel's sole
    // consumer, reduces each event, and runs this session's registered effects
    // below (ticket #45, the atomic ingress flip).
    recoverMissedTurn();
    // Register this session's effect handlers for the application event
    // coordinator. The coordinator runs them for events addressed to this
    // session, so the composer holds no channel and no raw event callback.
    const unregisterEffects = effectsRegistry?.register(sessionId, {
      answerQuestionnaire: (request, answers) => interactionCoordinator.answerQuestionnaire(request, answers),
      invalidatePending: () => interactionCoordinator.invalidatePendingReads(),
      refreshPending: () => refreshPending(),
      refreshGoal,
      // The coordinator's set-goal command routes here, so a goal-bearing
      // event performs the same version bump `applyGoal` owns — a late steering
      // re-read cannot resurrect the goal the event just replaced. Every goal
      // write still goes through `applyGoal`.
      setGoal: (_targetSessionId, nextGoal) => applyGoal(nextGoal),
      attachStream: createWebuiComposerAttachStreamEffect(
        attachToTurn,
        recheckSubscription,
      ),
      channelReady: () => {
        void refreshPending().catch(() => undefined);
        recoverMissedTurn();
      },
    });
    return () => {
      cancelled = true;
      unregisterEffects?.();
    };
  }, [
    agentName,
    effectsRegistry,
    getActiveTurn,
    // These two come from the interactions slice now (the coordinator reads it);
    // the members are stable for the mount, so the registration does not churn.
    getPendingQuestionnaire,
    listPendingPermissions,
    listQueueMessages,
    sessionId,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!getPermissionMode || !setPermissionMode) {
      setPermissionUnavailable(true);
      return undefined;
    }
    getPermissionMode()
      .then((value) => {
        if (cancelled) return;
        const mode = readPermissionMode(value);
        if (!mode) throw new Error("运行时返回了不支持的授权模式");
        setPermissionModeValue(mode);
        setPermissionUnavailable(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPermissionUnavailable(true);
        setInteractionError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [getPermissionMode, setPermissionMode]);

  useEffect(() => {
    if (composerMenu !== "plugins" && !mentionRange) return;
    if (!pluginManagement) {
      setInstalledPlugins([]);
      return;
    }
    let cancelled = false;
    setPluginsLoading(true);
    setPluginsError(undefined);
    pluginManagement({ action: "listInstalledPlugins", input: { limit: 200 } })
      .then((result) => {
        if (cancelled) return;
        setInstalledPlugins(composerRows(result).map((row) => {
          const name = typeof row.name === "string" ? row.name : typeof row.pluginName === "string" ? row.pluginName : "";
          const displayName = typeof row.displayName === "string" ? row.displayName : name;
          return { name, displayName, ...(typeof row.description === "string" ? { description: row.description } : {}) };
        }).filter((plugin) => plugin.name));
      })
      .catch((error: unknown) => {
        if (!cancelled) setPluginsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setPluginsLoading(false); });
    return () => { cancelled = true; };
  }, [composerMenu, mentionRange !== undefined, pluginManagement]);

  // The skills submenu and the slash palette render the same pool, so they read
  // it through one loader. A second reader joins the request the first one
  // started instead of fetching again and replacing the pool underneath it.
  const [slashSkills, setSlashSkills] = useState<readonly WebuiSlashSkillSummary[]>(
    [],
  );
  const slashSkillsRequestRef = useRef<
    | {
        readonly key: string;
        readonly promise: Promise<readonly WebuiSlashSkillSummary[]>;
      }
    | undefined
  >(undefined);
  const readSlashSkills = useCallback((): Promise<
    readonly WebuiSlashSkillSummary[]
  > => {
    if (!listSkills) return Promise.reject(new Error("技能目录暂不可用"));
    const key = agentName ?? "";
    if (slashSkillsRequestRef.current?.key !== key) {
      slashSkillsRequestRef.current = {
        key,
        promise: listSkills({ agentName }).then((result) => result.skills),
      };
    }
    return slashSkillsRequestRef.current.promise;
  }, [listSkills, agentName]);

  useEffect(() => {
    if (composerMenu !== "skills") return;
    if (!listSkills) {
      setSkillsMenuError("技能目录暂不可用");
      return;
    }
    let cancelled = false;
    setSkillsMenuLoading(true);
    setSkillsMenuError(undefined);
    readSlashSkills()
      .then((skills) => { if (!cancelled) setSlashSkills(skills); })
      .catch((error: unknown) => { if (!cancelled) setSkillsMenuError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setSkillsMenuLoading(false); });
    return () => { cancelled = true; };
  }, [composerMenu, listSkills, readSlashSkills]);

  useEffect(() => {
    if (!mentionRange || !workspaceDir || !listWorkspaceFileTree) {
      setWorkspaceFiles([]);
      return undefined;
    }
    let cancelled = false;
    listWorkspaceFileTree({ workspaceDir })
      .then((files) => { if (!cancelled) setWorkspaceFiles(flattenWorkspaceFiles(files).slice(0, 100)); })
      .catch((error: unknown) => {
        if (!cancelled) setInteractionError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [mentionRange !== undefined, workspaceDir, listWorkspaceFileTree]);

  useLayoutEffect(() => {
    const caret = pendingMentionCaretRef.current;
    const textarea = textareaRef.current;
    if (caret === undefined || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    pendingMentionCaretRef.current = undefined;
    // The slash palette derives its state from `composerCaret`, so a caret the
    // composer moved itself has to be mirrored there — no input event follows.
    setComposerCaret(caret);
  }, [draft]);

  const goalEnabledProbe = goalCoordinator.isGoalEnabled;
  useEffect(() => {
    if (!goalEnabledProbe) {
      setGoalEnabled(true);
      return undefined;
    }
    let cancelled = false;
    void goalEnabledProbe()
      .then((result) => {
        if (cancelled) return;
        setGoalEnabled(result.enabled);
        if (!result.enabled) setGoalMode(false);
      })
      .catch(() => { if (!cancelled) setGoalEnabled(false); });
    return () => { cancelled = true; };
  }, [goalEnabledProbe]);

  useEffect(() => {
    // Reset on every session switch, then read through the owner. The fence and
    // the apply both live in `refreshGoal` now: this component used to hand-roll
    // a second copy of it here, which is the duplication the goal carve removes —
    // one write path and one fenced read, not two of each.
    applyGoal(undefined);
    setGoalMode(false);
    if (!sessionId || !goalEnabled) return undefined;
    let cancelled = false;
    void goalCoordinator.refreshGoal().then((outcome) => {
      if (!cancelled && !outcome.ok) setGoalEnabled(false);
    });
    return () => {
      cancelled = true;
    };
  }, [goalEnabled, sessionId]);

  useEffect(() => {
    if (!listModels && !getAccountStatus) return undefined;
    let cancelled = false;
    const refreshInspection = async () => {
      const [nextModels, nextAccount] = await Promise.all([
        listModels?.({ sessionId }),
        getAccountStatus?.({ sessionId }),
      ]);
      if (cancelled) return;
      setModels(nextModels ?? []);
      setAccountStatus(nextAccount);
    };
    void refreshInspection().catch((error: unknown) => {
      if (!cancelled)
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
    });
    const timer = setInterval(() => {
      void refreshInspection().catch(() => undefined);
    }, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [getAccountStatus, listModels, sessionId]);

  const handlePermission = async (
    permission: WebuiPendingPermission,
    decision: "allowOnce" | "allowAlways" | "deny",
  ) => {
    setInteractionError(undefined);
    const outcome = await interactionCoordinator.replyPermission(
      permission,
      decision,
    );
    if (!outcome.ok) setInteractionError(outcome.error);
  };

  const handleQuestionnaire = async (
    request: WebuiQuestionnaireRequest,
    answers: readonly WebuiQuestionnaireAnswer[],
  ) => {
    setInteractionError(undefined);
    const outcome = await interactionCoordinator.answerQuestionnaire(
      request,
      answers,
    );
    if (!outcome.ok) setInteractionError(outcome.error);
  };

  const handleDismiss = async (request: WebuiQuestionnaireRequest) => {
    setInteractionError(undefined);
    const outcome = await interactionCoordinator.dismissQuestionnaire(request);
    if (!outcome.ok) setInteractionError(outcome.error);
  };

  const handleStop = async () => {
    if (!sessionId) return;
    setInteractionError(undefined);
    try {
      // The stop capability comes from the application's turn capability
      // slice, inside the binding; this component submits the intent only
      // (ticket #57).
      await stopTurn();
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleDeleteQueueItem = async (item: WebuiQueueItem) => {
    if (!deleteQueueItem || !sessionId) return;
    setInteractionError(undefined);
    try {
      await deleteQueueItem({ id: sessionId, itemId: item.itemId });
      setQueueItems((current) => ({
        items: current.items.filter(
          (candidate) => candidate.itemId !== item.itemId,
        ),
      }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleSelectModel = async (
    model: WebuiModelEntry,
    draft: WebuiModelPickerDraft,
  ) => {
    if (!selectModel) return;
    setInteractionError(undefined);
    try {
      const result = await selectModel(
        buildWebuiModelSelectionRequest(model, draft, sessionId),
      );
      if (result.success === false)
        throw new Error("The model could not be selected");
      const refreshed = await listModels?.({
        ...(sessionId ? { sessionId } : {}),
      });
      if (refreshed) setModels(refreshed);
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const selectedModel = models.find((model) => model.selected);
  const enabledModels = models.filter((model) => model.enabled !== false);
  // The active model's thinking options, resolved ONCE and read by both the
  // model chip (to name the level) and the brain trigger (to decide whether
  // there is a level to name). Two `resolveEffortOptions` calls would be two
  // chances to disagree about this model's shape, and the disagreement renders
  // as a chip stating a level beside a brain claiming the model has none.
  const thinkingOptions = selectedModel ? resolveEffortOptions(selectedModel) : [];
  // The slash token the caret sits in, found the same way as an `@` mention.
  // Every slash opens the palette, not only one at the start of the draft:
  // `findWebuiSlashRange` anchors on the caret and on `(?:^|\s)`, so `帮我 /pl`
  // ranks commands exactly like `/pl` while `http://x` stays a URL. Reading the
  // un-trimmed draft keeps the panel closed once the user types the trailing
  // space after a command — trimming would re-open it, because "/name "
  // trims to "/name" and matches again.
  const commandRange = findWebuiSlashRange(draft, composerCaret);
  const commandQuery = commandRange?.query ?? "";
  // Pull a fresh skill pool from the harness when `listSkills` is wired up.
  // The fallback (fixtures resolved at module init) keeps the popover
  // functional even if the RPC is unavailable or rejects; once the live
  // registry returns, fetched entries replace the fixtures in the sectioning
  // pass.
  const slashSkillsLoadedRef = useRef(false);
  useEffect(() => {
    if (!listSkills) return;
    if (slashSkillsLoadedRef.current) return;
    let cancelled = false;
    slashSkillsLoadedRef.current = true;
    readSlashSkills()
      .then((skills) => {
        if (cancelled) return;
        setSlashSkills(skills);
      })
      .catch(() => {
        // The popover keeps using the fixtures when the RPC rejects; the
        // submenu reports the failure in its own state. Clearing the flag lets
        // the next effect run retry; within one mount that means an
        // `agentName` change, not every keystroke.
        if (cancelled) return;
        slashSkillsLoadedRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [listSkills, readSlashSkills]);
  const slashSectioned = slashSkills.length
    ? sectionWebuiSlashPalette(
        WEBUI_BUILTIN_COMMANDS,
        slashSkills.map(slashSkillSummaryToEntry),
      )
    : WEBUI_SLASH_FALLBACK_SECTIONED;
  const commandSuggestions = commandRange
    ? rankWebuiSlashPalette(slashSectioned, commandQuery)
    : [];
  const mentionQuery = mentionRange?.query.toLocaleLowerCase() ?? "";
  const mentionSuggestions: readonly ComposerMentionChoice[] = mentionRange
    ? [
        ...installedPlugins
          .filter((plugin) => `${plugin.displayName} ${plugin.name}`.toLocaleLowerCase().includes(mentionQuery))
          .map((plugin) => ({ kind: "plugin" as const, name: plugin.name, label: plugin.displayName, detail: plugin.description, section: "插件" })),
        { kind: "local-file" as const, label: "添加本地文件", section: "本地资源" },
        { kind: "local-folder" as const, label: "添加本地文件夹", section: "本地资源" },
        ...workspaceFiles
          .filter((file) => `${file.name} ${file.path}`.toLocaleLowerCase().includes(mentionQuery))
          .map((file) => ({ kind: "file" as const, path: file.path, label: file.path, section: "项目文件" })),
        ...sessions
          .filter((session) => session.parentSessionId === sessionId)
          .filter((session) => `${session.title ?? session.agentName} ${session.agentName}`.toLocaleLowerCase().includes(mentionQuery))
          .map((session) => ({ kind: "agent" as const, session, label: session.title ?? session.agentName, section: "子 Agent" })),
      ]
    : [];
  const [commandIndex, setCommandIndex] = useState(0);
  useEffect(() => {
    setMentionIndex((current) => mentionSuggestions.length === 0 ? 0 : Math.min(current, mentionSuggestions.length - 1));
  }, [mentionRange?.query, mentionSuggestions.length]);
  useEffect(() => {
    setCommandIndex((current) =>
      commandSuggestions.length === 0
        ? 0
        : Math.min(current, commandSuggestions.length - 1),
    );
  }, [commandRange?.query, commandSuggestions.length]);
  // Mirror the desktop's TipTap suggestion plugin behaviour: while the slash
  // popover is open, a pointerdown outside the composer region cancels the
  // slash invocation. The Escape handler above already does the same thing
  // for the keyboard. Without this, the popover stays pinned above the
  // composer until the user types a space or deletes the "/" by hand. We keep
  // refs to `draft` and the current range so the listener always sees the
  // latest values without re-attaching on every keystroke.
  const slashDraftRef = useRef(draft);
  const slashRangeRef = useRef(commandRange);
  useEffect(() => {
    slashDraftRef.current = draft;
    slashRangeRef.current = commandRange;
  });
  const slashPanelOpen = commandRange !== undefined;
  useEffect(() => {
    if (!composerMenu && !permissionMenuOpen && !mentionRange) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      // The three surfaces share this listener but NOT their container: the
      // `+` menu and the mention list are anchored to the textarea and stay
      // open while the caret moves inside the composer, while the permission
      // popover is a dropdown hinged to the footer button and dismisses on any
      // other click, the textarea included. Judging all three against the
      // composer region is what made the popover un-dismissable from inside
      // the composer. The decision itself lives in `evaluateComposerDismiss`;
      // see that function for the full rule.
      const dismiss = evaluateComposerDismiss({
        permissionMenuOpen,
        insidePermissionWrap: permissionWrapRef.current?.contains(event.target) === true,
        addMenuOpen: Boolean(composerMenu),
        insideAddWrap: composerAddWrapRef.current?.contains(event.target) === true,
        insideComposerRegion: composerRegionRef.current?.contains(event.target) === true,
      });
      if (!dismiss.closeComposerMenu && !dismiss.closePermissionMenu && !dismiss.closeMentionRange) {
        return;
      }
      if (dismiss.closeComposerMenu) setComposerMenu(undefined);
      if (dismiss.closePermissionMenu) setPermissionMenuOpen(false);
      if (dismiss.closeMentionRange) setMentionRange(undefined);
    };
    return dom.listenForPointerDown(onPointerDown);
  }, [composerMenu, dom, permissionMenuOpen, mentionRange]);
  // The workspace picker had NO outside-close listener at all: the only ways to
  // close it were re-clicking its trigger, picking a row, or navigating away,
  // so a stray click anywhere on the page left the panel hanging open. It gets
  // its own effect rather than joining the listener above because it is a
  // separate surface with a separate container — the trigger-and-panel wrap —
  // and it renders below the form, outside the composer's own dismiss group.
  useEffect(() => {
    if (!workspaceMenuOpen && !workspaceBrowserOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        evaluateOutsideClose({
          surface: "workspacePicker",
          kind: "pointerdown",
          insideContainer: workspacePickerRef.current?.contains(event.target) === true,
        }) !== "close"
      ) {
        return;
      }
      setWorkspaceMenuOpen(false);
      setWorkspaceBrowserOpen(false);
    };
    return dom.listenForPointerDown(onPointerDown);
  }, [dom, workspaceMenuOpen, workspaceBrowserOpen, setWorkspaceMenuOpen]);
  // Flip the popover below the composer when there isn't enough room above
  // for the full 320px cap. The measurement runs in `useLayoutEffect` so the
  // first paint already shows the correct placement — a normal `useEffect`
  // would let the panel render above, then re-render below, producing a
  // visible "jump" the moment the user types `/`.
  const [slashPanelBelow, setSlashPanelBelow] = useState(false);
  useLayoutEffect(() => {
    if (!slashPanelOpen) {
      setSlashPanelBelow(false);
      return;
    }
    const region = composerRegionRef.current;
    if (!region) return;
    const measure = () => {
      const rect = region.getBoundingClientRect();
      // Leave headroom of `28px` (= composer top + 24px footer padding + 4px
      // breathing) so the panel never clips into the viewport top edge.
      const availableAbove = Math.max(0, rect.top - 28);
      const needsFlip = availableAbove < 280;
      setSlashPanelBelow(needsFlip);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [slashPanelOpen, slashSkills.length]);
  useEffect(() => {
    if (!slashPanelOpen) return;
    const region = composerRegionRef.current;
    if (!region) return;
    const onPointerDown = (event: PointerEvent) => {
      const range = slashRangeRef.current;
      if (!range) return;
      if (!(event.target instanceof Node)) return;
      const insideContainer = region.contains(event.target);
      // Slash popover's per-surface variant subscribes to `pointerdown`
      // only (no Escape handler — the composer input change handler is
      // the only path). Routing through `evaluateOutsideClose` keeps the
      // four call sites consistent without changing the original close
      // semantics.
      if (
        evaluateOutsideClose({
          surface: "slashPopover",
          kind: "pointerdown",
          insideContainer,
        }) !== "close"
      ) {
        return;
      }
      // Same clear-and-close as Escape: drop the "/xxx" token so the
      // palette no longer has a token under the caret and disappears.
      onDraftChange(removeWebuiSlashToken(slashDraftRef.current, range));
    };
    return dom.listenForPointerDown(onPointerDown);
  }, [dom, slashPanelOpen, onDraftChange]);
  const addFiles = async (filesLike: FileList | readonly File[] | null) => {
    const files = filesLike ? Array.from(filesLike) : [];
    if (files.length === 0) return;
    const limitError = webuiAttachmentLimitError(attachments, files.map((file) => ({ sizeBytes: file.size })));
    if (limitError) {
      setInteractionError(limitError);
      return;
    }
    setAttachmentBusy(true);
    setInteractionError(undefined);
    try {
      const additions = await Promise.all(files.map(async (file): Promise<WebuiComposerAttachment> => {
        const dataUrl = await readBrowserFile(file);
        const fileName = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        return {
          id: crypto.randomUUID(),
          fileName,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          dataUrl,
          kind: file.type.startsWith("image/") ? "image" : "file",
        };
      }));
      setAttachments((current) => [...current, ...additions]);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setAttachmentBusy(false);
    }
  };
  const seededToken = composerSnapshot.staging.seedToken;
  useEffect(() => {
    const seed = seedAttachment;
    if (!seed || seededToken === seed.token) return;
    // Mark it consumed before anything that can bail. A seed the composer
    // refuses has to stay refused; retrying on every attachment change would
    // pin the error in place.
    composerStore.setStaging({ seedToken: seed.token });
    const limitError = webuiAttachmentLimitError(attachments, [{ sizeBytes: seed.sizeBytes }]);
    if (limitError) {
      setInteractionError(limitError);
      return;
    }
    setAttachments((current) => [
      ...current,
      {
        id: `seed-${seed.token}`,
        fileName: seed.fileName,
        mimeType: seed.mimeType,
        sizeBytes: seed.sizeBytes,
        dataUrl: webuiTextAttachmentDataUrl(seed.mimeType, seed.content),
        kind: "file",
      },
    ]);
  }, [attachments, seedAttachment]);
  const attachmentWire = attachments.map((attachment) => ({
    meta: {
      attachmentType: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    },
    local: { dataUrl: attachment.dataUrl },
  }));
  const replaceMention = (insertion: string) => {
    if (!mentionRange) return;
    const result = insertWebuiMention(draft, mentionRange, insertion);
    pendingMentionCaretRef.current = result.caret;
    onDraftChange(result.value);
    setMentionRange(undefined);
  };
  const insertAtCaret = (insertion: string) => {
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret);
    const prefix = before.length > 0 && !/\s$/u.test(before) ? " " : "";
    const inserted = `${prefix}${insertion} `;
    pendingMentionCaretRef.current = before.length + inserted.length;
    onDraftChange(`${before}${inserted}${draft.slice(caret)}`);
  };
  const chooseMention = (choice: ComposerMentionChoice) => {
    setMentionRange(undefined);
    if (choice.kind === "plugin") {
      replaceMention(`@${choice.name}`);
      return;
    }
    if (choice.kind === "file") {
      replaceMention(`@${choice.path}`);
      return;
    }
    if (choice.kind === "local-file") {
      replaceMention("");
      fileInputRef.current?.click();
      return;
    }
    if (choice.kind === "local-folder") {
      replaceMention("");
      folderInputRef.current?.click();
      return;
    }
    if (!onSelectSession) {
      setInteractionError("子 Agent 切换暂不可用");
      return;
    }
    replaceMention("");
    onSelectSession(choice.session.sessionId);
  };
  const changePermissionMode = async (mode: WebuiComposerPermissionMode) => {
    if (!setPermissionMode || !getPermissionMode) return;
    setPermissionBusy(true);
    setInteractionError(undefined);
    try {
      await setPermissionMode({ mode });
      const refreshed = readPermissionMode(await getPermissionMode());
      if (refreshed !== mode) throw new Error("授权模式未能保存，请重试");
      setPermissionModeValue(refreshed);
      setPermissionUnavailable(false);
      setPermissionMenuOpen(false);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPermissionBusy(false);
    }
  };
  const activateGoalMode = () => {
    if (!goalEnabled || !goalCoordinator.createGoal) return;
    setGoalMode(true);
    setPlanMode(false);
    onDraftChange("");
    textareaRef.current?.focus();
  };
  const editGoalInComposer = (objective: string) => {
    editingGoalDraftRef.current = true;
    setGoalMode(true);
    setPlanMode(false);
    onDraftChange(objective);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(objective.length, objective.length);
    });
  };
  const cancelGoalMode = () => {
    setGoalMode(false);
    if (!goal || editingGoalDraftRef.current) onDraftChange("");
    editingGoalDraftRef.current = false;
    textareaRef.current?.focus();
  };
  const activatePlanMode = () => {
    setPlanMode(true);
    setGoalMode(false);
    onDraftChange("");
    textareaRef.current?.focus();
  };
  const cancelPlanMode = () => {
    setPlanMode(false);
    onDraftChange("");
    textareaRef.current?.focus();
  };
  const handleDraftChange = (next: string) => {
    if (next.trim().toLowerCase() === "/goal") {
      activateGoalMode();
      return;
    }
    onDraftChange(next);
  };
  const chooseCommand = (command: string) => {
    if (command === "goal") {
      activateGoalMode();
      return;
    }
    if (command === "plan") {
      activatePlanMode();
      return;
    }
    const insertion = `/${command} `;
    // Rewrite only the token the caret sits in. The draft can already hold an
    // earlier "/skill" the user picked; replacing the whole draft wiped it.
    if (!commandRange) {
      onDraftChange(insertion);
      pendingMentionCaretRef.current = insertion.length;
      textareaRef.current?.focus();
      return;
    }
    const result = replaceWebuiSlashToken(draft, commandRange, insertion);
    onDraftChange(result.value);
    // The caret has to land after the trailing space: the palette is open for
    // any token under the caret, so leaving it inside "/command" would pop the
    // panel straight back open.
    pendingMentionCaretRef.current = result.caret;
    textareaRef.current?.focus();
  };
  const commandInvocation = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/u.exec(
    draft.trim(),
  );
  const credentialMessage =
    sessionId && typeof selectedModel?.status?.lastErrorMessage === "string"
      ? selectedModel.status.lastErrorMessage
      : sessionId && accountStatus && accountStatus.available === false
        ? "No usable credentials are available for the selected model."
        : undefined;
  // Typing is always available: composing a message does not need a target yet.
  // The first send creates the target session silently, using the selected project.
  const canCompose = Boolean(sendMessage);
  const canQueue = Boolean(enqueueMessage && sessionId);
  // Turn phase remains part of session runtime state; the transcript owns all
  // visible messages for both the live and settled phases.
  // `isTurnLive` is the single source of truth for the three-value phase
  // predicate; the application session record (`application/state.ts`) carries
  // `sending` as a separate submit-lifecycle boolean the reducer deliberately
  // does NOT merge with `phase` — `submitWebuiComposerTurn` relies on the two
  // staying distinct.
  useLayoutEffect(() => {
    if (!sessionLayout) return undefined;
    const region = composerRegionRef.current;
    const layout = region?.closest<HTMLElement>(
      '[data-webui-session-layout="true"]',
    );
    if (!region || !layout) return undefined;
    const updateReservedHeight = () => {
      // Desktop reserves the measured composer inset plus a small base tail
      // inside its single message viewport. Keep the same contract here so a
      // taller slash/permission/composer state cannot cover the live tail.
      const height = Math.ceil(region.getBoundingClientRect().height);
      layout.style.setProperty(
        "--webui-composer-bottom-padding",
        `${height + 16}px`,
      );
    };
    updateReservedHeight();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateReservedHeight);
    observer?.observe(region);
    window.addEventListener("resize", updateReservedHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateReservedHeight);
      layout.style.removeProperty("--webui-composer-bottom-padding");
    };
  }, [sessionLayout]);
  const messageDraft = [draft.trim(), ...urlReferences.map((reference) => reference.url.trim()).filter(Boolean)].filter(Boolean).join("\n");
  const sendable = (canCompose || canQueue) && (Boolean(messageDraft) || attachments.length > 0);
  // The one gate for "a submit can start right now". The send button's
  // `disabled` and the Enter shortcut both read this value, so the keyboard
  // can never open a submit path the button itself would have refused.
  const submitBlocked = !sendable || commandRunning || goalSubmitting;
  /**
   * The one way a turn reaches the wire. `submit` calls it after resolving an
   * intent; the retry affordance calls it with the input recorded at submit
   * time. Retry deliberately re-enters THIS path rather than a second send of
   * its own, so it inherits the rules an ordinary send obeys — including the
   * "a turn is already in flight ⇒ enqueue" branch inside
   * `submitWebuiComposerTurn`, which is what keeps a retry from racing a
   * running turn.
   *
   * The turn's sink is minted inside `submitTurn` (the binding owns the store
   * writer and the writer it builds), so this component holds no factory and
   * names no session key: it submits the intent and the callbacks it owns. The
   * assembly of the handler bundle now happens inside `sendWebuiTurn`, where the
   * writer — and with it the sink — is in scope.
   */
  const sendTurn = async (turn: {
    readonly message: string;
    readonly clientIntent?: string;
  }) => {
    await submitTurn({
      message: turn.message,
      ...(turn.clientIntent ? { clientIntent: turn.clientIntent } : {}),
      planMode,
      attachments: attachmentWire,
      onAttachmentsSubmitted: () => {
        setAttachments([]);
        setUrlReferences([]);
      },
      sending,
      createSessionWorkspaceDir,
      teamModeOff,
      onDraftChange,
      onNeedsSession,
      onSessionCreated,
      onQueued: () => {
        if (!sessionId || !listQueueMessages) return;
        void listQueueMessages({ id: sessionId })
          .then((queue) => {
            setQueueItems({
              items: queue.items ?? [],
              paused: queue.paused === true,
            });
          })
          .catch((error: unknown) => {
            setInteractionError(
              error instanceof Error ? error.message : String(error),
            );
          });
      },
    });
  };
  // The input of the last turn this composer submitted, kept locally so retry
  // can re-send it without asking the server what was asked. One holder: the
  // owner's, which the handler reads synchronously and the render subscribes to,
  // so there is no second copy to fall out of step.
  const recordedTurn = composerSnapshot.retry;
  const recordSubmittedTurn = (message: string) => {
    composerStore.setRetry({ session: sessionId, message });
  };
  const retryPlan = planWebuiRetryResend({
    refusal: stream.refusal,
    recordedSession: recordedTurn?.session,
    session: sessionId,
    lastSubmittedText: recordedTurn?.message,
  });
  const handleRetryResend = () => {
    resendRecordedWebuiTurn({
      refusal: stream.refusal,
      // Read from the owner: the handler needs the value current *now*, not the
      // one the render that installed it saw.
      recordedTurn: composerStore.readRetry(),
      session: sessionId,
      sendTurn,
    });
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const command = commandInvocation
      ? slashSectioned.find(
          (item) => item.name === commandInvocation[1],
        )
      : undefined;
    // Pure intent resolution — five paths: activate-goal-mode, submit-goal,
    // run-command, submit-turn (which submitWebuiComposerTurn further
    // splits into send+resume vs queue). All side effects (state updates,
    // draft clearing, auto-follow lock, error rendering) stay in this
    // function so the resolver itself can be tested without React.
    const intent = resolveWebuiSubmissionIntent({
      draft: messageDraft,
      commandMatch: command,
      ...(commandInvocation?.[2] !== undefined
        ? { commandInvocationInput: commandInvocation[2] }
        : {}),
      goalMode,
      planMode,
    });
    const resolvedIntent = intent ?? (attachments.length > 0 ? { kind: "submit-turn" as const } : undefined);
    if (!resolvedIntent) return;
    // Record the sendable text for ↑ recall on every committed intent —
    // send/queue turns, goal objectives, and runnable commands all start as
    // user-typed composer text. Recording at commit time (not transport
    // success) keeps a refused send from silently eating the user's input,
    // and mode activations (`/goal`, `/plan` bare) record nothing.
    if (
      resolvedIntent.kind === "submit-turn" ||
      resolvedIntent.kind === "submit-goal" ||
      resolvedIntent.kind === "run-command"
    ) {
      onInputSubmitted?.(messageDraft);
      setHistoryBrowse(undefined);
    }
    if (resolvedIntent.kind === "activate-goal-mode") {
      activateGoalMode();
      return;
    }
    if (resolvedIntent.kind === "activate-plan-mode") {
      activatePlanMode();
      return;
    }
    if (resolvedIntent.kind === "submit-goal") {
      const { objective } = resolvedIntent;
      if (!goalCoordinator.createGoal || !goalEnabled) return;
      setGoalSubmitting(true);
      setInteractionError(undefined);
      try {
        const nextGoal = await submitWebuiGoal(
          {
            sessionId,
            objective,
            currentGoal: goal,
            createGoal: goalCoordinator.createGoal,
            patchGoal: goalCoordinator.patchGoal,
            createSession,
            createSessionWorkspaceDir,
            teamModeOff,
          },
          onSessionCreated,
        );
        applyGoal(nextGoal);
        setGoalMode(nextGoal.status !== "complete");
        onDraftChange("");
        editingGoalDraftRef.current = false;
      } catch (error) {
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setGoalSubmitting(false);
      }
      return;
    }
    if (resolvedIntent.kind === "run-command") {
      const { command: matchedCommand, input } = resolvedIntent;
      // The original gate (`runCommand && command && isWebuiRunnableCommand`)
      // collapsed into the intent, but the `runCommand` runtime check stays
      // here — the resolver is the source of truth for *which* path, the
      // component is still the source of truth for *whether the host wired
      // the capability* (a disabled host must not reach the run-path).
      if (!runCommand) return;
      setCommandRunning(true);
      setInteractionError(undefined);
      try {
        const result = await runCommand({
          command: matchedCommand.name,
          ...(input ? { input } : {}),
          ...(sessionId ? { sessionId } : {}),
          agentName,
          ...(createSessionWorkspaceDir
            ? { workspaceDir: createSessionWorkspaceDir }
            : {}),
        });
        const output =
          typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.data ?? result, null, 2);
        setCommandOutput(output);
        onDraftChange("");
      } catch (error) {
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setCommandRunning(false);
      }
      return;
    }
    // intent.kind === "submit-turn"
    if (resolvedIntent.clientIntent === "plan-entry") {
      setGoalMode(false);
      setPlanMode(true);
    }
    // The exact value `submitWebuiComposerTurn` puts on the wire: it reads
    // `message ?? draft` and trims it, so recording the effective text here is
    // what lets a later retry reproduce this send byte for byte.
    const effectiveMessage = resolvedIntent.message ?? draft;
    recordSubmittedTurn(effectiveMessage);
    await sendTurn({
      message: effectiveMessage,
      ...(resolvedIntent.clientIntent
        ? { clientIntent: resolvedIntent.clientIntent }
        : {}),
    });
  };
  const clearLocalGoal = () => {
    applyGoal(undefined);
    setGoalMode(false);
  };
  // A request that sets `replaceComposer` owns the composer's slot: the
  // runtime sets it on every ordinary questionnaire and on the plan review
  // (only feature-enable requests leave it false), and the desktop draws the
  // interaction card exactly where the input would be. The input therefore
  // yields its place rather than sitting under the card, and comes back the
  // moment the request is answered — which is the whole point of the flag.
  const composerReplaced =
    questionnaire !== undefined &&
    (questionnaire.presentation?.replaceComposer ?? true);
  return (
    <section
      aria-label="Compose message"
      className={`w-full ${sessionLayout ? "webui-session-composer" : ""}`}
      data-webui-session-composer={sessionLayout ? "true" : undefined}
    >
      {sessionId ? (
        <WebuiInteractionPanel
          sessionId={sessionId}
          permissions={permissions}
          questionnaire={questionnaire}
          onPermission={handlePermission}
          onQuestionnaire={handleQuestionnaire}
          onDismiss={handleDismiss}
          interactionError={interactionError}
        />
      ) : null}
      {/* The pause notice was gated on a session while the queue list was not,
          and the component keeps that split: there is no queue to pause before
          a session exists, but the list is a pure function of `queueItems`. */}
      <WebuiQueuePanel
        items={queueItems}
        paused={sessionId ? queuePaused : false}
        onRemove={(item) => void handleDeleteQueueItem(item)}
      />
      {stream.refusal ? (
        <OutputError
          variant="output_error"
          text={stream.refusal}
          errorAt={Date.now()}
          {...(retryPlan.kind === "resend" ? { onRetry: handleRetryResend } : {})}
        />
      ) : null}
      {commandOutput ? (
        <pre
          className="mt-3 w-full whitespace-pre-wrap text-text_default_secondary text-size_12 leading-line_height_16"
          data-webui-command-output="true"
        >
          {commandOutput}
        </pre>
      ) : null}
      {stream.transcriptIncomplete ? (
        <p
          data-webui-transcript-incomplete="true"
          className="text-text_default_secondary text-size_14 leading-line_height_20"
        >
          The displayed transcript may be incomplete; the last update failed
          before all frames could be applied.
        </p>
      ) : null}

      <div
        ref={composerRegionRef}
        className={`relative ${sessionLayout ? "mt-0 webui-session-composer-overlay" : "mt-8"} w-full`}
        data-webui-composer-region="true"
        data-webui-session-composer-overlay={sessionLayout ? "true" : undefined}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="webui-composer-hidden-file-input"
          aria-label="添加文件或图片"
          onChange={(event) => { void addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="webui-composer-hidden-file-input"
          aria-label="添加本地文件夹"
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(event) => { void addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
        />
        <div className={sessionLayout && sessionId && goalEnabled && goal ? "webui-goal-composer-panel" : undefined}>
        {sessionId && goalEnabled && goal ? <WebuiGoalBanner goal={goal} patchGoal={goalCoordinator.patchGoal} clearGoal={goalCoordinator.clearGoal} onEditGoal={editGoalInComposer} onCleared={clearLocalGoal} interactionBlocked={Boolean(questionnaire || permissions.length > 0)} /> : null}
        {!composerReplaced ? (
        <form
          onSubmit={submit}
          onDragOver={(event) => { if (event.dataTransfer.files.length) event.preventDefault(); }}
          onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(event.dataTransfer.files); } }}
          data-webui-composer="true"
          className="w-full"
        >
          <div className="message-input-home-container flex flex-col items-center gap-1.5 rounded-[20px] bg-bg_default_scrim pb-2">
            <div className="w-full rounded-[20px] border border-border_default bg-bg_grouped_secondary_elevated p-3 webui-composer-card">
              <div className="message-input-container relative transition-colors">
                <label className="sr-only" htmlFor={`${fieldId}-content`}>
                  Message
                </label>
                <textarea
                  ref={textareaRef}
                  id={`${fieldId}-content`}
                  name="content"
                  rows={2}
                  value={draft}
                  onChange={(event) => {
                    const next = event.target.value;
                    handleDraftChange(next);
                    // A real user edit ends any active history browse (see
                    // the browse state comment above).
                    setHistoryBrowse(undefined);
                    const caret = event.target.selectionStart;
                    mentionCaretRef.current = caret;
                    setComposerCaret(caret);
                    const nextMentionRange = findWebuiMentionRange(next, caret);
                    if (nextMentionRange) {
                      setComposerMenu(undefined);
                      setPermissionMenuOpen(false);
                    }
                    setMentionRange(nextMentionRange);
                  }}
                  onPaste={(event) => {
                    const pastedFiles = Array.from(event.clipboardData.items).flatMap((item) => item.kind === "file" ? [item.getAsFile()].filter((file): file is File => file !== null) : []);
                    if (pastedFiles.length) { event.preventDefault(); void addFiles(pastedFiles); return; }
                    const pastedText = event.clipboardData.getData("text/plain").trim();
                    if (/^https?:\/\/\S+$/iu.test(pastedText)) {
                      event.preventDefault();
                      const start = event.currentTarget.selectionStart;
                      const end = event.currentTarget.selectionEnd;
                      pendingMentionCaretRef.current = start;
                      onDraftChange(`${draft.slice(0, start)}${draft.slice(end)}`);
                      setUrlReferences((current) => [...current, { id: crypto.randomUUID(), url: pastedText }]);
                    }
                  }}
                  onClick={(event) => {
                    setComposerCaret(event.currentTarget.selectionStart);
                    const nextMentionRange = findWebuiMentionRange(event.currentTarget.value, event.currentTarget.selectionStart);
                    if (nextMentionRange) {
                      setComposerMenu(undefined);
                      setPermissionMenuOpen(false);
                    }
                    setMentionRange(nextMentionRange);
                  }}
                  onKeyUp={(event) => {
                    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
                    setComposerCaret(event.currentTarget.selectionStart);
                    setMentionRange(findWebuiMentionRange(event.currentTarget.value, event.currentTarget.selectionStart));
                  }}
                  onKeyDown={(event) => {
                    if (mentionRange && mentionSuggestions.length > 0) {
                      if (event.key === "Escape") { event.preventDefault(); setMentionRange(undefined); return; }
                      if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((current) => (current + 1) % mentionSuggestions.length); return; }
                      if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length); return; }
                      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const choice = mentionSuggestions[mentionIndex]; if (choice) chooseMention(choice); return; }
                    }
                    if (event.key === "Escape" && composerMenu) { event.preventDefault(); setComposerMenu(undefined); return; }
                    if (event.key === "Escape" && permissionMenuOpen) { event.preventDefault(); setPermissionMenuOpen(false); return; }
                    if (event.key === "Escape" && (goalMode || planMode)) {
                      event.preventDefault();
                      if (goalMode) cancelGoalMode();
                      else cancelPlanMode();
                      return;
                    }
                    if (event.key === "Escape" && commandRange) {
                      // Mirrors the desktop Escape handling: drop the "/xxx"
                      // token under the caret so the palette closes. Text
                      // before it survives — the user may have typed a
                      // prefix word — which is what cancels this invocation.
                      event.preventDefault();
                      const next = removeWebuiSlashToken(draft, commandRange);
                      onDraftChange(next);
                      setComposerCaret(next.length);
                      return;
                    }
                    if (event.key === "Escape" && historyBrowse) {
                      // Escape during a history browse restores the draft as
                      // it was before ↑ first recalled. Sits after the slash
                      // palette's own Escape so a recalled "/…" closes the
                      // palette first and exits the browse on the second tap.
                      event.preventDefault();
                      const stashed = historyBrowse.draft;
                      setHistoryBrowse(undefined);
                      applyHistoryDraft(stashed);
                      return;
                    }
                    // History recall claims ↑/↓ only when nothing else has:
                    // the mention menu (above) and the slash popover (below,
                    // behind the `commandSuggestions.length === 0` guard) own
                    // the arrows while they are open.
                    if (
                      commandSuggestions.length === 0 &&
                      (event.key === "ArrowUp" || event.key === "ArrowDown")
                    ) {
                      const caret = event.currentTarget.selectionStart ?? 0;
                      if (event.key === "ArrowUp") {
                        const next = historyBrowse
                          ? stepWebuiHistoryBrowse(historyBrowse, "prev", inputHistory)
                          : shouldRecallWebuiHistory(draft, caret)
                            ? startWebuiHistoryBrowse(inputHistory, draft)
                            : undefined;
                        if (next) {
                          event.preventDefault();
                          setHistoryBrowse(next);
                          applyHistoryDraft(inputHistory[next.index] ?? "");
                          return;
                        }
                      } else if (historyBrowse) {
                        const next = stepWebuiHistoryBrowse(historyBrowse, "next", inputHistory);
                        event.preventDefault();
                        setHistoryBrowse(next);
                        // Stepping past the newest exits and restores the
                        // stashed pre-browse draft.
                        applyHistoryDraft(next ? inputHistory[next.index] ?? "" : historyBrowse.draft);
                        return;
                      }
                    }
                    // Enter is claimed above by an open mention menu, and below by
                    // an open slash popover. This MUST sit before the
                    // `commandSuggestions.length === 0` guard: that guard
                    // returns for EVERY key, so a branch placed after it never
                    // runs in the common case of an ordinary message — which is
                    // exactly how a first attempt at this silently did nothing.
                    if (event.key === "Enter" && commandSuggestions.length === 0) {
                      const action = resolveWebuiComposerEnterAction({
                        shiftKey: event.shiftKey,
                        altKey: event.altKey,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey,
                        isComposing: event.nativeEvent.isComposing,
                        submitBlocked,
                      });
                      if (action === "submit") {
                        event.preventDefault();
                        // `requestSubmit` raises the form's submit event rather
                        // than bypassing it, so the keyboard lands on the same
                        // `onSubmit` the send button reaches.
                        event.currentTarget.form?.requestSubmit();
                        return;
                      }
                    }
                    if (commandSuggestions.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setCommandIndex(
                        (current) =>
                          (current + 1) % commandSuggestions.length,
                      );
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setCommandIndex(
                        (current) =>
                          (current - 1 + commandSuggestions.length) %
                          commandSuggestions.length,
                      );
                    } else if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      const command = commandSuggestions[commandIndex];
                      if (command) chooseCommand(command.name);
                    }
                  }}
                  disabled={!canCompose && !canQueue}
                  placeholder={goalMode ? "描述你想完成的目标" : planMode ? "描述需要规划的任务..." : "输入消息…（输入 / 唤起命令）"}
                  className="webui-textarea webui-composer-input text-text_default_primary"
                  data-webui-composer-input="true"
                />
                {mentionRange && mentionSuggestions.length > 0 ? (
                  <div className="webui-composer-mention-menu" role="listbox" aria-label="提及列表" data-webui-mention-menu="true">
                    {mentionSuggestions.map((choice, index) => (
                      <Fragment key={`${choice.section}:${choice.kind}:${choice.kind === "agent" ? choice.session.sessionId : choice.kind === "file" ? choice.path : choice.kind === "plugin" ? choice.name : choice.label}`}>
                        {(index === 0 || mentionSuggestions[index - 1]?.section !== choice.section) ? <div className="webui-composer-mention-section" role="presentation">{choice.section}</div> : null}
                        <button type="button" role="option" aria-selected={index === mentionIndex} className="webui-composer-mention-option" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setMentionIndex(index)} onClick={() => chooseMention(choice)}>
                          <span>{choice.label}</span>
                          {choice.kind === "plugin" && choice.detail ? <small>{choice.detail}</small> : null}
                        </button>
                      </Fragment>
                    ))}
                  </div>
                ) : null}
                {attachments.length > 0 ? (
                  <div className="webui-composer-attachments" data-webui-composer-attachments="true">
                    {attachments.map((attachment) => <div key={attachment.id} className={`webui-composer-attachment${attachment.kind === "image" ? " is-image" : ""}`}>
                      {attachment.kind === "image" ? <img src={attachment.dataUrl} alt={attachment.fileName} /> : <span className="webui-composer-attachment-type">{attachment.fileName.split(".").pop()?.toUpperCase() ?? "FILE"}</span>}
                      <span className="webui-composer-attachment-name" title={attachment.fileName}>{attachment.fileName}</span>
                      <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}>×</button>
                    </div>)}
                    {urlReferences.map((reference) => <div key={reference.id} className="webui-composer-url-reference">
                      <span aria-hidden="true">↗</span>
                      <input aria-label="URL 引用" value={reference.url} onChange={(event) => setUrlReferences((current) => current.map((item) => item.id === reference.id ? { ...item, url: event.target.value } : item))} />
                      <button type="button" aria-label="移除 URL 引用" onClick={() => setUrlReferences((current) => current.filter((item) => item.id !== reference.id))}>×</button>
                    </div>)}
                    {attachmentBusy ? <span className="webui-composer-attachment-loading" role="status">正在读取文件…</span> : null}
                  </div>
                ) : urlReferences.length > 0 ? <div className="webui-composer-attachments" data-webui-composer-attachments="true">{urlReferences.map((reference) => <div key={reference.id} className="webui-composer-url-reference"><span aria-hidden="true">↗</span><input aria-label="URL 引用" value={reference.url} onChange={(event) => setUrlReferences((current) => current.map((item) => item.id === reference.id ? { ...item, url: event.target.value } : item))} /><button type="button" aria-label="移除 URL 引用" onClick={() => setUrlReferences((current) => current.filter((item) => item.id !== reference.id))}>×</button></div>)}</div> : null}
                {commandSuggestions.length > 0 ? (
                  <div
                    role="listbox"
                    aria-label="命令"
                    data-webui-command-menu="true"
                    data-webui-command-menu-placement={slashPanelBelow ? "below" : "above"}
                    className="webui-command-menu"
                  >
                    {commandSuggestions.map((command, index) => {
                      const Icon = command.icon;
                      const inert = !command.supported;
                      const isFirstSkill =
                        command.paletteSection === "skills" &&
                        (index === 0 ||
                          commandSuggestions[index - 1]?.paletteSection !==
                            "skills");
                      return (
                        <Fragment key={command.name}>
                          {isFirstSkill ? (
                            <div
                              role="separator"
                              data-webui-command-section="skills"
                              className="webui-command-section-header"
                            >
                              技能
                            </div>
                          ) : null}
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === commandIndex}
                            aria-disabled={inert || undefined}
                            disabled={inert}
                            data-webui-command-option-inert={
                              inert ? "true" : undefined
                            }
                            className="webui-command-option"
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => {
                              if (inert) return;
                              setCommandIndex(index);
                            }}
                            onClick={() => {
                              if (inert) return;
                              chooseCommand(command.name);
                            }}
                          >
                            <Icon className="webui-command-option-icon text-icon_default_secondary" />
                            <span className="webui-command-option-label">
                              {command.label}
                            </span>
                            <span className="webui-command-option-description text-text_default_tertiary">
                              {command.description}
                            </span>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div
                className="flex w-full items-center gap-3 px-3 pt-1"
                data-webui-composer-toolbar="true"
              >
                <div className="webui-composer-add-wrap" ref={composerAddWrapRef}>
                <button
                  type="button"
                  aria-label="添加附件或技能"
                  aria-expanded={Boolean(composerMenu)}
                  aria-haspopup="menu"
                  data-testid="composer-add-menu"
                  className="webui-icon-button text-icon_default_tertiary"
                  onClick={() => {
                    setPermissionMenuOpen(false);
                    setMentionRange(undefined);
                    setComposerMenu((current) => current ? undefined : "root");
                  }}
                >
                  <WebuiIconAttach />
                </button>
        {/* The panel lives inside the trigger's wrap rather than at the end of
         * the section. Anchoring it to the `+` button means it always clears
         * that button — the old `bottom: 56px` was measured from the composer
         * region, so the panel grew over the `+` and the permission pill as
         * soon as the workspace bar changed the region's height. The wrap is
         * also the surface's container for outside-close, which is why a click
         * inside the composer could not dismiss it. */}
        {composerMenu ? (
          <div
            className="webui-composer-menu-stack"
            data-webui-composer-menu-stack="true"
            data-webui-open-submenu={composerMenu === "root" ? undefined : composerMenu}
            onMouseLeave={() => { if (composerMenu !== "root") setComposerMenu("root"); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setComposerMenu(undefined);
              } else if (event.key === "ArrowRight" && event.target instanceof Element && event.target.closest<HTMLElement>("[data-webui-composer-submenu-trigger]")) {
                event.preventDefault();
                const submenu = event.target.closest<HTMLElement>("[data-webui-composer-submenu-trigger]")?.dataset.webuiComposerSubmenuTrigger;
                const stack = event.currentTarget;
                if (submenu) window.requestAnimationFrame(() => stack.querySelector<HTMLElement>(`[data-webui-composer-submenu="${submenu}"] [role="menuitem"]`)?.focus());
              } else if (event.key === "ArrowLeft" && event.target instanceof Element && event.target.closest("[data-webui-composer-submenu]")) {
                event.preventDefault();
                const submenu = event.target.closest<HTMLElement>("[data-webui-composer-submenu]")?.dataset.webuiComposerSubmenu;
                setComposerMenu("root");
                if (submenu) event.currentTarget.querySelector<HTMLElement>(`[data-webui-composer-submenu-trigger="${submenu}"]`)?.focus();
              }
            }}
          >
            <div className="webui-composer-menu" role="menu" aria-label="添加附件或技能" data-webui-composer-menu="root">
              <button type="button" role="menuitem" onMouseEnter={() => { if (composerMenu !== "root") setComposerMenu("root"); }} onFocus={() => { if (composerMenu !== "root") setComposerMenu("root"); }} onClick={() => { setComposerMenu(undefined); fileInputRef.current?.click(); }}><WebuiIconAttach className="webui-composer-menu-icon" />添加文件或图片</button>
              <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={composerMenu === "skills"} data-webui-composer-submenu-trigger="skills" onMouseEnter={() => setComposerMenu("skills")} onFocus={() => setComposerMenu("skills")} onClick={() => setComposerMenu("skills")}><WebuiIconSkillGeneric className="webui-composer-menu-icon" />技能 <span aria-hidden="true">›</span></button>
              <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={composerMenu === "plugins"} data-webui-composer-submenu-trigger="plugins" onMouseEnter={() => setComposerMenu("plugins")} onFocus={() => setComposerMenu("plugins")} onClick={() => setComposerMenu("plugins")}><WebuiIconPlugins className="webui-composer-menu-icon" />插件 <span aria-hidden="true">›</span></button>
              <div role="separator" />
              <button type="button" role="menuitem" onMouseEnter={() => { if (composerMenu !== "root") setComposerMenu("root"); }} onFocus={() => { if (composerMenu !== "root") setComposerMenu("root"); }} onClick={() => { setComposerMenu(undefined); activateGoalMode(); }}><WebuiIconCommandGoal className="webui-composer-menu-icon" />目标</button>
              <button type="button" role="menuitem" onMouseEnter={() => { if (composerMenu !== "root") setComposerMenu("root"); }} onFocus={() => { if (composerMenu !== "root") setComposerMenu("root"); }} onClick={() => { setComposerMenu(undefined); chooseCommand("plan"); }}><WebuiIconCommandPlan className="webui-composer-menu-icon" />计划</button>
            </div>
            {composerMenu === "skills" ? (
              <div className="webui-composer-menu" role="menu" aria-label="技能" data-webui-composer-menu="skills" data-webui-composer-submenu="skills">
                {skillsMenuLoading ? <div className="webui-composer-menu-empty">正在加载技能…</div> : skillsMenuError ? <div className="webui-composer-menu-empty" role="alert">{skillsMenuError}</div> : slashSkills.length ? slashSkills.map((skill) => <button key={skill.name} type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); insertAtCaret(`/${skill.name}`); textareaRef.current?.focus(); }}>{skill.displayName ?? skill.name}</button>) : <div className="webui-composer-menu-empty">没有已安装的技能</div>}
                <div role="separator" />
                <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); onOpenPluginManagement?.("skills"); }}>管理技能</button>
                <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); onOpenPluginManagement?.("skills"); }}>添加技能</button>
              </div>
            ) : composerMenu === "plugins" ? (
              <div className="webui-composer-menu" role="menu" aria-label="插件" data-webui-composer-menu="plugins" data-webui-composer-submenu="plugins">
                {pluginsLoading ? <div className="webui-composer-menu-empty">正在加载插件…</div> : pluginsError ? <div className="webui-composer-menu-empty" role="alert">{pluginsError}</div> : installedPlugins.length ? installedPlugins.map((plugin) => <button key={plugin.name} type="button" role="menuitem" title={plugin.description} onClick={() => { setComposerMenu(undefined); insertAtCaret(`@${plugin.name}`); textareaRef.current?.focus(); }}>{plugin.displayName}</button>) : <div className="webui-composer-menu-empty">{pluginManagement ? "没有已安装的插件" : "插件目录暂不可用"}</div>}
                <div role="separator" />
                <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); onOpenPluginManagement?.("plugins"); }}>添加插件</button>
              </div>
            ) : null}
          </div>
        ) : null}
                </div>
                <div className="webui-composer-permission-wrap" ref={permissionWrapRef}>
                  <button
                    type="button"
                    className={`webui-composer-permission-button${permissionMode === "bypassPermissions" ? " webui-composer-permission-button--warning" : ""}`}
                    aria-label={permissionMode ? `授权模式：${PERMISSION_MODE_OPTION[permissionMode].label}` : "授权模式"}
                    aria-haspopup="menu"
                    aria-expanded={permissionMenuOpen}
                    disabled={permissionUnavailable || permissionBusy || !permissionMode}
                    title={permissionUnavailable ? "授权模式当前不可用" : undefined}
                    data-testid="composer-permission-mode"
                    onClick={() => {
                      setComposerMenu(undefined);
                      setMentionRange(undefined);
                      setPermissionMenuOpen((open) => !open);
                    }}
                  >
                    {permissionMode ? <PermissionModeIcon mode={permissionMode} /> : <WebuiIconPermissionRequest className="webui-composer-permission-icon" />}
                    <span>{permissionMode ? PERMISSION_MODE_OPTION[permissionMode].label : permissionUnavailable ? "授权不可用" : "读取授权模式…"}</span>
                    <WebuiIconChevronDown className="webui-composer-permission-chevron" />
                  </button>
                  {permissionMenuOpen ? <div className="webui-composer-permission-menu" role="menu" aria-label={PERMISSION_MODE_QUESTION} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setPermissionMenuOpen(false); } }}>
                    <div className="webui-composer-permission-header">
                      <span className="webui-composer-permission-question">{PERMISSION_MODE_QUESTION}</span>
                      <a
                        className="webui-composer-permission-learn-more"
                        href={PERMISSION_MODE_DOCS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {PERMISSION_MODE_LEARN_MORE}
                      </a>
                    </div>
                    {PERMISSION_MODE_ORDER.map((mode) => {
                      const option = PERMISSION_MODE_OPTION[mode];
                      const { Icon } = option;
                      const active = permissionMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          className="webui-composer-permission-option"
                          disabled={permissionBusy}
                          onClick={() => void changePermissionMode(mode)}
                        >
                          <Icon className="webui-composer-permission-icon" />
                          <span className="webui-composer-permission-copy">
                            <span className="webui-composer-permission-label">{option.label}</span>
                            <span className="webui-composer-permission-description">{option.description}</span>
                          </span>
                          {active ? <WebuiIconCheck className="webui-composer-permission-check" /> : null}
                        </button>
                      );
                    })}
                  </div> : null}
                </div>
                {goalEnabled && goalCoordinator.createGoal && goalMode ? (
                  <button
                    type="button"
                    className={`webui-goal-mode-button${goalMode ? " is-active" : ""}`}
                    aria-pressed={goalMode}
                    aria-label="取消目标模式"
                    data-testid="composer-goal-mode"
                    disabled={goalSubmitting || Boolean(questionnaire || permissions.length > 0)}
                    onClick={cancelGoalMode}
                  >
                    <WebuiIconCommandGoal />
                    <span>目标</span>
                  </button>
                ) : null}
                {planMode ? (
                  <button
                    type="button"
                    className="webui-goal-mode-button is-active"
                    aria-pressed="true"
                    aria-label="退出计划模式"
                    data-testid="composer-plan-mode"
                    disabled={Boolean(questionnaire || permissions.length > 0)}
                    onClick={cancelPlanMode}
                  >
                    <WebuiIconCommandPlan />
                    <span>计划</span>
                  </button>
                ) : null}
                {/* 3.2px, written as an arbitrary value on purpose. The
                 * spacing scale is a fixed enumeration, so `gap-0.8` is not a
                 * class that exists and would silently render a ZERO gap
                 * instead of the 3.2px asked for — a spacing change that
                 * quietly becomes "controls touching" is worse than no change.
                 *
                 * This cluster got here by measurement, across three passes:
                 * 12px → 6px → 4px → 3.2px, each visibly looser than the last
                 * next to controls this small. 3.2 is the floor: the hit areas
                 * are neighbouring 28px squares, and 0 or 2px stops reading as
                 * separate controls at all. */}
                <div className="ml-auto flex items-center gap-[3.2px]">
                  <ContextUsageIndicator
                    usage={contextUsage}
                    usageQuota={usageQuota}
                    planModel={selectedModel}
                  />
                  <WebuiModelPicker
                    models={enabledModels}
                    selected={selectedModel}
                    favorites={favoritesStorage}
                    // The level rides the model name. It is resolved from the
                    // SAME option list the brain trigger below reads, so the two
                    // cannot disagree about whether this model has a depth
                    // scale — a chip claiming "max" beside a brain that says
                    // nothing about a level is the contradiction this avoids.
                    triggerLevel={
                      selectedModel ? chipLevelLabel(thinkingOptions, selectedModel.thinking?.effort) : ""
                    }
                    onSelect={(model, draft) =>
                      void handleSelectModel(model, draft)
                    }
                    onSettingChange={(model, draft) =>
                      void handleSelectModel(model, draft)
                    }
                  />
                  <ThinkingTrigger
                    options={thinkingOptions}
                    recorded={selectedModel?.thinking?.effort}
                    variant={selectedModel?.variant}
                    preview={false}
                    onChange={(option) => {
                      const model = selectedModel;
                      if (!model) return;
                      // Same three shapes of commit the cascade's fly-out
                      // reports, and for the same reason: which shape applies is
                      // a fact about the model contract, not the control.
                      void handleSelectModel(model, thinkingDraftPatch(model, option));
                    }}
                  />
                  {sending ? (
                    <button
                      type="button"
                      aria-label="停止"
                      data-webui-composer-stop="true"
                      className="webui-send-button webui-send-button--stop"
                      onClick={() => void handleStop()}
                    >
                      <span className="webui-send-stop-square" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={submitBlocked}
                      aria-label="发送"
                      data-webui-composer-submit="true"
                      className="webui-send-button"
                    >
                      <WebuiIconSend />
                    </button>
                  )}
                </div>
              </div>
            </div>

        {/* The project row lives INSIDE the scrim container rather than beside
         * it. `.message-input-home-container` is the light surface that already
         * wraps the card, so sharing that box is what makes the card and the
         * band one continuous surface. As siblings they left a seam — the
         * card's rounded corners, the container's `pb-2` and a second, slightly
         * different grey all met along one line and read as two stacked boxes. */}
        {!sessionLayout ? (
          <div
            className="webui-workspace-bar"
            data-webui-workspace-toolbar="true"
          >
          <div className="relative" ref={workspacePickerRef}>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={workspaceMenuOpen}
              data-webui-workspace-picker="true"
              className="webui-workspace-bar-trigger"
              onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <WebuiIconFolder />
            </span>
            <span className="min-w-0 flex-1 truncate whitespace-nowrap leading-5">
              {createSessionWorkspaceDir
                ? workspaceProjectName(createSessionWorkspaceDir)
                : "选择文件夹"}
            </span>
            </button>
            {workspaceBrowserOpen ? (
              <div
                role="dialog"
                aria-label="选择项目目录"
                data-webui-workspace-browser-dialog="true"
                className="webui-workspace-menu webui-workspace-menu--desktop"
              >
                <WebuiWorkspaceDirectoryBrowser
                  browseWorkspaceDirs={browseWorkspaceDirs}
                  initialDir={createSessionWorkspaceDir}
                  onSelect={(dir) => {
                    setWorkspaceBrowserOpen(false);
                    onWorkspaceChange(dir);
                  }}
                  onCancel={() => setWorkspaceBrowserOpen(false)}
                />
              </div>
            ) : workspaceMenuOpen ? (
              <div
                role="listbox"
                aria-label="工作目录"
                data-webui-workspace-menu="true"
                className="webui-workspace-menu webui-workspace-menu--desktop"
              >
                {/* Desktop shape: a `最近` group of workspaces the user has
                 * actually been in, a rule, then the two commands. The group
                 * is omitted entirely when there is no history — an empty
                 * `最近` header above a divider reads as a broken panel. */}
                {recentWorkspaceDirs.length > 0 ? (
                  <>
                    <div className="webui-workspace-menu-header" aria-hidden="true">
                      最近
                    </div>
                    {recentWorkspaceDirs.map((dir) => {
                      const active = dir === createSessionWorkspaceDir;
                      return (
                        <button
                          key={dir}
                          type="button"
                          role="option"
                          aria-selected={active}
                          data-webui-workspace-recent={dir}
                          className="webui-workspace-option webui-workspace-option--desktop"
                          title={dir}
                          onClick={() => onWorkspaceChange(dir)}
                        >
                          <WebuiIconFolder className="flex-shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {workspaceProjectName(dir)}
                          </span>
                          {active ? <WebuiIconCheck className="webui-workspace-option-check" /> : null}
                        </button>
                      );
                    })}
                    <div className="webui-workspace-menu-separator" role="separator" />
                  </>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  data-webui-workspace-action="add-new"
                  className="webui-workspace-option webui-workspace-option--desktop"
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    setWorkspaceBrowserOpen(true);
                  }}
                >
                  <WebuiIconFolder className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    选择新项目
                  </span>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={createSessionWorkspaceDir === undefined}
                  data-webui-workspace-action="no-project"
                  className="webui-workspace-option webui-workspace-option--desktop"
                  onClick={() => onWorkspaceChange(undefined)}
                >
                  <WebuiIconFolder className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    不需要项目
                  </span>
                </button>
              </div>
            ) : null}
            </div>
          </div>
        ) : null}
          </div>
        </form>
        ) : null}
        </div>
          {credentialMessage ? (
          <p
            role="alert"
            data-webui-credential-warning="true"
            className="mt-2 text-text_default_secondary text-size_12"
          >
            Model credentials unavailable: {credentialMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
