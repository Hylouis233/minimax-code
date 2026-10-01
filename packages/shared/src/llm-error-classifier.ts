/**
 * Shared LLM error classifier — single source of truth for both daemon
 * (`runtime=llm-client`, `runtime=Vercel` finishStep) and the legacy local runtime
 * plugin (`finish-step` / `error` events).
 *
 * Why shared instead of two parallel copies:
 *   • The metric label `error_reason` on `llm_call_total` and
 *     `tool_call_total` consumes a fixed bounded enum. If daemon and
 *     plugin classify the same error differently, we get two different
 *     time series for the same incident — Grafana dashboards break.
 *   • The plugin only sees the post-SDK normalised shape (a plain
 *     `{ statusCode, errorMessage, finishReason }` triple) while the daemon
 *     sees the raw thrown value (often `APICallError` or a `DOMException`).
 *     Both inputs collapse into the same enum here.
 *
 * Adding a new bucket: append to `LLM_ERROR_REASONS`, update the matching
 * branch in `classifyLLMError`, and bump the
 * `metrics-runtime.test.ts > schema enum sync` snapshot if needed.
 */

export const LLM_ERROR_REASONS = [
  'abort',
  'timeout',
  'rate_limited',
  'tpm_rate_limited',
  'usage_limit',
  'credits_exhausted',
  'auth',
  'bad_request',
  'not_found',
  'content_filter',
  'server_error',
  'overloaded',
  'network',
  'empty_response',
  'unknown',
  'length',
] as const;
export type LLMErrorReason = (typeof LLM_ERROR_REASONS)[number];
export type LLMMetricErrorKind = LLMErrorReason;

export const LLM_RETRY_REASONS = [
  'timeout',
  'network',
  'rate_limited',
  'tpm_rate_limited',
  'overloaded',
] as const;
export type LLMRetryReason = (typeof LLM_RETRY_REASONS)[number];

export type LLMRetryDecision =
  { retryable: true; reason: LLMRetryReason } | { retryable: false; reason: LLMMetricErrorKind };

export type LLMErrorSignal =
  | 'usage_limit'
  | 'credits_exhausted'
  | 'tpm_rate_limit'
  | 'content_filter'
  | 'network'
  | 'empty_response'
  | 'length';

export interface LLMErrorFacts {
  explicitAbort: boolean;
  timeout: boolean;
  httpStatus?: number;
  upstreamStatusCode?: number;
  providerMessageCode?: number;
  existingProtocolCode?: number;
  signals: ReadonlySet<LLMErrorSignal>;
}

export interface LLMErrorInput {
  raw?: unknown;
  finishReason?: string;
  errorMessage?: string;
  statusCode?: number;
  explicitAbort?: boolean;
}

export interface NormalizedLLMError {
  facts: LLMErrorFacts;
  sanitizedMessage?: string;
}

export interface LLMProtocolClassification {
  code: number;
  message?: string;
}

const EMPTY_FACTS = (): LLMErrorFacts => ({
  explicitAbort: false,
  timeout: false,
  signals: new Set<LLMErrorSignal>(),
});
const SAFE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNABORTED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_NETWORK_IO_SUSPENDED',
  'ERR_NETWORK_CHANGED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_TIMED_OUT',
  'ERR_CONNECTION_TIMED_OUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const CONNECTION_ERROR_MESSAGE_RE = /Connection error\.?/i;
const ABORT_MESSAGE_RE = /\babort(?:ed|ing)?\b/i;
const TRANSIENT_TIMEOUT_MESSAGE_RE =
  /\b(?:timed?\s*out|timeout|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNABORTED|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)\b/i;
const TRANSIENT_NETWORK_MESSAGE_RE =
  /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|network)\b/i;
const SAFE_TRANSPORT_NETWORK_MESSAGE_RE = /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed)\b/i;
const CHROMIUM_NETWORK_MESSAGE_RE =
  /\bnet::ERR_(?:CONNECTION_(?:RESET|CLOSED|REFUSED)|NETWORK_IO_SUSPENDED|NETWORK_CHANGED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED|HTTP2_PROTOCOL_ERROR)\b/i;
const CHROMIUM_TIMEOUT_MESSAGE_RE = /\bnet::ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT)\b/i;
const LLM_USAGE_LIMIT_UPSTREAM_STATUS_CODES = [2056, 2067] as const;
const LLM_USAGE_LIMIT_UPSTREAM_STATUS_CODE_SET = new Set<number>(
  LLM_USAGE_LIMIT_UPSTREAM_STATUS_CODES,
);
const LLM_USAGE_LIMIT_UPSTREAM_STATUS_CODE_RE = /\b(?:2056|2067)\b/u;

function isLLMUsageLimitUpstreamStatusCode(statusCode: number | undefined): boolean {
  return statusCode !== undefined && LLM_USAGE_LIMIT_UPSTREAM_STATUS_CODE_SET.has(statusCode);
}

