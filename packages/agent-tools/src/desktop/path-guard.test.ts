import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveWithinWorkspace } from './path-guard.js';

/**
 * The desktop path guard has to hold for symlinks, not just for `..` and
 * absolute paths: a link inside the workspace that points outside it is the
 * shape an escape actually takes.
 */
describe('desktop workspace path guard', () => {
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'path-guard-ws-'));
    outside = await mkdtemp(join(tmpdir(), 'path-guard-out-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('rejects a symlink that points outside the workspace', async () => {
    await writeFile(join(outside, 'secret.txt'), 'secret\n');
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escape.txt'));

    await expect(resolveWithinWorkspace('escape.txt', workspace)).rejects.toThrow(
      /escapes local runtime root/,
    );
  });

  it('rejects a dangling symlink that points outside the workspace', async () => {
    await symlink(join(outside, 'not-created-yet.txt'), join(workspace, 'dangling.txt'));

    await expect(resolveWithinWorkspace('dangling.txt', workspace)).rejects.toThrow(
      /escapes local runtime root/,
    );
  });

  it('rejects a path whose parent directory is a symlink pointing outside', async () => {
    await mkdir(join(outside, 'sub'), { recursive: true });
    await symlink(join(outside, 'sub'), join(workspace, 'outdir'));

    await expect(resolveWithinWorkspace('outdir/file.txt', workspace)).rejects.toThrow(
      /escapes local runtime root/,
    );
  });

  it('rejects a lexical escape', async () => {
    await expect(resolveWithinWorkspace('../outside/secret.txt', workspace)).rejects.toThrow(
      /escapes local runtime root/,
    );
  });

  it('allows a symlink that points inside the workspace', async () => {
    await writeFile(join(workspace, 'real.txt'), 'inside\n');
    await symlink(join(workspace, 'real.txt'), join(workspace, 'inside-link.txt'));

    await expect(resolveWithinWorkspace('inside-link.txt', workspace)).resolves.toBe(
      join(workspace, 'inside-link.txt'),
    );
  });

  it('allows a dangling symlink that points inside the workspace', async () => {
    await symlink(join(workspace, 'not-created-yet.txt'), join(workspace, 'inside-dangling.txt'));

    await expect(resolveWithinWorkspace('inside-dangling.txt', workspace)).resolves.toBe(
      join(workspace, 'inside-dangling.txt'),
    );
  });

  it('allows a workspace root that is itself a symlink', async () => {
    await writeFile(join(workspace, 'real.txt'), 'inside\n');
    const alias = join(outside, 'ws-alias');
    await symlink(workspace, alias);

    await expect(resolveWithinWorkspace('real.txt', alias)).resolves.toBe(join(alias, 'real.txt'));
  });
});
