/**
 * Read caps for instruction files, shared by the runtime that reads them and by
 * the clients that report the same cap in their UI.
 *
 * Both files are read up to these limits: `AGENTS.md` (global instructions) and
 * the project instructions file. A client that hardcodes its own number
 * disagrees with the server the moment one side changes, so the number lives
 * here and every consumer imports it.
 */

/** Read cap for the global instructions file (`AGENTS.md`). */
export const GLOBAL_INSTRUCTIONS_MAX_BYTES = 32 * 1024; // 32KB

/** Read cap for the project instructions file. */
export const PROJECT_INSTRUCTIONS_MAX_BYTES = 32 * 1024; // 32KB