/** Best-effort, bounded and no-throw extraction of stable LLM error facts. */
export function normalizeLLMError(input: LLMErrorInput): NormalizedLLMError {
  try {
    const facts = EMPTY_FACTS();
    const signals = facts.signals as Set<LLMErrorSignal>;
    facts.explicitAbort = input.explicitAbort === true || input.finishReason === 'aborted';
    if (input.finishReason === 'length') signals.add('length');
    if (input.finishReason === 'content-filter' || input.finishReason === 'content_filter') {
      signals.add('content_filter');
    }

    const extracted = safeExtract(
      typeof input.raw === 'string' ? { message: input.raw } : input.raw,
    );
    facts.httpStatus ??= validHttpStatus(input.statusCode) ?? extracted.httpStatus;
    facts.upstreamStatusCode ??= extracted.upstreamStatusCode;
    facts.providerMessageCode ??= extracted.providerMessageCode;
    facts.existingProtocolCode ??= extracted.existingProtocolCode;
    facts.explicitAbort ||= extracted.explicitAbort === true;
    facts.timeout ||= extracted.timeout === true;
    if (extracted.network) signals.add('network');
    const visibleMessage = extracted.message ?? input.errorMessage;
    const legacy = extractLegacyMessageFacts(visibleMessage);
    facts.httpStatus ??= legacy.httpStatus;
    facts.upstreamStatusCode = preferBusinessStatus(
      facts.upstreamStatusCode,
      legacy.upstreamStatusCode,
    );
    facts.providerMessageCode ??= legacy.providerMessageCode;
    // A message-only wrapper must not replace a structured provider signal with
    // its generic HTTP projection. Explicit wire errorCode still takes precedence.
    if (facts.upstreamStatusCode === undefined && facts.providerMessageCode === undefined) {
      facts.existingProtocolCode ??= legacy.existingProtocolCode;
    }
    const message = legacy.message ?? visibleMessage;
    applyMessageSignals(message, facts, signals);
    applyNumericSignals(facts, signals);
    return { facts, ...(message ? { sanitizedMessage: message } : {}) };
  } catch {
    return {
      facts: EMPTY_FACTS(),
      ...(typeof input.errorMessage === 'string' ? { sanitizedMessage: input.errorMessage } : {}),
    };
  }
}

