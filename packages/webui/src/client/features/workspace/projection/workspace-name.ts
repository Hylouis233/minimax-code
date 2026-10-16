// The workspace business's display rule. The last path segment is what names a
// project, and the fallback copy for "nothing chosen yet" is Chinese product
// copy, not a UI string this layer invents.
//
// It sits in `projection/` rather than in the rail because the rule was filed
// under a module that does not own the concept it describes, and other
// businesses — the composer among them — import it.

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
