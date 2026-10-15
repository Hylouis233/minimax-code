// The composer toolbar's submission controls: the goal/plan mode pills and the
// send-or-stop button (T13 criterion 5 — the remainder of the toolbar unit).
//
// They are two components in one module rather than one component, because the
// toolbar places them apart: the pills sit beside the permission control, the
// button last. What they share is the vocabulary — which submission state the
// composer is in and what the control may raise — so they are defined together
// instead of being split across two files that would each restate it.
//
// Both read only the values they display and raise named intents, so the
// composer keeps the mode and submission logic.

import {
  WebuiIconCommandGoal,
  WebuiIconCommandPlan,
  WebuiIconSend,
} from "../../../shell/icons.js";

export interface WebuiComposerModePillsProps {
  /** Whether goal mode is running with a goal the coordinator can create. */
  readonly goalActive: boolean;
  readonly goalSubmitting: boolean;
  readonly planActive: boolean;
  /** A questionnaire or a pending permission blocks both pills. */
  readonly interactionBlocked: boolean;
  readonly onCancelGoal: () => void;
  readonly onCancelPlan: () => void;
}

export function WebuiComposerModePills({
  goalActive,
  goalSubmitting,
  planActive,
  interactionBlocked,
  onCancelGoal,
  onCancelPlan,
}: WebuiComposerModePillsProps) {
  return (
    <>
      {goalActive ? (
        <button
          type="button"
          className="webui-goal-mode-button is-active"
          aria-pressed={true}
          aria-label="取消目标模式"
          data-testid="composer-goal-mode"
          disabled={goalSubmitting || interactionBlocked}
          onClick={onCancelGoal}
        >
          <WebuiIconCommandGoal />
          <span>目标</span>
        </button>
      ) : null}
      {planActive ? (
        <button
          type="button"
          className="webui-goal-mode-button is-active"
          aria-pressed="true"
          aria-label="退出计划模式"
          data-testid="composer-plan-mode"
          disabled={interactionBlocked}
          onClick={onCancelPlan}
        >
          <WebuiIconCommandPlan />
          <span>计划</span>
        </button>
      ) : null}
    </>
  );
}

export interface WebuiComposerSubmitButtonProps {
  readonly sending: boolean;
  readonly submitBlocked: boolean;
  readonly onStop: () => void;
}

export function WebuiComposerSubmitButton({
  sending,
  submitBlocked,
  onStop,
}: WebuiComposerSubmitButtonProps) {
  return sending ? (
    <button
      type="button"
      aria-label="停止"
      data-webui-composer-stop="true"
      className="webui-send-button webui-send-button--stop"
      onClick={onStop}
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
  );
}