export function toLLMMetricErrorKind(facts: LLMErrorFacts): LLMMetricErrorKind {
  try {
    if (facts.explicitAbort) return 'abort';
    if (facts.signals.has('credits_exhausted')) return 'credits_exhausted';
    if (facts.signals.has('usage_limit')) return 'usage_limit';
    if (facts.signals.has('content_filter')) return 'content_filter';
    if (facts.signals.has('tpm_rate_limit')) return 'tpm_rate_limited';
    const upstreamCode = mappedUpstreamCode(facts);
    if (upstreamCode === LLM_ERROR_CODES.LLM_AUTH_ERROR) return 'auth';
    if (upstreamCode === LLM_ERROR_CODES.LLM_RATE_LIMITED) return 'rate_limited';
    if (upstreamCode === LLM_ERROR_CODES.LLM_UPSTREAM_ERROR) return 'server_error';
    if (facts.existingProtocolCode === LLM_ERROR_CODES.SAFETY_SENSITIVE) return 'content_filter';
    if (facts.timeout && effectiveHttpStatus(facts) === 529) return 'overloaded';
    if (facts.timeout) return 'timeout';
    if (facts.signals.has('empty_response')) return 'empty_response';
    if (facts.signals.has('length')) return 'length';
    switch (facts.existingProtocolCode) {
      case LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED:
        return 'usage_limit';
      case LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED:
        return 'credits_exhausted';
      case LLM_ERROR_CODES.LLM_TPM_RATE_LIMITED:
        return 'tpm_rate_limited';
      case LLM_ERROR_CODES.LLM_RATE_LIMITED:
        return 'rate_limited';
      case LLM_ERROR_CODES.LLM_AUTH_ERROR:
        return 'auth';
      case LLM_ERROR_CODES.LLM_CLUSTER_OVERLOADED:
        return 'overloaded';
    }
    const status = effectiveHttpStatus(facts);
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'not_found';
    if (status !== undefined && status >= 400 && status < 500) return 'bad_request';
    if (status === 529) return 'overloaded';
    if (facts.signals.has('network')) return 'network';
    if (status !== undefined && status >= 500) return 'server_error';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Strict transport-retry policy shared by all hosts that opt into framework retry.
 *
 * Product quota, credits, auth and explicit cancellation always win over an outer
 * transient-looking HTTP status. Only the bounded allowlist below is retryable;
 * generic 5xx and unknown failures deliberately fail closed.
 */
export function toLLMRetryDecision(normalized: NormalizedLLMError): LLMRetryDecision {
  const { facts } = normalized;
  const metricKind = toLLMMetricErrorKind(facts);

  if (
    facts.explicitAbort ||
    facts.signals.has('usage_limit') ||
    facts.signals.has('credits_exhausted') ||
    facts.signals.has('content_filter') ||
    metricKind === 'abort' ||
    metricKind === 'usage_limit' ||
    metricKind === 'credits_exhausted' ||
    metricKind === 'auth' ||
    metricKind === 'content_filter'
  ) {
    return { retryable: false, reason: metricKind };
  }
  const status = effectiveHttpStatus(facts);
  if (
    facts.existingProtocolCode === LLM_ERROR_CODES.LLM_AUTH_ERROR ||
    status === 401 ||
    status === 403
  ) {
    return { retryable: false, reason: 'auth' };
  }
  const upstreamCode = mappedUpstreamCode(facts);
  if (upstreamCode === LLM_ERROR_CODES.LLM_UPSTREAM_ERROR) {
    return { retryable: false, reason: metricKind };
  }
  if (upstreamCode === LLM_ERROR_CODES.LLM_RATE_LIMITED) {
    return { retryable: true, reason: 'rate_limited' };
  }
  if (facts.timeout) return { retryable: true, reason: 'timeout' };
  if (facts.signals.has('network')) return { retryable: true, reason: 'network' };

  switch (facts.existingProtocolCode) {
    case LLM_ERROR_CODES.LLM_RATE_LIMITED:
      return { retryable: true, reason: 'rate_limited' };
    case LLM_ERROR_CODES.LLM_TPM_RATE_LIMITED:
      return { retryable: true, reason: 'tpm_rate_limited' };
    case LLM_ERROR_CODES.LLM_CLUSTER_OVERLOADED:
      return { retryable: true, reason: 'overloaded' };
  }

  if (status === 429) {
    return {
      retryable: true,
      reason: facts.signals.has('tpm_rate_limit') ? 'tpm_rate_limited' : 'rate_limited',
    };
  }
  if (status === 529) return { retryable: true, reason: 'overloaded' };
  return { retryable: false, reason: metricKind };
}

export function toLLMProtocolClassification(
  normalized: NormalizedLLMError,
): LLMProtocolClassification | null {
  try {
    const { facts, sanitizedMessage } = normalized;
    const httpStatus = effectiveHttpStatus(facts);
    let code: number | undefined;
    if (
      facts.existingProtocolCode &&
      Object.values(LLM_ERROR_CODES).includes(facts.existingProtocolCode as LLMErrorStatusCode)
    ) {
      code = facts.existingProtocolCode;
    } else if (facts.signals.has('content_filter')) {
      code = LLM_ERROR_CODES.SAFETY_SENSITIVE;
    } else if (facts.signals.has('credits_exhausted')) {
      code = LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED;
    } else if (isLLMUsageLimitUpstreamStatusCode(facts.upstreamStatusCode)) {
      code = LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED;
    } else if (mappedUpstreamCode(facts) !== undefined) {
      code = mappedUpstreamCode(facts);
    } else if (httpStatus === 429 && facts.signals.has('tpm_rate_limit')) {
      code = LLM_ERROR_CODES.LLM_TPM_RATE_LIMITED;
    } else if (httpStatus === 529) {
      code = LLM_ERROR_CODES.LLM_CLUSTER_OVERLOADED;
    } else if (httpStatus !== undefined) {
      code = mapUpstreamHttpError(httpStatus);
    } else if (facts.timeout) {
      code = LLM_ERROR_CODES.LLM_UPSTREAM_ERROR;
    }
    return code === undefined
      ? null
      : { code, ...(sanitizedMessage ? { message: sanitizedMessage } : {}) };
  } catch {
    return null;
  }
}

interface SafeExtracted {
  httpStatus?: number;
  upstreamStatusCode?: number;
  providerMessageCode?: number;
  existingProtocolCode?: number;
  explicitAbort?: boolean;
  timeout?: boolean;
  network?: boolean;
  message?: string;
}

function safeExtract(raw: unknown): SafeExtracted {
  try {
    return extractSafeObject(raw);
  } catch {
    return {};
  }
}

function extractSafeObject(raw: unknown): SafeExtracted {
  const out: SafeExtracted = {};
  const seen = new WeakSet<object>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value: raw, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited++ < 32) {
    const item = queue.shift()!;
    if (item.depth > 4 || typeof item.value !== 'object' || item.value === null) continue;
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(item.value);
    } catch {
      continue;
    }
    const value = (key: string): unknown => {
      const descriptor = descriptors[key];
      return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    };
    // Error fields are own data properties. For DOMException, invoke only the
    // built-in accessors rather than arbitrary getters supplied by a payload.
    let name = value('name');
    let builtinMessage: unknown;
    if (typeof DOMException !== 'undefined' && item.value instanceof DOMException) {
      try {
        const prototype = DOMException.prototype;
        name ??= Object.getOwnPropertyDescriptor(prototype, 'name')?.get?.call(item.value);
        builtinMessage = Object.getOwnPropertyDescriptor(prototype, 'message')?.get?.call(
          item.value,
        );
      } catch {
        // Non-DOMException values fail the native brand check.
      }
    }
    const code = value('code');
    if (name === 'AbortError') out.explicitAbort = true;
    if (typeof name === 'string' && /TimeoutError/u.test(name)) out.timeout = true;
    if (typeof code === 'string' && SAFE_NETWORK_CODES.has(code)) {
      out.network = true;
      if (isLLMTransportTimeoutCode(code)) out.timeout = true;
    }
    const statusCode = validHttpStatus(value('statusCode')) ?? validHttpStatus(value('status'));
    out.httpStatus ??= statusCode;
    if (name === 'APICallError' && statusCode === undefined && item.value instanceof Error) {
      out.network = true;
    }
    const upstream = validInteger(value('status_code'));
    out.httpStatus ??= validHttpStatus(upstream);
    out.upstreamStatusCode = preferBusinessStatus(out.upstreamStatusCode, upstream);
    const existing = validInteger(value('errorCode'));
    if (existing !== undefined && isLLMProtocolCode(existing))
      out.existingProtocolCode ??= existing;
    else out.providerMessageCode ??= existing;
    const providerCode = validInteger(value('code'));
    if (providerCode !== undefined && isLLMProtocolCode(providerCode)) {
      out.existingProtocolCode ??= providerCode;
    } else {
      out.providerMessageCode ??= providerCode;
    }
    const statusMessage = value('status_message') ?? value('status_msg');
    const message = value('message') ?? builtinMessage;
    if (typeof statusMessage === 'string') out.message = sanitizeMessage(statusMessage);
    else if (!out.message && typeof message === 'string') out.message = sanitizeMessage(message);
    const errorMessage = value('error');
    if (!out.message && typeof errorMessage === 'string')
      out.message = sanitizeMessage(errorMessage);
    const responseBody = value('responseBody');
    if (typeof responseBody === 'string' && responseBody.length <= 64_000) {
      try {
        queue.push({ value: JSON.parse(responseBody), depth: item.depth + 1 });
      } catch {
        /* compatibility fallback */
      }
    }
    for (const key of ['base_resp', 'cause', 'error', 'data']) {
      queue.push({ value: value(key), depth: item.depth + 1 });
    }
  }
  return out;
}

