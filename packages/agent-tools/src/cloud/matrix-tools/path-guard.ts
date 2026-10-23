/**
 * Workspace path boundary (cloud version). Cloud tools must pass this check before fs access to
 * prevent the LLM escaping the working directory with `..`, absolute paths, or symlinks.
 *
 * NOTE(shared-logic): Equivalent to `../../desktop/path-guard.ts`. Each side currently keeps a
 * copy to preserve local / cloud tool directory isolation (AGENTS.md §1), so the two must be
 * changed together. The real-path resolution both copies now use lives in
 * `../../shared/workspace-real-path.ts` — one implementation, so the copies cannot drift apart on
 * the part that decides whether a symlink escapes.
 */

import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { isInsideDirectory, resolveRealPath } from '../../shared/workspace-real-path.js';

/**
 * Input-path fence scope. A plain string keeps the legacy workspace-only
 * behavior; the object form additionally allows *input* paths under
 * `extraInputRoots` (e.g. the local-runtime dataDir assets subtree where
 * registered attachments live). Output paths never consult the extra roots —
 * use `workspaceRootOf()` for the write-side fence.
 */
export type MatrixPathScope =
  | string
  | {
      readonly workspaceRoot: string;
      readonly extraInputRoots?: readonly string[];
    };

export function workspaceRootOf(scope: MatrixPathScope): string {
  return typeof scope === 'string' ? scope : scope.workspaceRoot;
}

/** All roots an *input* path may live under, workspace first. */
export function inputRootsOf(scope: MatrixPathScope): readonly string[] {
  if (typeof scope === 'string') return [scope];
  return [scope.workspaceRoot, ...(scope.extraInputRoots ?? [])];
}

/**
 * Resolve an input path against the scope: relative paths resolve against the
 * workspace root only (never an extra root), then the absolute path must fall
 * inside the workspace root or one of the extra input roots. The realpath
 * walk in `assertWithinWorkspace` blocks symlink escapes per root.
 */
export async function resolveInputWithinScope(
  inputPath: string,
  scope: MatrixPathScope,
): Promise<string> {
  const abs = isAbsolute(inputPath) ? inputPath : resolve(workspaceRootOf(scope), inputPath);
  let firstError: unknown;
  for (const root of inputRootsOf(scope)) {
    try {
      await assertWithinWorkspace(abs, root);
      return abs;
    } catch (err) {
      firstError ??= err;
    }
  }
  throw firstError instanceof Error
    ? firstError
    : new Error(`Workspace path escapes Matrix tool root: ${inputPath}`);
}

export async function assertWithinWorkspace(
  absolutePath: string,
  workspaceRoot: string,
): Promise<void> {
  const rootReal = await realpath(workspaceRoot);

  // `resolveRealPath` follows symlinks — dangling ones included. A plain
  // `realpath` walk treated a dangling link as a missing file and compared the
  // lexical spelling, so a link pointing outside the workspace passed.
  const targetReal = await resolveRealPath(absolutePath);
  if (targetReal === undefined || !isInsideDirectory(rootReal, targetReal)) {
    throw new Error(`Workspace path escapes Matrix tool root: ${absolutePath}`);
  }
}

export async function resolveWithinWorkspace(
  inputPath: string,
  workspaceRoot: string,
): Promise<string> {
  const abs = isAbsolute(inputPath) ? inputPath : resolve(workspaceRoot, inputPath);
  await assertWithinWorkspace(abs, workspaceRoot);
  return abs;
}
