import type { Api } from '@earendil-works/pi-ai';

/** A user-selected transport preference, not a reasoning or permission mode. */
export interface LocalModelFastConfig {
  readonly enabled: boolean;
  readonly mode: 'openai-priority' | 'openai-fast' | 'anthropic-fast' | 'model';
}

export interface FastRequestOptions {
  readonly requestPatch?: Readonly<Record<string, unknown>>;
  readonly headers?: Record<string, string>;
}

const ANTHROPIC_FAST_BETA = 'fast-mode-2026-02-01';
const MODES = new Set(['openai-priority', 'openai-fast', 'anthropic-fast', 'model']);

/**
 * Parse opaque BYOK configuration at the final route boundary. Never infer a
 * premium tier from a model name, a high reasoning effort, or an Ultra skill.
 */
export function resolveFastRequestOptions(
  api: Api,
  value: unknown,
  headers: Record<string, string> | undefined,
): FastRequestOptions {
  if (value === undefined) return { ...(headers ? { headers } : {}) };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidFastConfig('expected an object with an explicit enabled boolean');
  }
  const config = value as Record<string, unknown>;
  if (typeof config.enabled !== 'boolean') {
    throw invalidFastConfig('enabled must be a boolean');
  }
  if (!config.enabled) return { ...(headers ? { headers } : {}) };
  if (Object.keys(config).some((key) => key !== 'enabled' && key !== 'mode')) {
    throw invalidFastConfig('only enabled and mode are supported');
  }
  if (typeof config.mode !== 'string' || !MODES.has(config.mode)) {
    throw invalidFastConfig('select an explicit supported transport mode');
  }
  // The user already selected the exact fast-model ID in the model catalog.
  // No invented alias, service flag, fallback model, or availability claim.
  if (config.mode === 'model') return { ...(headers ? { headers } : {}) };
  if (config.mode === 'openai-priority' || config.mode === 'openai-fast') {
    if (api !== 'openai-completions' && api !== 'openai-responses') {
      throw invalidFastConfig('OpenAI Fast requires a compatible Responses or Completions route');
    }
    return {
      requestPatch: { service_tier: config.mode === 'openai-fast' ? 'fast' : 'priority' },
      ...(headers ? { headers } : {}),
    };
  }
  if (api !== 'anthropic-messages') {
    throw invalidFastConfig('Anthropic Fast requires a compatible Messages route');
  }
  return {
    requestPatch: { speed: 'fast' },
    headers: withAnthropicFastBeta(headers),
  };
}

function withAnthropicFastBeta(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  const beta = new Set<string>();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== 'anthropic-beta') {
      result[key] = value;
      continue;
    }
    for (const token of value.split(',')) {
      const normalized = token.trim();
      if (normalized) beta.add(normalized);
    }
  }
  beta.add(ANTHROPIC_FAST_BETA);
  result['anthropic-beta'] = [...beta].join(',');
  return result;
}

function invalidFastConfig(detail: string): Error {
  return Object.assign(new Error(`Invalid Fast configuration: ${detail}.`), {
    code: 'INVALID_FAST_CONFIGURATION',
    retryable: false,
  });
}