function validInteger(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2_000_000_000
    ? value
    : undefined;
}
function validHttpStatus(value: unknown): number | undefined {
  const n = validInteger(value);
  return n !== undefined && n >= 100 && n <= 599 ? n : undefined;
}
function sanitizeMessage(message: string): string {
  return message.slice(0, 4096);
}

function extractLegacyMessageFacts(message: string | undefined): {
  httpStatus?: number;
  upstreamStatusCode?: number;
  providerMessageCode?: number;
  existingProtocolCode?: number;
  message?: string;
} {
  if (!message) return {};
  const boundedMessage = sanitizeMessage(message);
  const extracted = tryExtractFromPayload({ message: boundedMessage });
  const classified = classifyLLMErrorToCode(boundedMessage);
  const statusCode = validInteger(extracted.statusCode);
  const httpStatus = validHttpStatus(statusCode);
  return {
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(extracted.upstreamStatusCode !== undefined
      ? { upstreamStatusCode: extracted.upstreamStatusCode }
      : {}),
    ...(extracted.providerMessageCode !== undefined
      ? { providerMessageCode: extracted.providerMessageCode }
      : {}),
    ...(classified ? { existingProtocolCode: classified.status_code } : {}),
    ...(extracted.message ? { message: sanitizeMessage(extracted.message) } : {}),
  };
}

function applyNumericSignals(facts: LLMErrorFacts, signals: Set<LLMErrorSignal>): void {
  const httpStatus = effectiveHttpStatus(facts);
  if (mappedUpstreamCode(facts) === LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED || httpStatus === 402)
    signals.add('credits_exhausted');
  if (mappedUpstreamCode(facts) === LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED)
    signals.add('usage_limit');
  if (mappedUpstreamCode(facts) === LLM_ERROR_CODES.SAFETY_SENSITIVE) signals.add('content_filter');
  if (
    httpStatus === 429 &&
    [2045, 2046, 2047, 1039, 1041].includes(facts.providerMessageCode ?? -1)
  )
    signals.add('tpm_rate_limit');
}

function effectiveHttpStatus(facts: LLMErrorFacts): number | undefined {
  return validHttpStatus(facts.upstreamStatusCode) ?? facts.httpStatus;
}
function applyMessageSignals(
  message: string | undefined,
  facts: LLMErrorFacts,
  signals: Set<LLMErrorSignal>,
): void {
  if (!message) return;
  if (/\brequest was aborted\b/i.test(message)) facts.explicitAbort = true;
  if (/\b429\b/u.test(message) || /rate[_\s-]?limit(?:ed)?/i.test(message))
    facts.httpStatus ??= 429;
  if (/\b529\b/u.test(message) || /cluster\s+overload/i.test(message)) facts.httpStatus ??= 529;
  if (/\b(?:2045|2046|2047|1039|1041)\b/u.test(message)) signals.add('tpm_rate_limit');
  if (
    LLM_USAGE_LIMIT_UPSTREAM_STATUS_CODE_RE.test(message) ||
    /usage[_\s-](?:limit[_\s-])?(?:reached|exceeded|not[_\s-]included)/i.test(message)
  )
    signals.add('usage_limit');
  if (
    /\b(?:1400010161|1008)\b/u.test(message) ||
    /credits?\s+exhausted|insufficient\s+balance/i.test(message)
  )
    signals.add('credits_exhausted');
  if (
    ABORT_MESSAGE_RE.test(message) ||
    TRANSIENT_TIMEOUT_MESSAGE_RE.test(message) ||
    CHROMIUM_TIMEOUT_MESSAGE_RE.test(message)
  )
    facts.timeout = true;
  if (
    CONNECTION_ERROR_MESSAGE_RE.test(message) ||
    TRANSIENT_NETWORK_MESSAGE_RE.test(message) ||
    CHROMIUM_NETWORK_MESSAGE_RE.test(message)
  )
    signals.add('network');
  if (/\bempty.?response/i.test(message)) signals.add('empty_response');
  const hasStructuredError =
    facts.existingProtocolCode !== undefined || effectiveHttpStatus(facts) !== undefined;
  if (!hasStructuredError && /\b(content.?filter|content.?policy|safety|blocked)\b/i.test(message))
    signals.add('content_filter');
}

/**
 * Plugin-friendly classifier — accepts a structured triple instead of a
 * thrown value. Mirrors the daemon-side `classifyLLMError` minus the
 * SDK-instance branches (no `APICallError.isInstance`, no `DOMException`).
 *
 * Returns `undefined` when there's no signal of an error at all (success
 * path); callers stamp `error_reason: ''` in that case so the metric
 * label set stays consistent across success / failure paths (the metric
 * registry freezes label keys on first observation).
 */
export interface FinishStepClassifierInput {
  finishReason?: string;
  statusCode?: number;
  errorMessage?: string;
}

