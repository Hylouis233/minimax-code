/**
 * Context-window usage reads, shared by the composer and the stream loop.
 *
 * Both callers ask the same question — "what is the context usage for what
 * the user can see right now" — and both need the same answer when the
 * message page carries a server snapshot: prefer it, fall back to the newest
 * message that reported usage, and never invent a value when neither exists.
 */

/** Newest message that carried a context usage, searching from the end. */
export function latestContextUsage(
  messages: readonly { readonly contextUsage?: Record<string, unknown> }[],
): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const contextUsage = messages[index]?.contextUsage;
    if (contextUsage) return contextUsage;
  }
  return undefined;
}

/** The `usage` object of a server context snapshot, when it is well shaped. */
export function readContextUsageSnapshot(
  snapshot: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const usage = snapshot?.usage;
  return usage && typeof usage === "object" && !Array.isArray(usage)
    ? usage as Record<string, unknown>
    : undefined;
}
