import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveWorkspacePath, resolveWorkspaceWritePath } from './workspace-path.js';

/**
 * The write path resolves the target's *real* location. A symlink inside the
 * workspace that points outside it has to be refused — including a dangling
 * one, which `realpath` cannot resolve and which used to fall back to the
 * lexical spelling (a path inside the workspace) and pass.
 */
describe('workspace write path boundary', () => {
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'workspace-path-ws-'));
    outside = await mkdtemp(join(tmpdir(), 'workspace-path-out-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('refuses a write through a symlink that points outside the workspace', async () => {
    await writeFile(join(outside, 'target.txt'), 'outside\n');
    await symlink(join(outside, 'target.txt'), join(workspace, 'escape.txt'));

    await expect(resolveWorkspaceWritePath(workspace, 'escape.txt')).resolves.toBeUndefined();
  });

  it('refuses a write through a dangling symlink that points outside the workspace', async () => {
    await symlink(join(outside, 'not-created-yet.txt'), join(workspace, 'dangling.txt'));

    await expect(resolveWorkspaceWritePath(workspace, 'dangling.txt')).resolves.toBeUndefined();
  });

  it('refuses a write whose parent directory is a symlink pointing outside', async () => {
    await symlink(outside, join(workspace, 'outdir'));

    await expect(resolveWorkspaceWritePath(workspace, 'outdir/pwned.txt')).resolves.toBeUndefined();
  });

  it('allows a write through a symlink that points inside the workspace', async () => {
    await writeFile(join(workspace, 'real.txt'), 'inside\n');
    await symlink(join(workspace, 'real.txt'), join(workspace, 'inside-link.txt'));

    // The write path resolves the parent directory for real, so the returned
    // path is the real parent plus the requested name.
    await expect(resolveWorkspaceWritePath(workspace, 'inside-link.txt')).resolves.toBe(
      join(await realpath(workspace), 'inside-link.txt'),
    );
  });

  it('allows a write to a new file inside the workspace', async () => {
    await expect(resolveWorkspaceWritePath(workspace, 'created.txt')).resolves.toBe(
      join(await realpath(workspace), 'created.txt'),
    );
  });

  it('leaves the read path contract alone', async () => {
    await writeFile(join(workspace, 'real.txt'), 'inside\n');
    await symlink(join(workspace, 'real.txt'), join(workspace, 'inside-link.txt'));

    const realWorkspace = await realpath(workspace);
    await expect(resolveWorkspacePath(workspace, 'real.txt')).resolves.toBe(
      join(realWorkspace, 'real.txt'),
    );
    await expect(resolveWorkspacePath(workspace, 'inside-link.txt')).resolves.toBe(
      join(realWorkspace, 'real.txt'),
    );
    await expect(resolveWorkspacePath(workspace, '../outside')).resolves.toBeUndefined();
  });
});
