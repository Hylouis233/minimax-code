import { streamSimple, type Api, type Context } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { IAgentConfig } from "@mavis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalModelConfig } from "../contracts.js";
import { buildLocalRequestPayloadTransform } from "../../turn-system/agent-host/assembly/local-turn-payload-transform.js";
import { LocalModelResolver } from "./local-model-resolver.js";
import { modelRefForModel } from "./model-ref.js";
import { resolveFastRequestOptions } from "./fast-request.js";
import {
  createProductionRootArchiveTitleModel,
  createProductionSessionTitleModel,
  type ProductionAgentPreparation,
} from "../../turn-system/production-composition.js";
import type { SessionRecord } from "../../session-system/sessions/repo/contract.js";

afterEach(() => vi.unstubAllGlobals());

describe("explicit Fast transport controls", () => {
  it.each([
    "openai-responses",
    "openai-completions",
    "anthropic-messages",
  ] as const)("leaves %s unchanged by default and when disabled", (api) => {
    const headers = { Authorization: "synthetic-auth", Existing: "kept" };
    expect(resolveFastRequestOptions(api, undefined, headers)).toEqual({
      headers,
    });
    expect(resolveFastRequestOptions(api, { enabled: false }, headers)).toEqual(
      { headers },
    );
    expect(resolveFastRequestOptions(api, undefined, undefined)).toEqual({});
  });

  it.each(["openai-responses", "openai-completions"] as const)(
    "serializes both explicit OpenAI tiers on %s",
    (api) => {
      for (const tier of ["priority", "fast"] as const) {
        expect(
          resolveFastRequestOptions(
            api,
            { enabled: true, mode: `openai-${tier}` },
            undefined,
          ),
        ).toEqual({ requestPatch: { service_tier: tier } });
      }
    },
  );

  it("combines Anthropic beta headers case-insensitively without changing credentials", () => {
    const headers = Object.freeze({
      "Anthropic-Beta": "existing-beta, fast-mode-2026-02-01",
      "anthropic-beta": "another-beta,existing-beta",
      "x-api-key": "synthetic-key",
    });
    expect(
      resolveFastRequestOptions(
        "anthropic-messages",
        {
          enabled: true,
          mode: "anthropic-fast",
        },
        headers,
      ),
    ).toEqual({
      requestPatch: { speed: "fast" },
      headers: {
        "x-api-key": "synthetic-key",
        "anthropic-beta": "existing-beta,fast-mode-2026-02-01,another-beta",
      },
    });
    expect(headers["Anthropic-Beta"]).toBe(
      "existing-beta, fast-mode-2026-02-01",
    );
  });

  it("does not invent a wire flag for an explicitly selected fast-model SKU", () => {
    expect(
      resolveFastRequestOptions(
        "anthropic-messages",
        {
          enabled: true,
          mode: "model",
        },
        undefined,
      ),
    ).toEqual({});
  });

  it.each([
    null,
    true,
    "fast",
    [],
    {},
    { enabled: "false" },
    { enabled: true },
    { enabled: true, mode: "ultra" },
    { enabled: true, mode: "openai-fast", reasoning_effort: "low" },
  ])("rejects malformed Fast configuration %j before a request", (value) => {
    expect(() =>
      resolveFastRequestOptions("openai-responses", value, undefined),
    ).toThrow("Invalid Fast configuration");
  });

  it.each([
    ["anthropic-messages", "openai-fast"],
    ["openai-responses", "anthropic-fast"],
    ["openai-completions", "anthropic-fast"],
    ["openai-codex-responses", "openai-priority"],
  ] as const)(
    "rejects unsupported %s / %s rather than silently downgrading",
    (api, mode) => {
      expect(() =>
        resolveFastRequestOptions(api, { enabled: true, mode }, undefined),
      ).toThrow("Invalid Fast configuration");
    },
  );
});