export function classifyFinishStepError(
  input: FinishStepClassifierInput,
): LLMErrorReason | undefined {
  const { finishReason, statusCode, errorMessage } = input;
  if (finishReason === 'length') return 'length';
  if (finishReason === 'content-filter' || finishReason === 'content_filter') {
    return 'content_filter';
  }
  if (typeof statusCode === 'number') {
    if (statusCode === 429) return 'rate_limited';
    if (statusCode === 401 || statusCode === 403) return 'auth';
    if (statusCode === 404) return 'not_found';
    if (statusCode >= 400 && statusCode < 500) return 'bad_request';
  }
  if (errorMessage) {
    if (
      ABORT_MESSAGE_RE.test(errorMessage) ||
      TRANSIENT_TIMEOUT_MESSAGE_RE.test(errorMessage) ||
      CHROMIUM_TIMEOUT_MESSAGE_RE.test(errorMessage)
    ) {
      return 'timeout';
    }
    if (
      CONNECTION_ERROR_MESSAGE_RE.test(errorMessage) ||
      TRANSIENT_NETWORK_MESSAGE_RE.test(errorMessage) ||
      CHROMIUM_NETWORK_MESSAGE_RE.test(errorMessage)
    ) {
      return 'network';
    }
    if (/\bempty.?response/i.test(errorMessage)) return 'empty_response';
    if (/\b(content.?filter|content.?policy|safety|blocked)/i.test(errorMessage)) {
      return 'content_filter';
    }
  }
  if (typeof statusCode === 'number' && statusCode >= 500) return 'server_error';
  if (finishReason === 'error') return 'unknown';
  return undefined;
}

/**
 * Daemon-side classifier — accepts a raw thrown value (`APICallError`
 * instance, `DOMException`, plain `Error`, anything). Falls through to
 * `classifyFinishStepError` for the message-pattern branches and the
 * statusCode branches when the value carries those fields.
 *
 * Plugin code should prefer `classifyFinishStepError` directly because the
 * SDK has already normalised the shape. Daemon code uses this entry point.
 */
export function classifyLLMError(err: unknown): LLMErrorReason {
  // DOMException AbortError or Error message-text "timeout/abort" — same
  // bucket whether it came from `AbortController.abort()` or a server-side
  // 504 with no explicit status.
  const isAbort =
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError') ||
    (err instanceof Error &&
      (ABORT_MESSAGE_RE.test(err.message) ||
        TRANSIENT_TIMEOUT_MESSAGE_RE.test(err.message) ||
        CHROMIUM_TIMEOUT_MESSAGE_RE.test(err.message)));
  if (isAbort) return 'timeout';

  // Vercel AI SDK's APICallError carries statusCode but isn't a subclass of
  // Error in older versions. Detect via duck-typing on `name === 'APICallError'`
  // (or via the SDK's `isInstance` when available — see daemon shim).
  const errorCode = extractErrorCode(err);
  const errorMessage = extractErrorMessage(err);
  const apiStatus = extractAPICallErrorStatus(err);
  if (apiStatus !== undefined) {
    if (apiStatus === 429) return 'rate_limited';
    if (apiStatus === 401 || apiStatus === 403) return 'auth';
    if (apiStatus === 404) return 'not_found';
    if (apiStatus >= 400 && apiStatus < 500) return 'bad_request';
    if (errorCode !== undefined && SAFE_NETWORK_CODES.has(errorCode)) {
      return isLLMTransportTimeoutCode(errorCode) ? 'timeout' : 'network';
    }
    if (errorMessage !== undefined) {
      if (isLLMTransportTimeoutSignal(errorMessage)) return 'timeout';
      if (isLLMTransportNetworkSignal(errorMessage)) return 'network';
    }
    if (apiStatus >= 500) return 'server_error';
    // statusCode === undefined on APICallError is the SDK's "no response
    // came back at all" sentinel — treat as a network error.
  }

  if (errorCode !== undefined && SAFE_NETWORK_CODES.has(errorCode)) {
    return isLLMTransportTimeoutCode(errorCode) ? 'timeout' : 'network';
  }

  const isAPICallErrorWithoutStatus =
    apiStatus === undefined && err instanceof Error && err.name === 'APICallError';
  if (isAPICallErrorWithoutStatus) return 'network';

  if (
    err instanceof TypeError ||
    (err instanceof Error &&
      (CONNECTION_ERROR_MESSAGE_RE.test(err.message) ||
        TRANSIENT_NETWORK_MESSAGE_RE.test(err.message) ||
        CHROMIUM_NETWORK_MESSAGE_RE.test(err.message)))
  ) {
    return 'network';
  }

  if (
    err instanceof Error &&
    /\b(content.?filter|content.?policy|safety|blocked)/i.test(err.message)
  ) {
    return 'content_filter';
  }

  if (err instanceof Error && /\bempty.?response/i.test(err.message)) {
    return 'empty_response';
  }

  return 'unknown';
}

/**
 * Best-effort extraction of `statusCode` from an unknown thrown value. We
 * read the field directly so this module stays free of the `ai` package
 * dependency (which `@mavis/shared` cannot import — it would pull the
 * Vercel AI SDK into the plugin bundle).
 */
function extractAPICallErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { statusCode?: unknown; name?: unknown };
  if (candidate.name !== 'APICallError') return undefined;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

function extractErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : undefined;
}

function extractErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { message?: unknown };
  return typeof candidate.message === 'string' ? candidate.message : undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// LLM error → shared session-status status_code (cloud-runtime wire normalize)
