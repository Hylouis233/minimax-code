import {
  LLM_ERROR_STATUS_CODES,
  normalizeLLMError,
  toLLMRetryDecision,
  type LLMRetryReason,
} from '@mavis/shared/llm-error-classifier';
import type { IRuntimeEvent } from '@mavis/protocol';

import type { LocalRuntimeTurnRuntimeOutcome } from '../execution/executor.js';

/**
 * Turn-level automatic retry for transient turn failures.
 *
 * The framework already retries a single provider request (`withLLMRetry` in
 * `@mavis/agent-core/pi-turn-runner`), but that budget is spent *inside* one
 * logical LLM call and is deliberately abandoned once output commits. Nothing
 * re-runs a whole turn, so a turn that ends on a transient classification
 * (overload, rate limit, dropped connection) terminates and waits for a manual
 * user retry. This module owns the turn-level budget.
 *
 * The retryable classification is deliberately not re-derived here: the shared
 * error classifier already encodes which conditions a resend can fix, and quota
 * exhaustion must stay terminal (see #108, where an unconditional retry loop
 * produced ~80 usage-limit errors).
 */
export interface TurnAutoRetryPolicy {
  /** Automatic re-runs allowed after the first failed attempt. */
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Total wall-clock budget for the whole retry sequence of one turn. */
  readonly maxElapsedMs: number;
}

export const DEFAULT_TURN_AUTO_RETRY_POLICY: Readonly<TurnAutoRetryPolicy> = {
  maxRetries: 10,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxElapsedMs: 600_000,
};

/** Why the coordinator refused to hold a failure, or why it stopped retrying. */
export type TurnAutoRetryStopReason =
  | 'disabled'
  | 'exhausted'
  | 'elapsed_budget_exceeded'
  | 'output_already_released'
  | 'not_retryable'
  | 'aborted';

export type TurnAutoRetryDecision =
  | { readonly retry: false; readonly reason: TurnAutoRetryStopReason }
  | { readonly retry: true; readonly retryReason: LLMRetryReason; readonly delayMs: number };

export type TurnAutoRetryHoldResult =
  | { readonly held: true }
  | { readonly held: false; readonly reason: TurnAutoRetryStopReason };

export interface TurnAutoRetryClassification {
  readonly retryable: boolean;
  readonly reason?: LLMRetryReason;
}

/**
 * MiniMax business codes that name a specific transient condition and can
 * therefore be trusted even when the message text does not classify.
 *
 * `LLM_UPSTREAM_ERROR` (50113) is deliberately absent. It is the generic
 * 4xx/5xx fallback bucket — `mapUpstreamHttpError` assigns it to any status of
 * 400 or above except 402/401/403/429/529 — so treating it as retryable would
 * resend requests the provider has already rejected as malformed, and would
 * turn an HTTP 400 or 404 into ten identical attempts. The shared classifier
 * fails closed on that code for the same reason, and this list must not reopen
 * it.
 */
const TRANSIENT_PROTOCOL_CODES = new Map<number, LLMRetryReason>([
  [LLM_ERROR_STATUS_CODES.LLM_RATE_LIMITED, 'rate_limited'],
  [LLM_ERROR_STATUS_CODES.LLM_TPM_RATE_LIMITED, 'tpm_rate_limited'],
  [LLM_ERROR_STATUS_CODES.LLM_CLUSTER_OVERLOADED, 'overloaded'],
]);

/**
 * Classify a failed turn outcome.
 *
 * The shared classifier is the only authority on what a resend can fix. The
 * narrow protocol-code table above only adds cases where the transport had no
 * status to classify from; it never widens a refusal the classifier made.
 */
export function classifyTurnAutoRetryableFailure(
  outcome: LocalRuntimeTurnRuntimeOutcome,
): TurnAutoRetryClassification {
  if (outcome.status !== 'failed') return { retryable: false };
  const decision = toLLMRetryDecision(
    normalizeLLMError(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
  );
  if (decision.retryable) return { retryable: true, reason: decision.reason };
  // Only consulted after the classifier refused, and only for codes that name a
  // specific transient condition. Usage limit (42212), credits (50110) and auth
  // (50112) are not members.
  const byCode = outcome.errorCode === undefined ? undefined : TRANSIENT_PROTOCOL_CODES.get(outcome.errorCode);
  return byCode ? { retryable: true, reason: byCode } : { retryable: false };
}

export function resolveTurnAutoRetryPolicy(
  policy: Partial<TurnAutoRetryPolicy> | undefined,
): TurnAutoRetryPolicy {
  return { ...DEFAULT_TURN_AUTO_RETRY_POLICY, ...(policy ?? {}) };
}

/** Full-jitter bounded exponential backoff, matching the transport retry shape. */
export function turnAutoRetryDelayMs(
  retryAttempt: number,
  policy: TurnAutoRetryPolicy,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (retryAttempt - 1));
  return Math.floor(exponential / 2 + (clampRandom(random()) * exponential) / 2);
}