async function resolveFixture(
  api: Api,
  // `undefined` models the unconfigured case: no `fast` block on the model at
  // all, which is the only state that reaches the resolver with nothing to
  // resolve. Every other caller passes an explicit mode.
  mode: NonNullable<LocalModelConfig["fast"]>["mode"] | undefined,
  effort: string,
  modelId = "synthetic-model",
  enabled = true,
) {
  const modelConfig: LocalModelConfig = {
    reasoning: true,
    thinking: { effortOptions: ["low", "high", "max", "ultra"] },
    ...(mode === undefined ? {} : { fast: { enabled, mode } }),
    limit: { context: 120_000, output: 12_000 },
  };
  const agentConfig: IAgentConfig = {
    system_prompt: "SYNTHETIC offline fixture",
    agent_id: "synthetic-agent",
    model: modelRefForModel("custom_provider:fixture", modelId, modelConfig, {
      thinking: { effort },
    }),
    tools: [],
    skills: [],
  };
  const resolver = new LocalModelResolver({
    byokConfigGetter: () => ({
      custom_provider: {
        fixture: {
          api,
          options: {
            apiKey: "synthetic-key",
            baseURL: "https://provider.example.invalid/v1",
            headers: { "Anthropic-Beta": "existing-beta", Existing: "kept" },
          },
          models: { [modelId]: modelConfig },
        },
      },
    }),
  });
  const llm = await resolver.resolveModel({
    sessionId: "synthetic-session",
    turnId: "synthetic-turn",
    agentConfig,
  });
  return { agentConfig, llm };
}

describe("Fast reaches the prepared request without replacing native reasoning", () => {
  it.each([
    ["openai-responses", "openai-priority"],
    ["openai-completions", "openai-fast"],
    ["anthropic-messages", "anthropic-fast"],
  ] as const)(
    "preserves high, max and declared ultra with %s",
    async (api, mode) => {
      const network = vi.fn(() => {
        throw new Error("No network is permitted in this offline fixture");
      });
      vi.stubGlobal("fetch", network);
      for (const effort of ["high", "max", "ultra"]) {
        const { llm, agentConfig } = await resolveFixture(api, mode, effort);
        const transform = buildLocalRequestPayloadTransform(
          {
            agentConfig: { ...agentConfig },
            llm,
            sessionId: "synthetic-session",
            signal: new AbortController().signal,
          },
          {},
        );
        const payload: Record<string, unknown> = {
          model: llm.model.id,
          messages: [],
          max_tokens: 100,
        };
        await transform(payload, llm.model);
        if (api === "anthropic-messages") {
          expect(payload.speed).toBe("fast");
          expect(payload.output_config).toMatchObject({ effort });
          expect(llm.headers?.["anthropic-beta"]).toBe(
            "existing-beta,fast-mode-2026-02-01",
          );
        } else {
          expect(payload.service_tier).toBe(
            mode === "openai-fast" ? "fast" : "priority",
          );
          if (api === "openai-responses")
            expect(payload.reasoning).toMatchObject({ effort });
          else expect(payload.reasoning_effort).toBe(effort);
        }
        expect(payload.model).toBe("synthetic-model");
        expect(llm.headers?.Existing).toBe("kept");
        expect(agentConfig.tools).toEqual([]);
        expect(agentConfig.skills).toEqual([]);
      }
      expect(network).not.toHaveBeenCalled();
    },
  );

  it.each([
    "openai-responses",
    "openai-completions",
    "anthropic-messages",
  ] as const)(
    "preserves a configured future SKU verbatim on %s without claiming availability",
    async (api) => {
      const requestedModel = "M3.1-Preview-Flash-Highspeed";
      const { llm, agentConfig } = await resolveFixture(
        api,
        "model",
        "max",
        requestedModel,
      );
      expect(llm.model.id).toBe(requestedModel);
      const transform = buildLocalRequestPayloadTransform(
        {
          agentConfig: { ...agentConfig },
          llm,
          sessionId: "synthetic-session",
          signal: new AbortController().signal,
        },
        {},
      );
      const payload: Record<string, unknown> = {
        model: requestedModel,
        messages: [],
      };
      await transform(payload, llm.model);
      expect(payload.model).toBe(requestedModel);
      expect(payload).not.toHaveProperty("service_tier");
      expect(payload).not.toHaveProperty("speed");
    },
  );
});

