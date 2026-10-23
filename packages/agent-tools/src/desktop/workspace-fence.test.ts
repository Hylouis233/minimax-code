import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPluginHookCompatibleToolResponse } from '../plugin-hooks/vendor-tool-response.js';
import { LocalEditTool, LocalReadTool, LocalWriteTool } from './local-pi-tools.js';

const context = { sessionId: 'workspace-fence-session', turnId: 'workspace-fence-turn' };

const OUTSIDE_SECRET = 'TOP-SECRET-OUTSIDE\n';

/**
 * The desktop fs tools resolve their target lexically and hand that spelling
 * to pi, so a symlink inside the workspace used to reach out of it — and the
 * permission layer could not see it, because it compares paths lexically too.
 *
 * The fence closes that. These tests pin both halves of it: the escape is
 * refused, and everything that legitimately lives inside the workspace keeps
 * working — including the paths that are symlinks.
 */
describe('desktop workspace fence', () => {
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'workspace-fence-ws-'));
    outside = await mkdtemp(join(tmpdir(), 'workspace-fence-out-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  async function fileExists(path: string): Promise<boolean> {
    try {
      await readFile(path, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  it('refuses to read a file the workspace symlinks to', async () => {
    await writeFile(join(outside, 'secret.txt'), OUTSIDE_SECRET);
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escape.txt'));

    const result = await new LocalReadTool(workspace).execute(context, { path: 'escape.txt' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('outside the workspace');
    expect(result.text).not.toContain('TOP-SECRET-OUTSIDE');
  });

  it('refuses to write through a symlinked directory', async () => {
    await symlink(outside, join(workspace, 'outlink'));

    const result = await new LocalWriteTool(workspace).execute(context, {
      path: 'outlink/pwned.txt',
      content: 'PWNED-BY-AGENT\n',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('outside the workspace');
    expect(await fileExists(join(outside, 'pwned.txt'))).toBe(false);
  });

  it('refuses to edit a file the workspace symlinks to', async () => {
    await writeFile(join(outside, 'target.ts'), 'const value = 1;\n');
    await symlink(join(outside, 'target.ts'), join(workspace, 'target.ts'));

    const result = await new LocalEditTool(workspace).execute(context, {
      file_path: 'target.ts',
      old_string: 'const value = 1;',
      new_string: 'const value = 99;',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('outside the workspace');
    expect(await readFile(join(outside, 'target.ts'), 'utf8')).toBe('const value = 1;\n');
  });

  it('refuses to write through a dangling symlink that points outside', async () => {
    await symlink(join(outside, 'created-by-dangling.txt'), join(workspace, 'dangling.txt'));

    const result = await new LocalWriteTool(workspace).execute(context, {
      path: 'dangling.txt',
      content: 'PWNED-BY-AGENT\n',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('outside the workspace');
    expect(await fileExists(join(outside, 'created-by-dangling.txt'))).toBe(false);
  });

  it('refuses to read through a directory symlink that points outside', async () => {
    await mkdir(join(outside, 'sub'), { recursive: true });
    await writeFile(join(outside, 'sub', 'secret.txt'), OUTSIDE_SECRET);
    await symlink(join(outside, 'sub'), join(workspace, 'outdir'));

    const result = await new LocalReadTool(workspace).execute(context, {
      path: 'outdir/secret.txt',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('outside the workspace');
    expect(result.text).not.toContain('TOP-SECRET-OUTSIDE');
  });

  it('still reads a symlink that points inside the workspace', async () => {
    await writeFile(join(workspace, 'real.txt'), 'inside the workspace\n');
    await symlink(join(workspace, 'real.txt'), join(workspace, 'inside-link.txt'));

    const result = await new LocalReadTool(workspace).execute(context, {
      path: 'inside-link.txt',
    });

    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('inside the workspace');
  });

  it('still writes and edits through a symlink that points inside the workspace', async () => {
    await writeFile(join(workspace, 'real.ts'), 'const value = 1;\n');
    await symlink(join(workspace, 'real.ts'), join(workspace, 'inside-link.ts'));

    const write = await new LocalWriteTool(workspace).execute(context, {
      path: 'inside-link.ts',
      content: 'const value = 7;\n',
    });
    expect(write.isError).toBeUndefined();
    expect(await readFile(join(workspace, 'real.ts'), 'utf8')).toBe('const value = 7;\n');

    const edit = await new LocalEditTool(workspace).execute(context, {
      file_path: 'inside-link.ts',
      old_string: 'const value = 7;',
      new_string: 'const value = 8;',
    });
    expect(edit.isError).toBeUndefined();
    expect(await readFile(join(workspace, 'real.ts'), 'utf8')).toBe('const value = 8;\n');
  });

  it('still works when the workspace root is itself a symlink', async () => {
    await writeFile(join(workspace, 'real.txt'), 'inside the workspace\n');
    const alias = join(outside, 'ws-alias');
    await symlink(workspace, alias);

    const read = await new LocalReadTool(alias).execute(context, { path: 'real.txt' });
    expect(read.isError).toBeUndefined();
    expect(read.text).toContain('inside the workspace');

    const write = await new LocalWriteTool(alias).execute(context, {
      path: 'written.txt',
      content: 'written through the alias\n',
    });
    expect(write.isError).toBeUndefined();
    expect(await readFile(join(workspace, 'written.txt'), 'utf8')).toBe(
      'written through the alias\n',
    );
  });

  it('keeps ordinary in-workspace read, write and edit working', async () => {
    await writeFile(join(workspace, 'subject.ts'), 'const value = 1;\n');

    const read = await new LocalReadTool(workspace).execute(context, { path: 'subject.ts' });
    expect(read.isError).toBeUndefined();
    expect(read.text).toContain('const value = 1;');

    const write = await new LocalWriteTool(workspace).execute(context, {
      path: 'created.ts',
      content: 'const created = true;\n',
    });
    expect(write.isError).toBeUndefined();
    expect(await readFile(join(workspace, 'created.ts'), 'utf8')).toBe('const created = true;\n');

    const edit = await new LocalEditTool(workspace).execute(context, {
      file_path: 'subject.ts',
      old_string: 'const value = 1;',
      new_string: 'const value = 2;',
    });
    expect(edit.isError).toBeUndefined();
    expect(await readFile(join(workspace, 'subject.ts'), 'utf8')).toBe('const value = 2;\n');
  });

  it('keeps the path pi receives lexical, not realpath-ed', async () => {
    await writeFile(join(workspace, 'real.ts'), 'const value = 1;\n');
    await symlink(join(workspace, 'real.ts'), join(workspace, 'inside-link.ts'));

    const result = await new LocalEditTool(workspace).execute(context, {
      file_path: 'inside-link.ts',
      old_string: 'const value = 1;',
      new_string: 'const value = 2;',
    });

    // The ledger key has to stay byte-for-byte aligned with pi's own
    // `resolveToCwd` output, so the capture reports the lexical spelling.
    expect(readPluginHookCompatibleToolResponse(result)?.filePath).toBe(
      join(workspace, 'inside-link.ts'),
    );
  });
});