function clampRandom(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export interface TurnAutoRetryCoordinator {
  readonly policy: TurnAutoRetryPolicy;
  /** Automatic retries actually started for this turn. */
  readonly retries: number;
  /** Hold a retryable terminal failure instead of surfacing it to the client. */
  hold(event: IRuntimeEvent, outcome: LocalRuntimeTurnRuntimeOutcome): TurnAutoRetryHoldResult;
  /**
   * Decide whether the held failure gets another attempt, or why it stops. This
   * is a pure query: it never consumes the hold, so a cancelled backoff still
   * leaves the original terminal event available for {@link release}.
   */
  nextAttempt(): TurnAutoRetryDecision;
  /**
   * Called only once an attempt has actually started. Consumes the hold and
   * spends one retry from the budget.
   */
  markAttemptStarted(): void;
  /** Hand back the held terminal event so the client receives the original error. */
  release(): IRuntimeEvent | undefined;
  /** Whether a failure is currently being held back. */
  hasHeld(): boolean;
}

export interface TurnAutoRetryCoordinatorDeps {
  readonly nowMs?: () => number;
  readonly random?: () => number;
  /** True once this attempt released user-visible output that a retry would duplicate. */
  readonly hasReleasedOutput: () => boolean;
  readonly isAborted: () => boolean;
}

/**
 * Per-turn coordinator shared by the terminal-event gate and the attempt loop.
 *
 * The gate asks whether a retryable terminal failure may be held back; the loop
 * asks for the next delay; whoever stops releases the held event so the user
 * still sees the original terminal error.
 */
export function createTurnAutoRetryCoordinator(
  policy: Partial<TurnAutoRetryPolicy> | undefined,
  deps: TurnAutoRetryCoordinatorDeps,
): TurnAutoRetryCoordinator {
  const resolved = resolveTurnAutoRetryPolicy(policy);
  const nowMs = deps.nowMs ?? Date.now;
  const random = deps.random ?? Math.random;
  let heldEvent: IRuntimeEvent | undefined;
  let heldOutcome: LocalRuntimeTurnRuntimeOutcome | undefined;
  let retries = 0;
  let startedAtMs: number | undefined;

  const stop = (reason: TurnAutoRetryStopReason): TurnAutoRetryHoldResult => ({
    held: false,
    reason,
  });

  return {
    policy: resolved,
    get retries() {
      return retries;
    },
    hasHeld: () => heldEvent !== undefined,
    hold(event, outcome) {
      if (heldEvent !== undefined) return stop('disabled');
      if (resolved.maxRetries <= 0) return stop('disabled');
      if (deps.isAborted()) return stop('aborted');
      // Re-running a turn after its output was shown would duplicate visible
      // content, so those failures keep today's terminal behaviour.
      if (deps.hasReleasedOutput()) return stop('output_already_released');
      if (!classifyTurnAutoRetryableFailure(outcome).retryable) return stop('not_retryable');
      heldEvent = event;
      heldOutcome = outcome;
      startedAtMs ??= nowMs();
      return { held: true };
    },
    nextAttempt() {
      if (heldEvent === undefined || heldOutcome === undefined) {
        return { retry: false, reason: 'not_retryable' };
      }
      if (deps.isAborted()) return { retry: false, reason: 'aborted' };
      if (deps.hasReleasedOutput()) return { retry: false, reason: 'output_already_released' };
      const classified = classifyTurnAutoRetryableFailure(heldOutcome);
      if (!classified.retryable) return { retry: false, reason: 'not_retryable' };
      if (retries >= resolved.maxRetries) return { retry: false, reason: 'exhausted' };
      const delayMs = turnAutoRetryDelayMs(retries + 1, resolved, random);
      if (nowMs() + delayMs - (startedAtMs ?? nowMs()) > resolved.maxElapsedMs) {
        return { retry: false, reason: 'elapsed_budget_exceeded' };
      }
      return { retry: true, retryReason: classified.reason ?? 'network', delayMs };
    },
    markAttemptStarted() {
      retries += 1;
      // The held failure is only discarded now that another attempt is really
      // running; a cancelled backoff leaves it to be released.
      heldEvent = undefined;
      heldOutcome = undefined;
    },
    release() {
      const held = heldEvent;
      heldEvent = undefined;
      heldOutcome = undefined;
      return held;
    },
  };
}

/** Abortable backoff sleep used between automatic turn retries. */
export function turnAutoRetrySleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal) reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Turn auto-retry cancelled');
}
