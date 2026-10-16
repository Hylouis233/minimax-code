import type { WebuiGoal } from "../../../../shared/contracts/goal.js";
import type { WebuiComposerController, WebuiComposerControllerSnapshot, WebuiComposerSubmitOutcome } from "../contracts/composer-controller.js";
import type { WebuiComposerStore } from "./composer-store.js";
import type { WebuiComposerSubmitIntent } from "../contracts/composer-controller.js";
import type { WebuiRunCommandRequest, WebuiCommandWorkflows } from "./command-workflows.js";
import type { WebuiConversationTurnCommands } from "../../turn/contracts/turn-commands.js";
import type { WebuiSubmissionCompletion, WebuiSubmissionTicket } from "../../turn/contracts/submission.js";
import { resolveWebuiSubmissionIntent } from "../projection/composer-state.js";
import { readWebuiComposerGoalModeAfterSubmit } from "../projection/composer-goal-outcome.js";
import { planWebuiRetryResend } from "./turn-retry.js";
import { formatWebuiError } from "../../../contracts/value-readers.js";
import { createWebuiComposerQueueCommands } from "./composer-queue.js";
import { shouldRecordWebuiComposerSubmission } from "../projection/composer-state.js";

export interface WebuiComposerControllerDeps {
  readonly store: WebuiComposerStore;
  readonly readSelectedSessionId: () => string | undefined;
  /**
   * Select the session a *send* created. The send's transfer and composer adoption are the task use
   * case's, so all that is left for the caller is the selection — and only when the use case says
   * the navigation claim that started the creation is still current.
   */
  readonly selectCreatedSession: (sessionId: string) => void;
  readonly turnCommandsFor: (sessionId: string | undefined) => WebuiConversationTurnCommands;
  readonly commandWorkflows: WebuiCommandWorkflows;
  readonly canEnqueue: boolean;
  readonly canSend: boolean;
  readonly readGoal: (sessionId: string) => WebuiGoal | undefined;
  /**
   * The goal submission command, which Goal owns: whether the objective is
   * created or patched — and on which owner — is decided there. The objective is
   * created as the home slot's session when there is no session.
   */
  readonly submitGoal: (input: {
    readonly sessionId?: string;
    readonly objective: string;
    readonly createSessionWorkspaceDir?: string;
    readonly teamModeOff?: boolean;
  }, onSessionCreated: (sessionId: string, selected: boolean) => void) => Promise<{ readonly goal: WebuiGoal; readonly sessionId: string }>;
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
    readonly planMode?: boolean;
    readonly createSessionWorkspaceDir?: string;
    readonly teamModeOff?: boolean;
  }, clearStaging: () => void): Promise<WebuiSubmissionCompletion | undefined> => {
    // Intent and data only. No setter crosses this boundary: the draft is
    // consumed through the link the assembly installed on the command set, and
    // the session, the queue and the selection all come back on the completion.
    const ticket: WebuiSubmissionTicket | undefined = deps.turnCommandsFor(sessionId).send({
      message: turn.message,
      ...(turn.clientIntent ? { clientIntent: turn.clientIntent } : {}),
      ...(turn.planMode ? { planMode: true } : {}),
      attachments: turn.attachments,
      ...(turn.createSessionWorkspaceDir
        ? { createSessionWorkspaceDir: turn.createSessionWorkspaceDir }
        : {}),
      ...(turn.teamModeOff ? { teamModeOff: turn.teamModeOff } : {}),
      onAttachmentsSubmitted: clearStaging,
    });
    return ticket === undefined ? Promise.resolve(undefined) : ticket.completion;
  }

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
          const result = await deps.submitGoal({
            sessionId,
            objective: resolved.objective,
            ...(input.createSessionWorkspaceDir ? { createSessionWorkspaceDir: input.createSessionWorkspaceDir } : {}),
            ...(input.teamModeOff ? { teamModeOff: true } : {}),
          }, (createdId, selected) => {
            createdSessionId = createdId;
            // The transfer and the composer's slot move are the use case's; the caller is left with
            // the selection, gated on the use case's own answer.
            if (selected) deps.selectCreatedSession(createdId);
            input.onSessionCreated?.(createdId, selected);
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
      const clearStaging = (): void => deps.store.setStaging({ attachments: [], urlReferences: [] });
      // Captured *before* the submission, not just before the refresh. A user who
      // switches sessions while an enqueue is in flight must not have the mirror
      // reclaimed by the reply: the refresh is only allowed to apply if the
      // destination it was issued for is still the one it was captured against.
      const queueGeneration = sessionId ? queueCommands.captureDestination(sessionId) : undefined;
      // Everything the submission used to report back through callbacks is on its
      // completion now: the session it created, whether it may be selected, and
      // whether it queued. Nothing here has to be in flight for the caller to
      // learn any of it.
      const operation = await queueView(sessionId, {
        message,
        ...(resolved.clientIntent ? { clientIntent: resolved.clientIntent } : {}),
        attachments: input.attachments,
        ...(input.planMode ? { planMode: true } : {}),
        ...(input.createSessionWorkspaceDir ? { createSessionWorkspaceDir: input.createSessionWorkspaceDir } : {}),
        ...(input.teamModeOff ? { teamModeOff: true } : {}),
      }, clearStaging);
      if (operation?.kind === "needs-session") return { kind: "needs-session", draft: input.draft };
      // A created session is named by the completion, and whether the view should
      // follow the user there is the use case's verdict, not something to guess.
      const created =
        operation !== undefined &&
        (operation.kind === "dispatched" || operation.kind === "queued") &&
        operation.created === true
          ? operation
          : undefined;
      if (created?.selected === true) deps.selectCreatedSession(created.sessionId);
      const settledSessionId = created?.sessionId ?? sessionId;
      if (operation?.kind === "queued") {
        if (settledSessionId) {
          // A session this submission created had no pre-submit capture to hold
          // against; capturing now is the earliest the caller can see it.
          const generation = created
            ? queueCommands.captureDestination(settledSessionId)
            : queueGeneration;
          refreshQueue(settledSessionId, generation);
        }
        return {
          kind: "queued",
          sessionId: settledSessionId ?? sessionId!,
          ...(created && !sessionId ? { createdSessionId: created.sessionId } : {}),
        };
      }
      return {
        kind: "submitted",
        ...(settledSessionId ? { sessionId: settledSessionId } : {}),
        ...(created && !sessionId ? { createdSessionId: created.sessionId } : {}),
      };
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
