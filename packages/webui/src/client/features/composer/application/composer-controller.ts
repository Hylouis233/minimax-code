import type { WebuiGoal } from "../../../../shared/contracts/goal.js";
import type { WebuiComposerController, WebuiComposerControllerSnapshot, WebuiComposerSubmitOutcome } from "../contracts/composer-controller.js";
import type { WebuiComposerStore } from "./composer-store.js";
import type { WebuiComposerSubmitIntent } from "../contracts/composer-controller.js";
import type { WebuiRunCommandRequest, WebuiCommandWorkflows } from "./command-workflows.js";
import type { WebuiConversationTurnCommands } from "../../turn/contracts/turn-commands.js";
import type { WebuiSubmissionOperation } from "../../turn/contracts/submission.js";
import { resolveWebuiSubmissionIntent } from "../projection/composer-state.js";
import { readWebuiComposerGoalModeAfterSubmit } from "../projection/composer-goal-outcome.js";
import { planWebuiRetryResend } from "./turn-retry.js";
import { formatWebuiError } from "../../../contracts/value-readers.js";
import { createWebuiComposerQueueCommands } from "./composer-queue.js";
import { shouldRecordWebuiComposerSubmission } from "../projection/composer-state.js";

export interface WebuiComposerControllerDeps {
  readonly store: WebuiComposerStore;
  readonly readSelectedSessionId: () => string | undefined;
  readonly adoptHomeSession: (sessionId: string) => void;
  readonly turnCommandsFor: (sessionId: string | undefined) => WebuiConversationTurnCommands;
  readonly commandWorkflows: WebuiCommandWorkflows;
  readonly canEnqueue: boolean;
  readonly canSend: boolean;
  readonly readGoal: (sessionId: string) => WebuiGoal | undefined;
  readonly createOrPatchGoal: (input: {
    readonly sessionId?: string;
    readonly objective: string;
    readonly createSessionWorkspaceDir?: string;
    readonly teamModeOff?: boolean;
  }, onSessionCreated: (sessionId: string) => void) => Promise<{ readonly goal: WebuiGoal; readonly sessionId: string }>;
  readonly refreshPending: (sessionId: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly refreshGoal: (sessionId: string) => Promise<void>;
  readonly recoverTurn: (sessionId: string) => void;
  readonly refreshInspection: (sessionId: string) => Promise<void>;
  readonly clearHomeTurn: () => void;
}

const HOME_KEY = "__webui_composer_home__";

/** Application coordinator for the existing composer store and owners. */
export function createWebuiComposerController(deps: WebuiComposerControllerDeps): WebuiComposerController {
  let commandRunning = false;
  let goalSubmitting = false;
  let interactionError: string | undefined;
  let commandOutput: string | undefined;
  let inspectionSessionId: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let viewGeneration = 0;
  let lastSelectedSessionId = deps.readSelectedSessionId();
  let disposed = false;
  const listeners = new Set<() => void>();
  let snapshot: WebuiComposerControllerSnapshot;

  const publish = (): void => {
    snapshot = {
      composer: deps.store.getSnapshot(),
      commandRunning,
      goalSubmitting,
      ...(interactionError === undefined ? {} : { interactionError }),
      ...(commandOutput === undefined ? {} : { commandOutput }),
      ...(inspectionSessionId === undefined ? {} : { inspectionSessionId }),
      canCompose: deps.canSend,
      canQueue: deps.canEnqueue && deps.readSelectedSessionId() !== undefined,
      canRunCommand: deps.commandWorkflows.canRunCommand,
      canRemoveQueued: deps.commandWorkflows.canRemoveQueued,
    };
    for (const listener of [...listeners]) listener();
  };
  const keyNow = (): string => deps.readSelectedSessionId() ?? HOME_KEY;
  const setDraft = (text: string): void => deps.store.setDraft(keyNow(), text);
  const queueCommands = createWebuiComposerQueueCommands({
    store: deps.store,
    workflows: deps.commandWorkflows,
    onError: (message) => { interactionError = message; publish(); },
  });
  const refreshQueue = queueCommands.refresh;
  const queueView = (sessionId: string | undefined, turn: {
    readonly message: string;
    readonly clientIntent?: string;
    readonly attachments?: WebuiComposerSubmitIntent["attachments"];
    readonly sending: boolean;
    readonly planMode?: boolean;
    readonly createSessionWorkspaceDir?: string;
    readonly teamModeOff?: boolean;
  }, clearStaging: () => void, settlement: { queued: boolean; needsSession: boolean; sessionId?: string; queueGeneration?: number }, onSessionCreated?: (sessionId: string) => void): Promise<WebuiSubmissionOperation | undefined> => deps.turnCommandsFor(sessionId).send({
    message: turn.message,
    ...(turn.clientIntent ? { clientIntent: turn.clientIntent } : {}),
    ...(turn.planMode ? { planMode: true } : {}),
    attachments: turn.attachments,
    sending: turn.sending,
    ...(turn.createSessionWorkspaceDir ? { createSessionWorkspaceDir: turn.createSessionWorkspaceDir } : {}),
    ...(turn.teamModeOff ? { teamModeOff: turn.teamModeOff } : {}),
    onAttachmentsSubmitted: clearStaging,
    callbacks: {
      onDraftChange: setDraft,
      onNeedsSession: () => { settlement.needsSession = true; },
      onSessionCreated: (createdSessionId) => {
        settlement.sessionId = createdSessionId;
        deps.adoptHomeSession(createdSessionId);
        onSessionCreated?.(createdSessionId);
        if (turn.sending) settlement.queueGeneration = queueCommands.captureDestination(createdSessionId);
      },
      onQueued: () => {
        settlement.queued = true;
        const destination = settlement.sessionId ?? sessionId;
        if (destination) refreshQueue(destination, settlement.queueGeneration);
      },
    },
  });

  snapshot = {
    composer: deps.store.getSnapshot(),
    commandRunning,
    goalSubmitting,
    canCompose: deps.canSend,
    canQueue: deps.canEnqueue && deps.readSelectedSessionId() !== undefined,
    canRunCommand: deps.commandWorkflows.canRunCommand,
    canRemoveQueued: deps.commandWorkflows.canRemoveQueued,
  };
  const detachStore = deps.store.subscribe(publish);

  const controller: WebuiComposerController = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit: async (input) => {
      if (disposed) return { kind: "ignored" };
      interactionError = undefined;
      commandOutput = undefined;
      const sessionId = deps.readSelectedSessionId();
      const intent = resolveWebuiSubmissionIntent({
        draft: input.draft,
        commandMatch: input.commandMatch,
        ...(input.commandInvocationInput === undefined ? {} : { commandInvocationInput: input.commandInvocationInput }),
        goalMode: deps.store.readModes().goal,
        planMode: input.planMode ?? deps.store.readModes().plan,
      });
      const resolved = input.forceTurn
        ? { kind: "submit-turn" as const }
        : intent ?? (input.attachments?.length ? { kind: "submit-turn" as const } : undefined);
      if (!resolved) return { kind: "ignored" };
      if (shouldRecordWebuiComposerSubmission(resolved)) {
        deps.store.recordInput(keyNow(), input.draft);
      }
      if (resolved.kind === "activate-goal-mode") {
        deps.store.setModes({ goal: true, plan: false });
        setDraft("");
        publish();
        return { kind: "mode-activated", mode: "goal" };
      }
      if (resolved.kind === "activate-plan-mode") {
        deps.store.setModes({ plan: true });
        setDraft("");
        publish();
        return { kind: "mode-activated", mode: "plan" };
      }
      if (resolved.kind === "submit-goal") {
        if (!input.goalEnabled) return { kind: "ignored" };
        goalSubmitting = true;
        publish();
        try {
          let createdSessionId: string | undefined;
          const result = await deps.createOrPatchGoal({
            sessionId,
            objective: resolved.objective,
            ...(input.createSessionWorkspaceDir ? { createSessionWorkspaceDir: input.createSessionWorkspaceDir } : {}),
            ...(input.teamModeOff ? { teamModeOff: true } : {}),
          }, (createdId) => {
            createdSessionId = createdId;
            deps.adoptHomeSession(createdId);
            input.onSessionCreated?.(createdId);
          });
          deps.store.setModes({ goal: readWebuiComposerGoalModeAfterSubmit(result.goal) });
          setDraft("");
          publish();
          return { kind: "goal-updated", sessionId: result.sessionId, ...(createdSessionId ? { createdSessionId } : {}) };
        } catch (error) {
          interactionError = formatWebuiError(error);
          publish();
          return { kind: "failed", error: interactionError };
        } finally {
          goalSubmitting = false;
          publish();
        }
      }
      if (resolved.kind === "run-command") {
        if (!deps.commandWorkflows.canRunCommand) return { kind: "ignored" };
        commandRunning = true;
        publish();
        try {
          const request: WebuiRunCommandRequest = {
            command: resolved.command.name,
            ...(resolved.input ? { input: resolved.input } : {}),
            ...(sessionId ? { sessionId } : {}),
            agentName: input.agentName,
            ...(input.createSessionWorkspaceDir ? { workspaceDir: input.createSessionWorkspaceDir } : {}),
          };
          const result = await deps.commandWorkflows.runCommand(request);
          const output = typeof result.output === "string" ? result.output : JSON.stringify(result.data ?? result, null, 2);
          commandOutput = output;
          setDraft("");
          publish();
          return { kind: "command-completed", output };
        } catch (error) {
          interactionError = formatWebuiError(error);
          publish();
          return { kind: "failed", error: interactionError };
        } finally {
          commandRunning = false;
          publish();
        }
      }

      if (resolved.clientIntent === "plan-entry") deps.store.setModes({ goal: false, plan: true });
      const message = (resolved.message ?? input.draft).trim();
      deps.store.setRetry({ session: sessionId, message });
      const settlement: { queued: boolean; needsSession: boolean; sessionId?: string; queueGeneration?: number } = { queued: false, needsSession: false };
      const clearStaging = (): void => deps.store.setStaging({ attachments: [], urlReferences: [] });
      if (input.sending && sessionId) settlement.queueGeneration = queueCommands.captureDestination(sessionId);
      if (!sessionId && input.sending && !deps.canEnqueue) return { kind: "ignored" };
      await queueView(sessionId, {
        message,
        ...(resolved.clientIntent ? { clientIntent: resolved.clientIntent } : {}),
        attachments: input.attachments,
        sending: input.sending,
        ...(input.planMode ? { planMode: true } : {}),
        ...(input.createSessionWorkspaceDir ? { createSessionWorkspaceDir: input.createSessionWorkspaceDir } : {}),
        ...(input.teamModeOff ? { teamModeOff: true } : {}),
      }, clearStaging, settlement, input.onSessionCreated);
      if (settlement.needsSession) return { kind: "needs-session", draft: input.draft };
      if (settlement.queued) return { kind: "queued", sessionId: settlement.sessionId ?? sessionId!, ...(settlement.sessionId && !sessionId ? { createdSessionId: settlement.sessionId } : {}) };
      return { kind: "submitted", ...((settlement.sessionId ?? sessionId) ? { sessionId: settlement.sessionId ?? sessionId } : {}), ...(settlement.sessionId && !sessionId ? { createdSessionId: settlement.sessionId } : {}) };
    },
    retry: async ({ refusal, sessionId, ...input }) => {
      const recordedTurn = deps.store.readRetry();
      const plan = planWebuiRetryResend({ refusal, recordedSession: recordedTurn?.session, session: sessionId, lastSubmittedText: recordedTurn?.message });
      if (plan.kind !== "resend") return;
      await controller.submit({ ...input, draft: plan.message, forceTurn: true });
    },
    removeQueued: ({ sessionId, itemId }) => queueCommands.remove({ sessionId, itemId, selectedSessionId: deps.readSelectedSessionId() }),
    selectSession: (sessionId) => {
      if (sessionId !== lastSelectedSessionId) deps.store.setModes({ goal: false });
      lastSelectedSessionId = sessionId;
      if (sessionId) refreshQueue(sessionId);
      else deps.clearHomeTurn();
      publish();
    },
    attachView: (sessionId) => {
      const generation = ++viewGeneration;
      inspectionSessionId = sessionId;
      if (timer) clearInterval(timer);
      timer = undefined;
      if (sessionId) {
        const refresh = (): void => {
          if (disposed || generation !== viewGeneration) return;
          void deps.refreshInspection(sessionId).catch((error: unknown) => {
            if (generation !== viewGeneration) return;
            interactionError = formatWebuiError(error);
            publish();
          });
        };
        refresh();
        void deps.refreshPending(sessionId).then((outcome) => {
          if (!outcome.ok) throw new Error(outcome.error ?? "加载待处理请求失败");
        }).catch((error: unknown) => {
          if (generation !== viewGeneration) return;
          interactionError = formatWebuiError(error);
          publish();
        });
        deps.refreshGoal(sessionId).catch(() => undefined);
        deps.recoverTurn(sessionId);
        timer = setInterval(refresh, 2_000);
      }
      publish();
      return () => {
        if (generation !== viewGeneration) return;
        viewGeneration += 1;
        inspectionSessionId = undefined;
        if (timer) clearInterval(timer);
        timer = undefined;
        publish();
      };
    },
    setGoalMode: (enabled) => { deps.store.setModes({ goal: enabled, ...(enabled ? { plan: false } : {}) }); },
    setPlanMode: (enabled) => { deps.store.setModes({ plan: enabled }); },
    clearError: () => { interactionError = undefined; publish(); },
    setMentionRange: deps.store.setMentionRange,
    setStagedAttachments: (update) => deps.store.setStaging((current) => ({ attachments: update(current.attachments) })),
    setAttachmentBusy: (busy) => deps.store.setStaging({ busy }),
    consumeSeed: (token) => deps.store.setStaging({ seedToken: token }),
    setUrlReferences: (update) => deps.store.setStaging((current) => ({ urlReferences: update(current.urlReferences) })),
    setDraft: (text, sessionId) => deps.store.setDraft(sessionId ?? deps.readSelectedSessionId() ?? HOME_KEY, text),
    recordInput: (text, sessionId) => deps.store.recordInput(sessionId ?? deps.readSelectedSessionId() ?? HOME_KEY, text),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      viewGeneration += 1;
      if (timer) clearInterval(timer);
      timer = undefined;
      detachStore();
      listeners.clear();
      inspectionSessionId = undefined;
    },
  };
  return controller;
}
