/**
 * The agent a surface addresses when the operator names none.
 *
 * A product-level default with several consumers: the terminal client uses it
 * for its product context, and the WebUI's profile-file operations use it as the
 * wire-level default agent name. It lives in this package so both read one
 * definition instead of mirroring the literal.
 */

/** Default agent name for MiniMax Code surfaces. */
export const MINIMAX_CODE_DEFAULT_AGENT_NAME = 'mavis';
