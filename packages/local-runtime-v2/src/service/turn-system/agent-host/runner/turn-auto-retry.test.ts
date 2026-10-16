import { describe, expect, it, vi } from 'vitest';

import { LLM_ERROR_STATUS_CODES } from '@mavis/shared/llm-error-classifier';
import { RUNTIME_EVENT_SCHEMA, RuntimeEventStatus, RuntimeEventType } from '@mavis/protocol';

import {
  DEFAULT_TURN_AUTO_RETRY_POLICY,
  classifyTurnAutoRetryableFailure,
  createTurnAutoRetryCoordinator,
  resolveTurnAutoRetryPolicy,
  turnAutoRetryDelayMs,
  turnAutoRetrySleep,
} from './turn-auto-retry.js';
import type { LocalRuntimeTurnRuntimeOutcome } from '../execution/executor.js';

const SCHEMA = RUNTIME_EVENT_SCHEMA.V1;

function failedOutcome(overrides: Partial<LocalRuntimeTurnRuntimeOutcome> = {}) {
  return { status: 'failed', ...overrides } satisfies LocalRuntimeTurnRuntimeOutcome;
}

function failedEvent(message = '[Error] 529 overloaded', code?: number) {
  return {
    schema: SCHEMA,
    type: RuntimeEventType.SESSION_STATUS,
    event_id: 'evt-retry',
    seq: 1,
    ts: 1_000,
    payload: {
      status: RuntimeEventStatus.FAILED,
      ...(code === undefined
        ? {}
        : { error: { message, code, stop_reason: { type: 'error', message } } }),
      ...(code === undefined ? { error: { message } } : {}),
    },
  } as never;
}

function coordinator(overrides: {
  policy?: Partial<typeof DEFAULT_TURN_AUTO_RETRY_POLICY>;
  released?: boolean;
  aborted?: boolean;
  nowMs?: () => number;
  random?: () => number;
} = {}) {
  return createTurnAutoRetryCoordinator(overrides.policy, {
    nowMs: overrides.nowMs ?? (() => 0),
    random: overrides.random ?? (() => 1),
    hasReleasedOutput: () => overrides.released === true,
    isAborted: () => overrides.aborted === true,
  });
}

describe('classifyTurnAutoRetryableFailure', () => {
  it('retries transient provider classifications', () => {
    expect(classifyTurnAutoRetryableFailure(failedOutcome({ errorMessage: '[Error] 529 overloaded' })))
      .toEqual({ retryable: true, reason: 'overloaded' });
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({ errorMessage: '[Error] request timed out' }),
      ).retryable,
    ).toBe(true);
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({ errorMessage: '[Error] fetch failed ECONNRESET' }),
      ).retryable,
    ).toBe(true);
  });

  it('keeps quota, credits, auth and bad request terminal', () => {
    // #108: an unconditional retry loop turned one quota failure into ~80 errors.
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({
          errorMessage: 'Token Plan usage limit reached',
          errorCode: LLM_ERROR_STATUS_CODES.USAGE_LIMIT_EXCEEDED,
        }),
      ).retryable,
    ).toBe(false);
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({
          errorMessage: '[Error] 401 unauthorized',
          errorCode: LLM_ERROR_STATUS_CODES.LLM_AUTH_ERROR,
        }),
      ).retryable,
    ).toBe(false);
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({ errorMessage: 'Too many images in request: 31 > 30' }),
      ).retryable,
    ).toBe(false);
  });

  it('never retries a turn that did not fail', () => {
    expect(classifyTurnAutoRetryableFailure({ status: 'completed' }).retryable).toBe(false);
    expect(classifyTurnAutoRetryableFailure({ status: 'aborted' }).retryable).toBe(false);
  });

  it('accepts a production retryable business code with no message text', () => {
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({ errorCode: LLM_ERROR_STATUS_CODES.LLM_CLUSTER_OVERLOADED }),
      ).retryable,
    ).toBe(true);
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({ errorCode: LLM_ERROR_STATUS_CODES.USAGE_LIMIT_EXCEEDED }),
      ).retryable,
    ).toBe(false);
    expect(
      classifyTurnAutoRetryableFailure(
        failedOutcome({ errorCode: LLM_ERROR_STATUS_CODES.LLM_CREDITS_EXHAUSTED }),
      ).retryable,
    ).toBe(false);
  });
});

