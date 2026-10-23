/**
 * Workspace path boundary (desktop local version). Local tools must pass this check before fs
 * access to prevent the LLM escaping the working directory with `..`, absolute paths, or symlinks.
 *
 * NOTE(shared-logic): Equivalent to `../cloud/matrix-tools/path-guard.ts`. Each side currently
 * keeps a copy to preserve local / cloud tool directory isolation (AGENTS.md §1), so the two must
 * be changed together. The real-path resolution both copies now use lives in
 * `../shared/workspace-real-path.ts` — one implementation, so the copies cannot drift apart on
 * the part that decides whether a symlink escapes.
 */

import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { isInsideDirectory, resolveRealPath } from '../shared/workspace-real-path.js';

async function assertWithinWorkspace(absolutePath: string, workspaceRoot: string): Promise<void> {
  const rootReal = await realpath(workspaceRoot);

  // `resolveRealPath` follows symlinks — dangling ones included. A plain
  // `realpath` walk treated a dangling link as a missing file and compared the
  // lexical spelling, so a link pointing outside the workspace passed.
  const targetReal = await resolveRealPath(absolutePath);
  if (targetReal === undefined || !isInsideDirectory(rootReal, targetReal)) {
    throw new Error(`Workspace path escapes local runtime root: ${absolutePath}`);
  }
}

/**
 * Resolve a user-supplied, possibly relative path to an absolute path within the workspace
 * boundary. Return the `path.resolve` result for direct fs use.
 */
export async function resolveWithinWorkspace(
  inputPath: string,
  workspaceRoot: string,
): Promise<string> {
  const abs = isAbsolute(inputPath) ? inputPath : resolve(workspaceRoot, inputPath);
  await assertWithinWorkspace(abs, workspaceRoot);
  return abs;
}
