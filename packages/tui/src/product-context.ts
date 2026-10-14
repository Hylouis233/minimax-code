import { MINIMAX_CODE_DEFAULT_AGENT_NAME } from '@mavis/shared/agent-defaults';

/**
 * Re-exported under the terminal client's own name; the value is the product
 * default shared with the WebUI (`@mavis/shared/agent-defaults`).
 */
export { MINIMAX_CODE_DEFAULT_AGENT_NAME };

export interface TuiProductContext {
  surface: 'cli' | 'tui' | 'headless';
  defaultAgentName: string;
}

export function createTuiProductContext(
  surface: TuiProductContext['surface'],
  overrides: Partial<Pick<TuiProductContext, 'defaultAgentName'>> = {},
): TuiProductContext {
  return {
    surface,
    defaultAgentName: overrides.defaultAgentName ?? MINIMAX_CODE_DEFAULT_AGENT_NAME,
  };
}
