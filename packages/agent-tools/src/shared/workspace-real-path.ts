/**
 * Real-path resolution shared by the workspace boundary checks.
 *
 * The shape follows the turn-diff capture fence
 * (`packages/local-runtime/src/turns/file-changes.ts`, #232): `realpath` the
 * target and, when the target does not exist yet — a write creates a file
 * that is not there — resolve its nearest existing ancestor and re-attach the
 * missing segments.
 *
 * The piece that guard does not have to handle and this one does: the target
 * may be a *dangling* symlink. `realpath` fails on it the same way it fails
 * on a missing file, but a write through a dangling link creates the file it
 * points at, so the link is followed by hand instead of being treated as a
 * missing path. Without that branch a dangling link that points outside the
 * workspace resolves to a path *inside* the workspace and passes the fence.
 *
 * Returns `undefined` when the path cannot be resolved at all — a symlink
 * cycle, a permission error — so the caller refuses the target instead of
 * guessing where it points.
 */

import { readlink, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Symlink hops before the walk gives up (guards against cycles). */
const MAX_REAL_PATH_SYMLINK_HOPS = 32;

/**
 * Resolve a path to the real location the filesystem uses for it, following
 * symlinks — including dangling ones.
 */
export async function resolveRealPath(
  absolutePath: string,
  hops = 0,
): Promise<string | undefined> {
  let candidate = resolve(absolutePath);
  const suffixParts: string[] = [];
  for (;;) {
    try {
      const ancestorReal = await realpath(candidate);
      return suffixParts.length === 0
        ? ancestorReal
        : resolve(ancestorReal, ...suffixParts);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined;
      const link = await readlinkOrUndefined(candidate);
      if (link !== undefined) {
        if (hops >= MAX_REAL_PATH_SYMLINK_HOPS) return undefined;
        const realParent = await realpathOrUndefined(dirname(candidate));
        if (!realParent) return undefined;
        // A relative link is relative to the directory that holds it, which
        // is the *real* directory when the link sits in a symlinked one.
        const followed = isAbsolute(link) ? resolve(link) : resolve(realParent, link);
        const resolved = await resolveRealPath(followed, hops + 1);
        if (!resolved) return undefined;
        return suffixParts.length ? resolve(resolved, ...suffixParts) : resolved;
      }
      const parent = dirname(candidate);
      if (parent === candidate) return undefined;
      suffixParts.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * Whether `candidate` is `root` itself or a path inside it.
 *
 * The comparison is `path.relative`-based, and it is case-insensitive on
 * Windows, where the filesystem is.
 */
export function isInsideDirectory(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

export async function realpathOrUndefined(target: string): Promise<string | undefined> {
  try {
    return await realpath(target);
  } catch {
    return undefined;
  }
}

async function readlinkOrUndefined(target: string): Promise<string | undefined> {
  try {
    return await readlink(target);
  } catch {
    return undefined;
  }
}