// ────────────────────────────────────────────────────────────────────────────
//
// Complements classifyLLMError's bounded metric labels above: this produces a runtime numeric
// status_code for the wire (BusEvent.errorCode / ProtocolError.code), enabling the frontend's
// typed error messages and status branches.
// Codes 42212 / 50110 / 50150 enter UI ChatStatus.RunOutOfCredit;
// 50111 is short-term request rate limiting and triggers output retry; 50151 displays high cluster load.
//
// These codes are shared wire constants across runtimes. Do not import them back from a host package,
// which would couple cloud-runtime/local-runtime to the local host implementation again.

export const LLM_ERROR_STATUS_CODES = {
  /** USAGE_LIMIT_EXCEEDED — quota exhausted / usage limit reached. */
  USAGE_LIMIT_EXCEEDED: 42212,
  /** LLM_CREDITS_EXHAUSTED — provider reports depleted balance / HTTP 402. */
  LLM_CREDITS_EXHAUSTED: 50110,
  /** daemon LLM_RATE_LIMITED — HTTP 429 */
  LLM_RATE_LIMITED: 50111,
  /** daemon LLM_AUTH_ERROR — HTTP 401/403 */
  LLM_AUTH_ERROR: 50112,
  /** daemon LLM_UPSTREAM_ERROR — generic 4xx/5xx fallback */
  LLM_UPSTREAM_ERROR: 50113,
  /** daemon LLM_MIGRATION_ERROR — OP migration path failed */
  LLM_MIGRATION_ERROR: 50114,
  /** daemon LLM_TPM_RATE_LIMITED — provider TPM/RPM short-term throttling */
  LLM_TPM_RATE_LIMITED: 50150,
  /** Existing runtime SAFETY_SENSITIVE wire code — provider content rejection. */
  SAFETY_SENSITIVE: 50201,
  /** LLM_CLUSTER_OVERLOADED — HTTP 529 */
  LLM_CLUSTER_OVERLOADED: 50151,
} as const;
export type LLMErrorStatusCode =
  (typeof LLM_ERROR_STATUS_CODES)[keyof typeof LLM_ERROR_STATUS_CODES];

// Backward-compatible name for UI typed-match imports.
export const LLM_ERROR_CODES = LLM_ERROR_STATUS_CODES;

export const LLM_TPM_RATE_LIMIT_MESSAGE_CODES = [2045, 2046, 2047, 1039, 1041] as const;

const LLM_TPM_RATE_LIMIT_MESSAGE_CODE_RE = /\b(?:2045|2046|2047|1039|1041)\b/u;

export function isLLMTpmRateLimitMessage(message: string | undefined): boolean {
  return message !== undefined && LLM_TPM_RATE_LIMIT_MESSAGE_CODE_RE.test(message);
}

/**
 * Map upstream MiniMax / OpenAI-style provider status_code to daemon ErrorCode. Values share the
 * source of daemon local-proxy-handler.ts::UPSTREAM_CODE_MAP.
 */
export const UPSTREAM_STATUS_CODE_MAP: Record<number, LLMErrorStatusCode> = {
  // MiniMax public base_resp codes: https://platform.minimax.cn/docs/api-reference/errorcode
  1000: LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
  1002: LLM_ERROR_CODES.LLM_RATE_LIMITED,
  1004: LLM_ERROR_CODES.LLM_AUTH_ERROR,
  1008: LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED,
  1013: LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
  1024: LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
  1026: LLM_ERROR_CODES.SAFETY_SENSITIVE,
  1027: LLM_ERROR_CODES.SAFETY_SENSITIVE,
  1033: LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
  // MiniMax internal status: insufficient balance → 50110.
  1400010161: LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED,
  // MiniMax internal status: usage limit exceeded → 42212.
  2056: LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED,
  // Token Plan limit reached with automatic credit consumption disabled → 42212.
  2067: LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED,
};

function isLLMProtocolCode(code: number): code is LLMErrorStatusCode {
  return Object.values(LLM_ERROR_CODES).includes(code as LLMErrorStatusCode);
}

/** Preserve a nested business error over an outer HTTP-shaped or success wrapper. */
function preferBusinessStatus(
  current: number | undefined,
  candidate: number | undefined,
): number | undefined {
  if (candidate === undefined) return current;
  if (current === undefined) return candidate;
  const candidateIsBusiness = candidate !== 0 && validHttpStatus(candidate) === undefined;
  const currentIsWrapper = current === 0 || validHttpStatus(current) !== undefined;
  const candidateIsKnown = UPSTREAM_STATUS_CODE_MAP[candidate] !== undefined;
  const currentIsKnown = UPSTREAM_STATUS_CODE_MAP[current] !== undefined;
  return candidateIsBusiness && (currentIsWrapper || (!currentIsKnown && candidateIsKnown))
    ? candidate
    : current;
}

function mappedUpstreamCode(
  facts: Pick<LLMErrorFacts, 'upstreamStatusCode' | 'providerMessageCode'>,
): LLMErrorStatusCode | undefined {
  const code = facts.upstreamStatusCode ?? facts.providerMessageCode;
  return code === undefined ? undefined : UPSTREAM_STATUS_CODE_MAP[code];
}

interface ExtractedLLMPayload {
  /** Transport HTTP status only; provider status_code is kept separately. */
  statusCode?: number;
  upstreamStatusCode?: number;
  providerMessageCode?: number;
  errorCode?: number;
  message?: string;
}

