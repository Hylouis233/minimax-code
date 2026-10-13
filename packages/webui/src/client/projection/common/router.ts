export type WebuiRoute = "archon" | "404";

export function route(pathname: string): WebuiRoute {
  if (pathname === "/archon" || pathname === "/") return "archon";
  return "404";
}