describe("Fast reaches production title requests", () => {
  it.each([
    ["openai-responses", "openai-priority"],
    ["openai-completions", "openai-fast"],
    ["anthropic-messages", "anthropic-fast"],
  ] as const)(
    "preserves Fast and high effort for both titles over %s",
    async (api, mode) => {
      for (const enabled of [true, false]) {
        const { agentConfig, llm } = await resolveFixture(
          api,
          mode,
          "high",
          undefined,
          enabled,
        );
        const captured: Array<{
          body: Record<string, unknown>;
          headers: Headers;
        }> = [];
        const fetchImpl: typeof fetch = async (_url, init) => {
          captured.push({
            body: JSON.parse(String(init?.body)),
            headers: new Headers(init?.headers),
          });
          return new Response(
            JSON.stringify({
              error: { message: "Synthetic capture complete" },
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          );
        };
        const unexpectedNetwork = vi.fn(() => {
          throw new Error("Unexpected live request");
        });
        vi.stubGlobal("fetch", unexpectedNetwork);
        const product = {
          agents: {
            getExecutionSnapshot: async () => ({
              agentName: "fixture",
              systemPrompt: "Synthetic",
            }),
          },
          preparation: {
            buildAgentConfig: async () => agentConfig,
            resolveModel: async () => ({
              ...llm,
              streamFn: (model, context, options) =>
                streamSimple(model, context, {
                  ...options,
                  fetch: fetchImpl,
                  maxRetries: 0,
                }),
            }),
          } as ProductionAgentPreparation,
          safety: { review: async () => ({ pass: true }) },
        };
        const session: SessionRecord = {
          sessionId: "synthetic-session",
          agentName: "fixture",
          workspaceDir: "/synthetic",
          runtime: "pi-agent",
          sessionType: "root",
          sessionKind: "conversation",
          status: "idle",
          archived: false,
          createdAtMs: 1,
          updatedAtMs: 1,
        };
        const input = {
          session,
          systemPrompt: "Synthetic title",
          userPrompt: "Synthetic input",
          maxTokens: 100,
          timeoutMs: 1000,
        };
        for (const adapter of [
          createProductionSessionTitleModel(product),
          createProductionRootArchiveTitleModel(product),
        ]) {
          await expect(adapter.summarize(input)).rejects.toThrow(
            "Synthetic capture complete",
          );
        }
        expect(captured).toHaveLength(2);
        expect(unexpectedNetwork).not.toHaveBeenCalled();
        for (const { body, headers } of captured) {
          if (api === "anthropic-messages") {
            expect(body.output_config).toMatchObject({ effort: "high" });
            expect(body.speed).toBe(enabled ? "fast" : undefined);
            expect(
              headers.get("anthropic-beta")?.includes("fast-mode-2026-02-01"),
            ).toBe(enabled);
          } else {
            expect(
              api === "openai-responses"
                ? (body.reasoning as Record<string, unknown>).effort
                : body.reasoning_effort,
            ).toBe("high");
            expect(body.service_tier).toBe(
              enabled
                ? mode === "openai-fast"
                  ? "fast"
                  : "priority"
                : undefined,
            );
          }
        }
      }
    },
  );
});

describe("Anthropic Fast final SDK request headers", () => {
  it.each([
    { label: "API key", apiKey: "synthetic-key", oauth: false },
    {
      label: "OAuth-shaped synthetic token",
      apiKey: "sk-ant-oat-SYNTHETIC",
      oauth: true,
    },
  ])(
    "preserves generated and custom beta tokens for $label",
    async ({ apiKey, oauth }) => {
      const { headers, payload } = await captureAnthropicFastRequest(
        apiKey,
        true,
      );
      const beta = headers.get("anthropic-beta")?.split(",") ?? [];
      expect(new Set(beta)).toEqual(
        new Set([
          "fine-grained-tool-streaming-2025-05-14",
          "interleaved-thinking-2025-05-14",
          "model-beta",
          "existing-beta",
          "fast-mode-2026-02-01",
          ...(oauth ? ["claude-code-20250219", "oauth-2025-04-20"] : []),
        ]),
      );
      expect(beta).toHaveLength(new Set(beta).size);
      expect(headers.get("Existing")).toBe("kept");
      expect(payload.speed).toBe("fast");
      expect(payload.output_config).toMatchObject({ effort: "high" });
      expect(payload.model).toBe("synthetic-model");
      if (oauth) {
        expect(headers.get("authorization")).toBe(`Bearer ${apiKey}`);
        expect(headers.has("x-api-key")).toBe(false);
      } else {
        expect(headers.get("x-api-key")).toBe(apiKey);
        expect(headers.has("authorization")).toBe(false);
      }
    },
  );

  it("leaves generated betas and credentials unchanged when Fast is disabled", async () => {
    const { headers, payload } = await captureAnthropicFastRequest(
      "synthetic-key",
      false,
    );
    expect(new Set(headers.get("anthropic-beta")?.split(","))).toEqual(
      new Set([
        "fine-grained-tool-streaming-2025-05-14",
        "interleaved-thinking-2025-05-14",
      ]),
    );
    expect(headers.get("x-api-key")).toBe("synthetic-key");
    expect(headers.has("authorization")).toBe(false);
    expect(payload).not.toHaveProperty("speed");
    expect(payload.output_config).toMatchObject({ effort: "high" });
  });
});

describe("Ultra capability does not route Fast", () => {
  it("sends an ultra-capable model identically whether Fast is unset or explicitly disabled", async () => {
    // Both captures resolve through `LocalModelResolver` and reach the wire
    // through the real `pi-ai` `streamSimple` serializer, so a leak inside
    // resolution reaches the payload instead of being re-derived here.
    const unset = await captureResolvedAnthropicRequest(undefined, true);
    const disabled = await captureResolvedAnthropicRequest("anthropic-fast", false);

    for (const { headers, payload } of [unset, disabled]) {
      expect(payload).not.toHaveProperty("speed");
      expect(payload).not.toHaveProperty("service_tier");
      expect(anthropicBetaTokens(headers)).not.toContain(
        "fast-mode-2026-02-01",
      );
      expect(payload.output_config).toMatchObject({ effort: "ultra" });
      expect(payload.model).toBe("synthetic-model");
      // The pre-existing Fast assertions all sit in fixtures that enabled Fast
      // explicitly; only these two states prove Ultra buys nothing on the wire.
      expect(headers.get("Existing")).toBe("kept");
    }

    // Independence, stated exactly: native reasoning is byte-identical whether
    // Fast was never configured or was explicitly turned off.
    expect(JSON.stringify(unset.payload.output_config)).toBe(
      JSON.stringify(disabled.payload.output_config),
    );
  });
});

async function captureAnthropicFastRequest(apiKey: string, enabled: boolean) {
  const { llm, agentConfig } = await resolveFixture(
    "anthropic-messages",
    "anthropic-fast",
    "high",
  );
  const preference = resolveFastRequestOptions(
    "anthropic-messages",
    { enabled, mode: "anthropic-fast" },
    enabled
      ? { "ANTHROPIC-BETA": "existing-beta", Existing: "kept" }
      : undefined,
  );
  const model = {
    ...llm.model,
    // Exercise beta-generating transport branches rather than the default
    // adaptive/eager paths. These are synthetic model compatibility settings.
    compat: {
      ...llm.model.compat,
      forceAdaptiveThinking: false,
      supportsEagerToolInputStreaming: false,
    },
    ...(enabled
      ? { headers: { "Anthropic-Beta": "model-beta,existing-beta" } }
      : {}),
  };
  const requestPatch = { ...llm.thinkingRequestPatch };
  if (!enabled) delete requestPatch.speed;
  const transform = buildLocalRequestPayloadTransform(
    {
      agentConfig: { ...agentConfig },
      llm: { ...llm, model, thinkingRequestPatch: requestPatch },
      sessionId: "synthetic-session",
      signal: new AbortController().signal,
    },
    {},
  );
  const context: Context = {
    messages: [{ role: "user", content: "Synthetic request", timestamp: 1 }],
    tools: [
      {
        name: "read",
        description: "Synthetic tool",
        parameters: Type.Object({ path: Type.String() }),
      },
    ],
  };
  let captured:
    { headers: Headers; payload: Record<string, unknown> } | undefined;
  const fetchImpl = vi.fn(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = new Request(input, init);
      captured = {
        headers: request.headers,
        payload: JSON.parse(await request.text()) as Record<string, unknown>,
      };
      // Deliberate terminal response after the real SDK serializes the request.
      // No live endpoint, actual token, SDK mock or successful inference is used.
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "Synthetic capture complete",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    },
  );
  const unexpectedNetwork = vi.fn(() => {
    throw new Error("Only the injected capture fetch is allowed");
  });
  vi.stubGlobal("fetch", unexpectedNetwork);
  const result = await streamSimple(model, context, {
    apiKey,
    headers: preference.headers,
    fetch: fetchImpl,
    maxRetries: 0,
    reasoning: "high",
    onPayload: transform,
  }).result();
  expect(result.stopReason).toBe("error");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(unexpectedNetwork).not.toHaveBeenCalled();
  expect(captured).toBeDefined();
  return captured!;
}

/**
 * Capture the request `LocalModelResolver` itself prepares. Unlike
 * `captureAnthropicFastRequest`, which feeds `resolveFastRequestOptions`
 * directly into `streamSimple` to unit-test that parser, this helper takes both
 * the headers and the prepared request patch from the resolver, so anything the
 * resolver infers on its own reaches the serialized request.
 */
async function captureResolvedAnthropicRequest(
  mode: NonNullable<LocalModelConfig["fast"]>["mode"] | undefined,
  enabled: boolean,
) {
  const { llm, agentConfig } = await resolveFixture(
    "anthropic-messages",
    mode,
    "ultra",
    "synthetic-model",
    enabled,
  );
  const transform = buildLocalRequestPayloadTransform(
    {
      agentConfig: { ...agentConfig },
      llm,
      sessionId: "synthetic-session",
      signal: new AbortController().signal,
    },
    {},
  );
  const context: Context = {
    messages: [{ role: "user", content: "Synthetic request", timestamp: 1 }],
    tools: [
      {
        name: "read",
        description: "Synthetic tool",
        parameters: Type.Object({ path: Type.String() }),
      },
    ],
  };
  let captured:
    | { headers: Headers; payload: Record<string, unknown> }
    | undefined;
  const fetchImpl = vi.fn(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = new Request(input, init);
      captured = {
        headers: request.headers,
        payload: JSON.parse(await request.text()) as Record<string, unknown>,
      };
      // Same terminal response as the sibling capture: the real SDK has
      // serialized the request, no live endpoint or token is involved.
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "Synthetic capture complete",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    },
  );
  const unexpectedNetwork = vi.fn(() => {
    throw new Error("Only the injected capture fetch is allowed");
  });
  vi.stubGlobal("fetch", unexpectedNetwork);
  const result = await streamSimple(llm.model, context, {
    apiKey: "synthetic-key",
    headers: llm.headers,
    fetch: fetchImpl,
    maxRetries: 0,
    reasoning: "ultra",
    onPayload: transform,
  }).result();
  expect(result.stopReason).toBe("error");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(unexpectedNetwork).not.toHaveBeenCalled();
  expect(captured).toBeDefined();
  return captured!;
}

function anthropicBetaTokens(headers: Headers): string[] {
  return (headers.get("anthropic-beta") ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}