/** Bounded, no-getter extraction shared by legacy protocol and normalized paths. */
export function tryExtractFromPayload(raw: unknown): ExtractedLLMPayload {
  return extractPayload(raw, 0);
}

function extractPayload(raw: unknown, messageDepth: number): ExtractedLLMPayload {
  try {
    const extracted = safeExtract(raw);
    const fromMessage =
      messageDepth < 4 ? extractFromMessageString(extracted.message ?? '', messageDepth + 1) : {};
    return {
      statusCode: extracted.httpStatus ?? fromMessage.statusCode,
      upstreamStatusCode: preferBusinessStatus(
        extracted.upstreamStatusCode,
        fromMessage.upstreamStatusCode,
      ),
      providerMessageCode: extracted.providerMessageCode ?? fromMessage.providerMessageCode,
      errorCode: extracted.existingProtocolCode ?? fromMessage.errorCode,
      message: fromMessage.message ?? extracted.message,
    };
  } catch {
    return {};
  }
}

// extractFromMessageString — best-effort parse of a raw error-message
// string for an HTTP status prefix and an embedded JSON body.
//
// Handles shapes seen in real cloud-runtime logs:
//
//   `[Error] 401 {"type":"error","error":{"type":"authentication_error",
//                                          "message":"invalid api key"},
//                 "request_id":"..."}`   (Messages-compatible providers)
//   `Provider API error (429): rate limited`
//   `OpenAI 401: invalid api key`
//   `500 Internal Server Error - {"status_code":1400010161,...}`
//
// Returns `{ statusCode?, message? }`:
//   - statusCode: first 3-digit HTTP-shaped number in [400, 599] found in
//     the prefix segment (before the first `{`). Stops at 599 so random
//     numeric content in JSON body doesn't trigger false positives.
//   - message: the most specific human-readable message found in the
//     embedded JSON (`error.message` → `message` → `error` as string).
function extractFromMessageString(s: string, messageDepth: number): ExtractedLLMPayload {
  const out: ExtractedLLMPayload = {};
  if (!s) return out;

  // 1. Find the embedded JSON body (first `{` ... last `}`).
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  const prefix = firstBrace > 0 ? s.slice(0, firstBrace) : s;
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonSlice = s.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonSlice) as unknown;
      const innerExtract = extractPayload(parsed, messageDepth);
      if (innerExtract.statusCode !== undefined) out.statusCode = innerExtract.statusCode;
      if (innerExtract.upstreamStatusCode !== undefined)
        out.upstreamStatusCode = innerExtract.upstreamStatusCode;
      if (innerExtract.providerMessageCode !== undefined)
        out.providerMessageCode = innerExtract.providerMessageCode;
      if (innerExtract.errorCode !== undefined) out.errorCode = innerExtract.errorCode;
      if (innerExtract.message) out.message = innerExtract.message;
    } catch {
      // ignore — not JSON
    }
  }

  // 2. If no statusCode from JSON body, grab first 4xx/5xx number in prefix.
  if (out.statusCode === undefined) {
    const m = prefix.match(/\b([45]\d{2})\b/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 400 && n <= 599) {
        out.statusCode = n;
      }
    }
  }

  // A collapsed provider error may retain its business code after the HTTP
  // status. Do not interpret arbitrary numbers elsewhere in prose as codes.
  const suffix = prefix.match(/\b[45]\d{2}\s+\((\d{4,10})\)\s*$/u);
  if (suffix) out.upstreamStatusCode ??= validInteger(Number(suffix[1]));
  return out;
}

/**
 * HTTP status → daemon ErrorCode fallback when no typed errorCode or upstream status_code matches.
 */
export function mapUpstreamHttpError(httpStatus: number): LLMErrorStatusCode | undefined {
  if (httpStatus === 402) return LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED;
  if (httpStatus === 429) return LLM_ERROR_CODES.LLM_RATE_LIMITED;
  if (httpStatus === 529) return LLM_ERROR_CODES.LLM_CLUSTER_OVERLOADED;
  if (httpStatus === 401 || httpStatus === 403) return LLM_ERROR_CODES.LLM_AUTH_ERROR;
  if (validHttpStatus(httpStatus) !== undefined && httpStatus >= 400)
    return LLM_ERROR_CODES.LLM_UPSTREAM_ERROR;
  return undefined;
}

/**
 * Normalize a raw LLM call error into session-status status_code + sanitized message.
 *
 * Priority:
 * 1. Explicit payload errorCode / code (status_code enum).
 * 2. Upstream payload status_code matching UPSTREAM_STATUS_CODE_MAP (MiniMax 1400010161 / 2056 /
 *   2067).
 * 3. Message-only quota/credits signal, e.g. "usage limit exceeded (2056)".
 * 4. HTTP 429 + TPM provider message code → LLM_TPM_RATE_LIMITED(50150).
 * 5. LLM HTTP timeout signal → LLM_UPSTREAM_ERROR(50113).
 * 6. LLM transport network signal → LLM_UPSTREAM_ERROR(50113).
 * 7. HTTP status in payload / err.statusCode → mapUpstreamHttpError.
 *
 * Return null if unrecognized; callers fall back to ProtocolErrorCode.INTERNAL_ERROR.
 *
 * Prefer sanitized payload text (string_message / message / error text) for message; fall back to
 * err.message.
 */