describe('turnAutoRetryDelayMs', () => {
  it('grows exponentially and stays bounded by maxDelayMs', () => {
    const policy = resolveTurnAutoRetryPolicy({ baseDelayMs: 1_000, maxDelayMs: 30_000 });
    const noJitter = () => 1;
    expect(turnAutoRetryDelayMs(1, policy, noJitter)).toBe(1_000);
    expect(turnAutoRetryDelayMs(2, policy, noJitter)).toBe(2_000);
    expect(turnAutoRetryDelayMs(5, policy, noJitter)).toBe(16_000);
    expect(turnAutoRetryDelayMs(6, policy, noJitter)).toBe(30_000);
    expect(turnAutoRetryDelayMs(50, policy, noJitter)).toBe(30_000);
  });

  it('applies full jitter down to half the exponential delay', () => {
    const policy = resolveTurnAutoRetryPolicy({ baseDelayMs: 1_000 });
    expect(turnAutoRetryDelayMs(1, policy, () => 0)).toBe(500);
    expect(turnAutoRetryDelayMs(1, policy, () => 1)).toBe(1_000);
  });
});

describe('createTurnAutoRetryCoordinator', () => {
  it('defaults to ten automatic retries', () => {
    expect(DEFAULT_TURN_AUTO_RETRY_POLICY.maxRetries).toBe(10);
    expect(resolveTurnAutoRetryPolicy(undefined).maxRetries).toBe(10);
    expect(resolveTurnAutoRetryPolicy({ maxRetries: 3 }).maxRetries).toBe(3);
  });

  it('holds a retryable failure and only gives up once the budget is spent', () => {
    const autoRetry = coordinator({ policy: { maxRetries: 2 } });
    const event = failedEvent();
    const failure = failedOutcome({ errorMessage: '[Error] 529 overloaded' });

    // The held terminal event stays off the client stream until the budget ends.
    expect(autoRetry.hold(event, failure)).toEqual({ held: true });
    expect(autoRetry.hasHeld()).toBe(true);
    expect(autoRetry.nextAttempt()).toMatchObject({ retry: true, retryReason: 'overloaded' });
    autoRetry.markAttemptStarted();

    expect(autoRetry.hold(event, failure)).toEqual({ held: true });
    expect(autoRetry.nextAttempt()).toMatchObject({ retry: true });
    autoRetry.markAttemptStarted();

    expect(autoRetry.hold(event, failure)).toEqual({ held: true });
    expect(autoRetry.nextAttempt()).toEqual({ retry: false, reason: 'exhausted' });
    expect(autoRetry.retries).toBe(2);
  });

  it('hands the original terminal event back once retries stop', () => {
    const autoRetry = coordinator({ policy: { maxRetries: 1 } });
    const event = failedEvent();
    const failure = failedOutcome({ errorMessage: '[Error] 529 overloaded' });

    autoRetry.hold(event, failure);
    autoRetry.nextAttempt();
    autoRetry.markAttemptStarted();

    autoRetry.hold(event, failure);
    expect(autoRetry.nextAttempt()).toEqual({ retry: false, reason: 'exhausted' });
    expect(autoRetry.release()).toBe(event);
    expect(autoRetry.hasHeld()).toBe(false);
  });

  it('keeps the held failure when an attempt was decided but never started', () => {
    // Regression: consuming the hold at decision time silently dropped the
    // terminal event whenever the backoff was cancelled, leaving the turn with
    // no terminal frame at all.
    const autoRetry = coordinator({ policy: { maxRetries: 5 } });
    const event = failedEvent();

    autoRetry.hold(event, failedOutcome({ errorMessage: '[Error] 529 overloaded' }));
    expect(autoRetry.nextAttempt()).toMatchObject({ retry: true });

    // The backoff was cancelled: no markAttemptStarted() call happens.
    expect(autoRetry.hasHeld()).toBe(true);
    expect(autoRetry.release()).toBe(event);
    expect(autoRetry.retries).toBe(0);
  });

  it('consumes the held failure so a later attempt can hold its own', () => {
    const autoRetry = coordinator();
    autoRetry.hold(failedEvent(), failedOutcome({ errorMessage: '[Error] 529 overloaded' }));
    expect(autoRetry.nextAttempt().retry).toBe(true);
    autoRetry.markAttemptStarted();
    expect(autoRetry.hasHeld()).toBe(false);
    expect(
      autoRetry.hold(failedEvent(), failedOutcome({ errorMessage: '[Error] 529 overloaded' })),
    ).toEqual({ held: true });
  });

  it('refuses to hold a failure once output has been shown to the user', () => {
    const autoRetry = coordinator({ released: true });
    expect(
      autoRetry.hold(failedEvent(), failedOutcome({ errorMessage: '[Error] 529 overloaded' })),
    ).toEqual({ held: false, reason: 'output_already_released' });
    expect(autoRetry.hasHeld()).toBe(false);
  });

  it('refuses to hold a non-retryable or aborted failure', () => {
    expect(
      coordinator().hold(failedEvent('Token Plan usage limit reached'), failedOutcome({ errorMessage: 'Token Plan usage limit reached' })),
    ).toEqual({ held: false, reason: 'not_retryable' });
    expect(
      coordinator({ aborted: true }).hold(
        failedEvent(),
        failedOutcome({ errorMessage: '[Error] 529 overloaded' }),
      ),
    ).toEqual({ held: false, reason: 'aborted' });
  });

  it('is disabled by a zero budget', () => {
    const autoRetry = coordinator({ policy: { maxRetries: 0 } });
    expect(
      autoRetry.hold(failedEvent(), failedOutcome({ errorMessage: '[Error] 529 overloaded' })),
    ).toEqual({ held: false, reason: 'disabled' });
  });

  it('stops when the elapsed-time budget would be exceeded', () => {
    let now = 0;
    const autoRetry = coordinator({
      // random() === 1 gives the un-jittered exponential: 1s, 2s, 4s.
      policy: { maxRetries: 10, baseDelayMs: 1_000, maxDelayMs: 30_000, maxElapsedMs: 3_500 },
      nowMs: () => now,
      random: () => 1,
    });
    const failure = failedOutcome({ errorMessage: '[Error] 529 overloaded' });

    autoRetry.hold(failedEvent(), failure);
    expect(autoRetry.nextAttempt()).toMatchObject({ retry: true, delayMs: 1_000 });
    autoRetry.markAttemptStarted();

    now = 1_000;
    autoRetry.hold(failedEvent(), failure);
    expect(autoRetry.nextAttempt()).toMatchObject({ retry: true, delayMs: 2_000 });
    autoRetry.markAttemptStarted();

    // 3_000 + 4_000 would exceed the 3_500 ms budget.
    now = 3_000;
    autoRetry.hold(failedEvent(), failure);
    expect(autoRetry.nextAttempt()).toEqual({
      retry: false,
      reason: 'elapsed_budget_exceeded',
    });
  });
});

describe('turnAutoRetrySleep', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(turnAutoRetrySleep(1_000, controller.signal)).rejects.toBeInstanceOf(Error);
  });

  it('rejects an in-flight sleep when the signal aborts', async () => {
    const controller = new AbortController();
    const pending = turnAutoRetrySleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(Error);
  });

  it('resolves without waiting for a non-positive delay', async () => {
    const sleep = vi.fn();
    await expect(turnAutoRetrySleep(0, undefined)).resolves.toBeUndefined();
    expect(sleep).not.toHaveBeenCalled();
  });
});
