import { describe, expect, it } from "vitest";
import {
  LLM_ERROR_CODES,
  classifyLLMErrorToCode,
  normalizeLLMError,
  toLLMMetricErrorKind,
  toLLMProtocolClassification,
  toLLMRetryDecision,
  tryExtractFromPayload,
} from "@mavis/shared/llm-error-classifier";

// Keep messages neutral: classification must come from the structured code,
// not a coincidentally matching word or number in the provider's explanation.
const DETAIL = "provider detail";
const business = (statusCode: number) => ({
  status_code: statusCode,
  status_msg: DETAIL,
});

function expectProtocol(raw: unknown, code: number) {
  const normalized = normalizeLLMError({ raw });
  expect(toLLMProtocolClassification(normalized)?.code).toBe(code);
  expect(classifyLLMErrorToCode(raw)?.status_code).toBe(code);
  return normalized;
}

describe("MiniMax business error classification", () => {
  it("keeps HTTP 520 separate from business status 1000", () => {
    const raw = {
      statusCode: 520,
      responseBody: JSON.stringify({ base_resp: business(1000) }),
    };
    expect(tryExtractFromPayload(raw)).toMatchObject({
      statusCode: 520,
      upstreamStatusCode: 1000,
      message: DETAIL,
    });
    expect(tryExtractFromPayload(raw).errorCode).toBeUndefined();
    const normalized = expectProtocol(raw, LLM_ERROR_CODES.LLM_UPSTREAM_ERROR);
    expect(normalized.facts).toMatchObject({
      httpStatus: 520,
      upstreamStatusCode: 1000,
    });
    expect(normalized.facts.existingProtocolCode).toBeUndefined();
    expect(toLLMRetryDecision(normalized).retryable).toBe(false);
  });

  it.each([
    [1002, LLM_ERROR_CODES.LLM_RATE_LIMITED, "rate_limited", true],
    [1004, LLM_ERROR_CODES.LLM_AUTH_ERROR, "auth", false],
    [1008, LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED, "credits_exhausted", false],
    [2056, LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED, "usage_limit", false],
    [2067, LLM_ERROR_CODES.USAGE_LIMIT_EXCEEDED, "usage_limit", false],
    [
      1400010161,
      LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED,
      "credits_exhausted",
      false,
    ],
  ] as const)(
    "maps business status %i consistently across protocol, metrics and retry",
    (statusCode, code, reason, retryable) => {
      const normalized = expectProtocol(business(statusCode), code);
      expect(normalized.facts.upstreamStatusCode).toBe(statusCode);
      expect(normalized.facts.httpStatus).toBeUndefined();
      expect(toLLMMetricErrorKind(normalized.facts)).toBe(reason);
      expect(toLLMRetryDecision(normalized)).toEqual({ retryable, reason });
    },
  );

  it.each([
    { status_code: 500, error: business(1008) },
    { statusCode: 520, status_code: 0, base_resp: business(1008) },
    { statusCode: 520, status_code: 1999, base_resp: business(1008) },
    {
      statusCode: 520,
      status_code: 0,
      message: JSON.stringify({ base_resp: business(1008) }),
    },
  ])("prefers nested balance code over outer wrapper %j", (raw) => {
    const normalized = expectProtocol(
      raw,
      LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED,
    );
    expect(normalized.facts.upstreamStatusCode).toBe(1008);
    expect(normalized.facts.httpStatus).toBe(
      "statusCode" in raw ? raw.statusCode : 500,
    );
    expect(toLLMMetricErrorKind(normalized.facts)).toBe("credits_exhausted");
    expect(toLLMRetryDecision(normalized).retryable).toBe(false);
  });

  it("keeps unknown nested business codes distinct from HTTP without inventing a mapping", () => {
    const raw = { statusCode: 520, status_code: 0, base_resp: business(1999) };
    const normalized = expectProtocol(raw, LLM_ERROR_CODES.LLM_UPSTREAM_ERROR);
    expect(normalized.facts).toMatchObject({
      httpStatus: 520,
      upstreamStatusCode: 1999,
    });
    expect(toLLMRetryDecision(normalized).retryable).toBe(false);
  });

  it("does not let nested zero markers replace known business failures", () => {
    const raw = { status_code: 1008, data: { base_resp: business(0) } };
    const normalized = expectProtocol(
      raw,
      LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED,
    );
    expect(normalized.facts.upstreamStatusCode).toBe(1008);
    expect(toLLMRetryDecision(normalized).retryable).toBe(false);
  });

  it("keeps explicit content rejection ahead of TPM-looking message text", () => {
    const raw = {
      statusCode: 429,
      name: "TimeoutError",
      base_resp: { status_code: 1026, status_msg: "rate limit code 1039" },
    };
    const normalized = expectProtocol(raw, 50201);
    expect(toLLMMetricErrorKind(normalized.facts)).toBe("content_filter");
    expect(toLLMRetryDecision(normalized)).toEqual({
      retryable: false,
      reason: "content_filter",
    });
  });

  it.each([1000, 1013, 1024, 1033])(
    "classifies business status %i as generic upstream failure without automatic retry",
    (statusCode) => {
      for (const raw of [
        business(statusCode),
        {
          statusCode: 429,
          name: "TimeoutError",
          base_resp: business(statusCode),
        },
      ]) {
        const normalized = expectProtocol(
          raw,
          LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
        );
        expect(toLLMRetryDecision(normalized).retryable).toBe(false);
      }
    },
  );

  const authShapes: Array<[string, unknown]> = [
    ["plain payload", business(1004)],
    ["errorCode field", { errorCode: 1004, message: DETAIL }],
    ["code field", { code: 1004, message: DETAIL }],
    ["base_resp", { base_resp: business(1004) }],
    ["responseBody", { responseBody: JSON.stringify(business(1004)) }],
    ["error", { error: business(1004) }],
    ["data", { data: business(1004) }],
    ["cause", { cause: business(1004) }],
    [
      "Error cause",
      new Error(DETAIL, { cause: { base_resp: business(1004) } }),
    ],
    [
      "nested SDK envelope",
      {
        statusCode: 429,
        error: {
          responseBody: JSON.stringify({ data: { base_resp: business(1004) } }),
        },
      },
    ],
  ];
  it.each(authShapes)("recognizes auth business codes in %s", (_label, raw) => {
    const normalized = expectProtocol(raw, LLM_ERROR_CODES.LLM_AUTH_ERROR);
    expect(toLLMMetricErrorKind(normalized.facts)).toBe("auth");
    expect(toLLMRetryDecision(normalized)).toEqual({
      retryable: false,
      reason: "auth",
    });
    expect(tryExtractFromPayload(raw).errorCode).toBeUndefined();
  });

  it.each([1004, 1008, 2056, 2067, 1400010161])(
    "never retries terminal business status %i behind an outer timeout or rate limit",
    (statusCode) => {
      const normalized = normalizeLLMError({
        raw: {
          name: "TimeoutError",
          statusCode: 429,
          message: "timed out",
          responseBody: JSON.stringify({ base_resp: business(statusCode) }),
        },
      });
      expect(normalized.facts).toMatchObject({
        httpStatus: 429,
        upstreamStatusCode: statusCode,
      });
      expect(toLLMRetryDecision(normalized).retryable).toBe(false);
    },
  );

  it.each([1026, 1027])(
    "keeps content-filter business status %i nonretryable despite outer transient signals",
    (statusCode) => {
      for (const status of [undefined, 429, 529]) {
        const normalized = expectProtocol(
          { status, name: "TimeoutError", base_resp: business(statusCode) },
          50201,
        );
        expect(normalized.facts.upstreamStatusCode).toBe(statusCode);
        expect(toLLMMetricErrorKind(normalized.facts)).toBe("content_filter");
        expect(toLLMRetryDecision(normalized)).toEqual({
          retryable: false,
          reason: "content_filter",
        });
      }
    },
  );

  it.each([1000, 1002, 1004, 1008])(
    "recovers business status %i from a collapsed SDK message without losing HTTP 520",
    (statusCode) => {
      const text = `[Error] 520 ${JSON.stringify({ base_resp: business(statusCode) })}`;
      const raw = { message: text };
      const expectedCode = new Map([
        [1000, LLM_ERROR_CODES.LLM_UPSTREAM_ERROR],
        [1002, LLM_ERROR_CODES.LLM_RATE_LIMITED],
        [1004, LLM_ERROR_CODES.LLM_AUTH_ERROR],
        [1008, LLM_ERROR_CODES.LLM_CREDITS_EXHAUSTED],
      ]).get(statusCode);
      expect(tryExtractFromPayload(raw)).toMatchObject({
        statusCode: 520,
        upstreamStatusCode: statusCode,
        message: DETAIL,
      });
      expect(classifyLLMErrorToCode(text)?.status_code).toBe(expectedCode);
      for (const input of [{ raw }, { raw: text }, { errorMessage: text }]) {
        const normalized = normalizeLLMError(input);
        expect(normalized.facts).toMatchObject({
          httpStatus: 520,
          upstreamStatusCode: statusCode,
        });
        expect(normalized.facts.existingProtocolCode).toBeUndefined();
        expect(toLLMProtocolClassification(normalized)?.code).toBe(
          expectedCode,
        );
      }
    },
  );

  it.each([
    [429, LLM_ERROR_CODES.LLM_RATE_LIMITED, "rate_limited"],
    [529, LLM_ERROR_CODES.LLM_CLUSTER_OVERLOADED, "overloaded"],
  ] as const)(
    "preserves ordinary HTTP %i retry behavior",
    (statusCode, code, reason) => {
      for (const raw of [
        { statusCode, message: DETAIL },
        { status: statusCode, message: DETAIL },
        `[Error] ${statusCode} ${DETAIL}`,
      ]) {
        const normalized = expectProtocol(raw, code);
        expect(toLLMMetricErrorKind(normalized.facts)).toBe(reason);
        expect(toLLMRetryDecision(normalized)).toEqual({
          retryable: true,
          reason,
        });
      }
    },
  );

  it.each(["errorCode", "code"])(
    "preserves explicit protocol precedence in %s",
    (field) => {
      const raw = {
        [field]: LLM_ERROR_CODES.LLM_AUTH_ERROR,
        statusCode: 429,
        name: "TimeoutError",
        base_resp: business(1002),
      };
      const normalized = expectProtocol(raw, LLM_ERROR_CODES.LLM_AUTH_ERROR);
      expect(normalized.facts.existingProtocolCode).toBe(
        LLM_ERROR_CODES.LLM_AUTH_ERROR,
      );
      expect(tryExtractFromPayload(raw).errorCode).toBe(
        LLM_ERROR_CODES.LLM_AUTH_ERROR,
      );
      expect(toLLMRetryDecision(normalized)).toEqual({
        retryable: false,
        reason: "auth",
      });
    },
  );

  it("does not replace an explicit protocol code with a conflicting business classification", () => {
    expectProtocol(
      {
        errorCode: LLM_ERROR_CODES.LLM_RATE_LIMITED,
        base_resp: business(1008),
      },
      LLM_ERROR_CODES.LLM_RATE_LIMITED,
    );
  });

  it.each([0, 1001, 1039, 1041, 1999])(
    "preserves status %i without inventing HTTP, migration or TPM semantics",
    (statusCode) => {
      const raw = { base_resp: business(statusCode) };
      const normalized = normalizeLLMError({ raw });
      expect(normalized.facts.upstreamStatusCode).toBe(statusCode);
      expect(normalized.facts.httpStatus).toBeUndefined();
      expect(normalized.facts.existingProtocolCode).toBeUndefined();
      expect(tryExtractFromPayload(raw)).toMatchObject({
        upstreamStatusCode: statusCode,
      });
      expect(tryExtractFromPayload(raw).statusCode).toBeUndefined();
      expect(classifyLLMErrorToCode(raw)).toBeNull();
      expect(toLLMProtocolClassification(normalized)).toBeNull();
      expect(toLLMRetryDecision(normalized).retryable).toBe(false);
    },
  );

  it("does not let a zero success marker suppress an actual HTTP failure", () => {
    const raw = { statusCode: 429, base_resp: business(0) };
    const normalized = expectProtocol(raw, LLM_ERROR_CODES.LLM_RATE_LIMITED);
    expect(normalized.facts).toMatchObject({
      httpStatus: 429,
      upstreamStatusCode: 0,
    });
    expect(toLLMRetryDecision(normalized)).toEqual({
      retryable: true,
      reason: "rate_limited",
    });
  });

  it.each([NaN, Infinity, -1, 1004.5, Number.MAX_SAFE_INTEGER, "1004", null])(
    "ignores malformed business status %s while retaining actual HTTP status",
    (statusCode) => {
      const raw = {
        statusCode: 520,
        base_resp: { status_code: statusCode, status_msg: DETAIL },
      };
      const normalized = expectProtocol(
        raw,
        LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
      );
      expect(normalized.facts.httpStatus).toBe(520);
      expect(normalized.facts.upstreamStatusCode).toBeUndefined();
      expect(toLLMRetryDecision(normalized).retryable).toBe(false);
    },
  );

  it("does not interpret an out-of-range HTTP field as a business code or HTTP failure", () => {
    const raw = { statusCode: 1004, message: DETAIL };
    expect(tryExtractFromPayload(raw).statusCode).toBeUndefined();
    expect(normalizeLLMError({ raw }).facts.httpStatus).toBeUndefined();
    expect(classifyLLMErrorToCode(raw)).toBeNull();
  });

  it("handles malformed JSON, cycles and throwing getters without invoking them", () => {
    let reads = 0;
    const cycle: Record<string, unknown> = {
      statusCode: 520,
      base_resp: business(1000),
    };
    cycle.cause = cycle;
    const getters = Object.defineProperties(
      { statusCode: 520 },
      Object.fromEntries(
        [
          "message",
          "status_code",
          "errorCode",
          "code",
          "responseBody",
          "error",
          "data",
          "cause",
          "base_resp",
        ].map((key) => [
          key,
          {
            get() {
              reads += 1;
              throw new Error("unexpected accessor");
            },
          },
        ]),
      ),
    );
    for (const raw of [
      cycle,
      getters,
      { statusCode: 520, responseBody: "{invalid", message: DETAIL },
      undefined,
      null,
      1004,
    ]) {
      expect(() => tryExtractFromPayload(raw)).not.toThrow();
      expect(() => classifyLLMErrorToCode(raw)).not.toThrow();
      expect(() => {
        const normalized = normalizeLLMError({ raw });
        toLLMProtocolClassification(normalized);
        toLLMMetricErrorKind(normalized.facts);
        toLLMRetryDecision(normalized);
      }).not.toThrow();
    }
    expect(reads).toBe(0);
    expectProtocol(cycle, LLM_ERROR_CODES.LLM_UPSTREAM_ERROR);
  });
});