export function classifyLLMErrorToCode(
  err: unknown,
): { status_code: LLMErrorStatusCode; message: string } | null {
  // Accept plain strings (some callers — notably pi-turn-runner capturing
  // `agent.state.errorMessage`) have already collapsed the typed error
  // shape into a single line. Wrap into `{message: str}` so the existing
  // `pass 3` string-fallback inside `tryExtractFromPayload` (status prefix
  // + embedded JSON parse) still fires.
  const normalized = typeof err === 'string' ? { message: err } : err;
  const extracted = tryExtractFromPayload(normalized);
  // 1. typed errorCode
  if (extracted.errorCode !== undefined) {
    const allowed = new Set<number>(Object.values(LLM_ERROR_CODES));
    if (allowed.has(extracted.errorCode)) {
      return {
        status_code: extracted.errorCode as LLMErrorStatusCode,
        message: extracted.message ?? fallbackMessage(err),
      };
    }
  }
  // 2. Match provider business codes without treating them as HTTP statuses.
  const upstreamCode = mappedUpstreamCode(extracted);
  if (upstreamCode !== undefined) {
    return {
      status_code: upstreamCode,
      message: extracted.message ?? fallbackMessage(err),
    };
  }

  // 3. Message-only quota fallback. Some SDK/proxy wrappers collapse the
  // upstream body into plain text while keeping only a generic HTTP 500 outside.
  // Treat the business signal in the text as stronger than the transport status.
  const messageOnly = classifyQuotaSignalFromMessage(extracted.message ?? fallbackMessage(err));
  if (messageOnly) return messageOnly;

  const codeMessage = extracted.message ?? fallbackMessage(err);
  const transport = safeExtract(normalized);
  const httpStatus = validHttpStatus(extracted.upstreamStatusCode) ?? extracted.statusCode;

  // 4. Provider TPM/rate-window fallback. These 429s are short-term request
  // throttles, not quota exhaustion, so they get their own product code.
  if (httpStatus === 429 && isLLMTpmRateLimitMessage(codeMessage)) {
    return {
      status_code: LLM_ERROR_CODES.LLM_TPM_RATE_LIMITED,
      message: codeMessage,
    };
  }

  // 5. Structured business HTTP statuses remain stronger than transport text.
  // A misleading wrapper message such as "timed out" must not turn auth,
  // quota, rate-limit, not-found, or the explicit 529 overload response into
  // a generic transient capacity error. 5xx statuses are intentionally left
  // for the transport checks below because a 5xx wrapper may represent a
  // connection failure with no usable upstream response.
  if (httpStatus !== undefined && (httpStatus < 500 || httpStatus === 529)) {
    const mapped = mapUpstreamHttpError(httpStatus);
    if (mapped !== undefined) {
      return {
        status_code: mapped,
        message: extracted.message ?? fallbackMessage(err),
      };
    }
  }

  // 6. LLM HTTP timeout fallback. A transport deadline does not prove that
  // the provider returned an explicit cluster-overload response.
  const timeoutMessage = codeMessage;
  if (transport.timeout || isLLMTransportTimeoutSignal(timeoutMessage)) {
    return {
      status_code: LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
      message: timeoutMessage,
    };
  }

  // 7. Remaining HTTP status fallback (normally generic 5xx).
  if (httpStatus !== undefined) {
    const mapped = mapUpstreamHttpError(httpStatus);
    if (mapped !== undefined) {
      return {
        status_code: mapped,
        message: extracted.message ?? fallbackMessage(err),
      };
    }
  }

  // 8. LLM transport network fallback. No dedicated daemon wire code exists for
  // network, so use the generic upstream code while preserving the raw detail.
  const networkMessage = codeMessage;
  if (isLLMTransportNetworkSignal(networkMessage) || transport.network) {
    return {
      status_code: LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
      message: networkMessage,
    };
  }
  return null;
}

function isLLMTransportTimeoutCode(code: string): boolean {
  return /\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|ECONNABORTED|ERR_(?:CONNECTION_)?TIMED_OUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)\b/u.test(
    code,
  );
}

function isLLMTransportTimeoutSignal(message: string): boolean {
  return TRANSIENT_TIMEOUT_MESSAGE_RE.test(message) || CHROMIUM_TIMEOUT_MESSAGE_RE.test(message);
}

function isLLMTransportNetworkSignal(message: string): boolean {
  return (
    CONNECTION_ERROR_MESSAGE_RE.test(message) ||
    CHROMIUM_NETWORK_MESSAGE_RE.test(message) ||
    SAFE_TRANSPORT_NETWORK_MESSAGE_RE.test(message)
  );
}

function classifyQuotaSignalFromMessage(
  message: string,
): { status_code: LLMErrorStatusCode; message: string } | null {
  if (
    /\b(?:1400010161|1008)\b/u.test(message) ||
    /credits?\s+exhausted/i.test(message) ||
    /insufficient\s+balance/i.test(message)
  ) {
    return { status_code: LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED, message };
  }

  if (
    LLM_USAGE_LIMIT_UPSTREAM_STATUS_CODE_RE.test(message) ||
    /usage\s+limit\s+exceeded/i.test(message) ||
    /package\s+quota\s+has\s+reached(?:\s+its)?\s+limit/i.test(message)
  ) {
    return { status_code: LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED, message };
  }

  if (/\bhibernation\b/i.test(message)) {
    return { status_code: LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED, message };
  }

  if (/requests?\s+(?:are\s+)?too\s+frequent/i.test(message)) {
    return { status_code: LLM_ERROR_CODES.LLM_RATE_LIMITED, message };
  }

  return null;
}

function fallbackMessage(err: unknown): string {
  if (typeof err === 'string') return sanitizeMessage(err);
  return 'LLM call failed';
}
