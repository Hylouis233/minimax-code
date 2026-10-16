export type WebuiRoute = "archon" | "404";

export function route(pathname: string): WebuiRoute {
  if (pathname === "/archon" || pathname === "/") return "archon";
  return "404";
}

/**
 * The session deep link's hash. It lives next to `route()` because it is the
 * other half of the same route shape: `readSessionIdFromHash`
 * (`client/bindings/navigation.ts`) parses what this builds, so the two must
 * agree on the key.
 *
 * It was declared in `SessionRail.tsx`, which was its only caller while the rail
 * was the only surface that could navigate to a session. The shell navigates too
 * (a created/imported session, a subagent), so it lives in the module that owns
 * the route.
 */
export function sessionHash(sessionId: string): string {
  const params = new URLSearchParams();
  params.set("session", sessionId);
  return `#${params.toString()}`;
}
