/**
 * Workspace fence for the desktop fs tools (`read` / `write` / `edit`).
 *
 * Why this exists: the desktop tools resolve their target lexically
 * (`path.resolve` against the workspace root) and hand that spelling to pi,
 * which opens it as-is. A symlink inside the workspace therefore turns any
 * tool call into a read or a write outside the workspace — and the
 * permission layer cannot see it, because it compares paths lexically too.
 *
 * What it does: resolve the *real* location of the target (following
 * symlinks, dangling ones included — see `../shared/workspace-real-path.ts`)
 * and require it to sit inside the workspace.
 *
 * What it deliberately does NOT do:
 *
 *   - It does not change the path spelling that reaches pi. The fence only
 *     validates; pi still receives the lexical absolute path, byte for byte,
 *     because the ledger key must stay aligned with pi's own `resolveToCwd`
 *     output (see `normalizeLocalExistingPath` in `local-pi-tools.ts`).
 *   - It does not take over the permission layer's job for targets that are
 *     *already* outside the workspace lexically (`/etc/passwd`, `~/notes`,
 *     `../../elsewhere`). Those keep their existing approval flow — the
 *     permission layer asks the user before the tool runs. Turning that
 *     approval into a hard failure would break cross-workspace reads users
 *     approve today; the hole this fence closes is the one where the
 *     permission layer does not even get to ask.
 */

import { resolve } from 'node:path';

import { isInsideDirectory, realpathOrUndefined, resolveRealPath } from '../shared/workspace-real-path.js';

/**
 * Check the given absolute paths against the workspace fence.
 *
 * Returns `undefined` when every path is acceptable, or a message describing
 * the first violation. The message is written for the model: it names the
 * path the tool asked for and the place it really points at.
 */
export async function findWorkspaceFenceViolation(
  absolutePaths: readonly string[],
  workspaceRoot: string,
): Promise<string | undefined> {
  const lexicalRoot = resolve(workspaceRoot);

  // Only the targets the workspace *claims* are this fence's business. A
  // target that is already outside the workspace lexically belongs to the
  // permission layer, which asks the user for approval before the tool runs.
  const claimed = absolutePaths
    .map((candidate) => resolve(candidate))
    .filter((candidate) => isInsideDirectory(lexicalRoot, candidate));
  if (claimed.length === 0) return undefined;

  const rootReal = await realpathOrUndefined(lexicalRoot);
  if (rootReal === undefined) {
    return (
      `Workspace path blocked: the workspace root ${workspaceRoot} cannot be resolved, ` +
      `so ${claimed[0]} cannot be checked against it.`
    );
  }

  for (const candidate of claimed) {
    const targetReal = await resolveRealPath(candidate);
    if (targetReal === undefined) {
      return (
        `Workspace path blocked: the real location of ${candidate} cannot be resolved ` +
        `(symlink loop or unreadable path), so it cannot be checked against the workspace.`
      );
    }
    if (!isInsideDirectory(rootReal, targetReal)) {
      return (
        `Workspace path blocked: ${candidate} resolves to ${targetReal}, which is outside ` +
        `the workspace (${rootReal}). Only paths inside the workspace can be read or written.`
      );
    }
  }
  return undefined;
}
