/**
 * Provider ids that appear in more than one layer of the product.
 *
 * They are wire and config facts — a provider entry's key, and the prefix a
 * custom provider's key carries — so the runtime that writes them, the clients
 * that read them and the UI that groups models by them all have to agree. The
 * definitions live here because this is the one package every one of those
 * layers can import: `@mavis/config` re-exports them for its own consumers, and
 * a browser-side module can import this file directly.
 */

/** The managed MiniMax provider's key. */
export const MANAGED_MINIMAX_PROVIDER_ID = 'minimax';

/** The provider key an operator's own MiniMax API key is stored under. */
export const MINIMAX_API_PROVIDER_ID = 'minimax_api';

/** Prefix of a user-defined provider's key (`custom_provider:<name>`). */
export const CUSTOM_PROVIDER_ID_PREFIX = 'custom_provider:';
