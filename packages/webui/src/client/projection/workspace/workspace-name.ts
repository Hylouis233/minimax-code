// The workspace business's display rule (plan §5.1.2, §5.6's `sessions` row: it
// "leaves `SessionRail.tsx:144` for `workspace`"). The last path segment is what
// names a project, and the fallback copy for "nothing chosen yet" is Chinese
// product copy, not a UI string this layer invents.
//
// It sits in `projection/` rather than in the rail because it was a rule filed
// under a module that does not own the concept it describes — §5.1.2's
// prohibition, whose recorded instance is exactly this function, imported across
// businesses by the composer. §5.6 sends it to `projection/workspace/`; that
// directory re-file is Phase 4's (§6.1's tree), so the boundary move lands here
// first, as B2 did for the composer's store.

/**
 * The project name a workspace directory displays as: its last path segment, or
 * the "未选项目" copy when nothing is chosen.
 */
export function workspaceProjectName(workspaceDir?: string): string {
  const value = workspaceDir?.trim();
  if (!value) return "未选项目";
  const normalized = value.replace(/[\\/]+$/u, "");
  const parts = normalized.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) || normalized;
}
