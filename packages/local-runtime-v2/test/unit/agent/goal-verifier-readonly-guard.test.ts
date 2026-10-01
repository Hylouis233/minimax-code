import { expect, it } from 'vitest';

import { GoalVerifierChildCoordinator } from '../../../src/application/agent/goal-subagent-coordinator.js';

const HOST_PROVIDER = 'worker-provider';

function register(coordinator: GoalVerifierChildCoordinator, runId = 'run-1'): void {
  coordinator.register({
    runId,
    workerRouteProvider: HOST_PROVIDER,
    hostContext: { settlement: {} } as never,
  });
}

/** Minimal `before_tool_call` context: the guard only reads the tool name. */
function toolCall(name: string): never {
  return { toolCall: { name } } as never;
}

it('lets the child recover from a denied tool instead of aborting the run', () => {
  const coordinator = new GoalVerifierChildCoordinator();
  register(coordinator);

  const blocked = coordinator.beforeTool('run-1', toolCall('web_fetch'));

  // The call is still refused, but the reason now tells the model how to get
  // the same evidence locally instead of naming a fatal violation.
  expect(blocked?.block).toBe(true);
  expect(blocked?.reason).not.toContain('GOAL_VERIFIER_CAPABILITY_VIOLATION');
  expect(blocked?.reason).toContain('web_fetch');

  // The decisive regression: the next turn must not be aborted. Before the fix
  // this latched a capability_violation and `beforeLlm` stopped the run here,
  // which surfaced to the user as `paused(verifier_capability)`.
  expect(coordinator.beforeLlm('run-1', HOST_PROVIDER)).toBeUndefined();
  expect(coordinator.release('run-1')?.issue).toBeUndefined();
});

it('recovers a bounded number of denied calls before latching a violation', () => {
  const coordinator = new GoalVerifierChildCoordinator();
  register(coordinator);

  coordinator.beforeTool('run-1', toolCall('web_fetch'));
  coordinator.beforeTool('run-1', toolCall('web_search'));
  expect(coordinator.beforeLlm('run-1', HOST_PROVIDER)).toBeUndefined();

  // A third attempt is no longer a detour: the child was told no twice and
  // reached for a denied tool again.
  const latched = coordinator.beforeTool('run-1', toolCall('web_fetch'));
  expect(latched?.reason).toContain('GOAL_VERIFIER_CAPABILITY_VIOLATION');

  const outcome = coordinator.release('run-1');
  expect(outcome?.issue?.code).toBe('capability_violation');
});

it('keeps aborting the next turn once a violation is latched', () => {
  const coordinator = new GoalVerifierChildCoordinator();
  register(coordinator);

  for (let i = 0; i < 3; i += 1) coordinator.beforeTool('run-1', toolCall('web_fetch'));

  expect(coordinator.beforeLlm('run-1', HOST_PROVIDER)).toEqual({
    type: 'abort',
    reason: expect.stringContaining('GOAL_VERIFIER_CAPABILITY_VIOLATION'),
  });
});

it('still blocks denied tools for an unknown run', () => {
  const coordinator = new GoalVerifierChildCoordinator();

  const blocked = coordinator.beforeTool('missing-run', toolCall('web_fetch'));

  expect(blocked?.block).toBe(true);
  expect(blocked?.reason).toContain('no longer active');
});

it('leaves allowed tools untouched and never counts them', () => {
  const coordinator = new GoalVerifierChildCoordinator();
  register(coordinator);

  for (let i = 0; i < 5; i += 1) {
    expect(coordinator.beforeTool('run-1', toolCall('read'))).toBeUndefined();
    expect(coordinator.beforeTool('run-1', toolCall('grep'))).toBeUndefined();
    expect(coordinator.beforeTool('run-1', toolCall('bash'))).toBeUndefined();
  }

  expect(coordinator.beforeLlm('run-1', HOST_PROVIDER)).toBeUndefined();
  expect(coordinator.release('run-1')?.issue).toBeUndefined();
});

it('still aborts a route mismatch without a recovery window', () => {
  const coordinator = new GoalVerifierChildCoordinator();
  register(coordinator);

  expect(coordinator.beforeLlm('run-1', 'some-other-provider')).toEqual({
    type: 'abort',
    reason: expect.stringContaining('settled worker data route'),
  });
  expect(coordinator.release('run-1')?.issue?.code).toBe('route_unavailable');
});
