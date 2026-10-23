// D-1 follow-up — the turn-diff revert/reapply must not write *through* a
// symlink that leaves the workspace.
//
// `resolveMutationTargetPath` checked containment lexically: it compared the
// resolved target path to the workspace root as a string. A path inside the
// workspace whose final component is a symlink pointing outside the workspace
// passes that check — the string is inside the workspace — and only then
// resolves outside it. `fs.writeFile` follows the link, so the revert wrote
// into a file outside the workspace.
//
// The fix resolves the *real* path of the target (symlinks included, missing
// tails attached to the nearest existing ancestor) and compares it with the
// *real* path of the workspace root, so the containment check follows the same
// path the write follows.
//
// Note on the conflict precheck: it reads the target through the same path,
// so on the OLD code this fixture reached the write loop with a passing
// conflict check — which is what makes "the file outside the workspace was
// rewritten" a real assertion rather than a vacuous one.
//
// Symlink creation needs privileges on Windows, so the whole suite skips
// there; the lexical refusals stay covered by `diff-mutation-precheck.test.ts`,
// which runs on every platform.

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  LocalTurnDiffRecord,
  LocalTurnDiffSnapshotEntry,
  LocalTurnDiffUndoEntry,
} from '../../src/persistence/ports.js';
import { applyLocalTurnDiffSnapshotMutation } from '../../src/turns/file-changes.js';

let root: string;
let workspaceDir: string;
let outsideDir: string;
let outsideFile: string;

/** The hash `snapshotCapturedFile` computes for a small text file. */
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function snapshot(file: string, content: string): LocalTurnDiffSnapshotEntry {
  return { file, exists: true, hash: contentHash(content), content };
}

function undoEntry(
  file: string,
  before: LocalTurnDiffSnapshotEntry,
  after: LocalTurnDiffSnapshotEntry,
): LocalTurnDiffUndoEntry {
  return { file, before, after };
}

function record(
  undo: readonly LocalTurnDiffUndoEntry[],
  workspace = workspaceDir,
): LocalTurnDiffRecord {
  return {
    changeSetId: 'changes-1',
    sessionId: 'test-session',
    turnId: 'turn-1',
    workspaceDir: workspace,
    capturedAtMs: 1_700_000_000_000,
    status: 'active',
    fileChanges: [],
    undo: [...undo],
    undoable: true,
  };
}

async function read(file: string): Promise<string> {
  return readFile(path.join(workspaceDir, file), 'utf8');
}

beforeEach(async () => {
  // `realpath` so the fixture root is the canonical path: on macOS the
  // temporary directory itself sits behind a symlink, and a fixture that
  // mixes the two spellings would not say anything about containment.
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mcode-diff-symlink-')));
  workspaceDir = path.join(root, 'workspace');
  outsideDir = path.join(root, 'outside');
  outsideFile = path.join(outsideDir, 'secret.txt');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(workspaceDir, 'one.ts'), 'one-v1');
  await writeFile(outsideFile, 'outside-v1');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 4 });
});

describe.skipIf(process.platform === 'win32')(
  'applyLocalTurnDiffSnapshotMutation symlink containment',
  () => {
    it('refuses a revert that would write through a symlink pointing outside the workspace', async () => {
      // The reported defect: `link.txt` lives inside the workspace, but it is
      // a symlink to a file outside it. The lexical containment check accepts
      // the path, and the OLD code then wrote the pre-turn content straight
      // through the link into `outside/secret.txt`.
      await symlink(outsideFile, path.join(workspaceDir, 'link.txt'));

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry(
            'link.txt',
            snapshot('link.txt', 'outside-v0'),
            snapshot('link.txt', 'outside-v1'),
          ),
        ]),
        'revert',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      // The file outside the workspace still holds its post-turn content.
      expect(await readFile(outsideFile, 'utf8')).toBe('outside-v1');
      // The link itself is left alone: a refusal touches nothing on disk.
      expect(await read('link.txt')).toBe('outside-v1');
    });

    it('refuses a reapply that would write through the same symlink', async () => {
      // `revert` and `reapply` are the same operation with the two snapshots
      // swapped, and the containment check reads the entry's path — not the
      // action — so the refusal has to be the same on both.
      await symlink(outsideFile, path.join(workspaceDir, 'link.txt'));

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry(
            'link.txt',
            snapshot('link.txt', 'outside-v0'),
            snapshot('link.txt', 'outside-v1'),
          ),
        ]),
        'reapply',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      expect(await readFile(outsideFile, 'utf8')).toBe('outside-v1');
    });

    it('refuses a revert that would write through a symlinked directory pointing outside', async () => {
      // The escape does not have to be the final path component: a symlinked
      // directory inside the workspace carries the write out of it just the
      // same.
      await symlink(outsideDir, path.join(workspaceDir, 'dir-link'), 'dir');

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry(
            'dir-link/secret.txt',
            snapshot('dir-link/secret.txt', 'outside-v0'),
            snapshot('dir-link/secret.txt', 'outside-v1'),
          ),
        ]),
        'revert',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      expect(await readFile(outsideFile, 'utf8')).toBe('outside-v1');
    });

    it('refuses a dangling symlink pointing outside the workspace', async () => {
      // The link target does not exist, so there is nothing to read — but
      // `fs.writeFile` would create it, outside the workspace. A containment
      // check that only looks at existing files would miss this.
      const dangling = path.join(outsideDir, 'not-created-yet.txt');
      await symlink(dangling, path.join(workspaceDir, 'dangling.txt'));

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry(
            'dangling.txt',
            snapshot('dangling.txt', 'created-v0'),
            { file: 'dangling.txt', exists: false },
          ),
        ]),
        'revert',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      await expect(readFile(dangling, 'utf8')).rejects.toThrow();
    });

    it('refuses a relative symlink that points outside the workspace', async () => {
      // A relative link is relative to the directory that holds it, so this
      // one leaves the workspace as surely as an absolute link does.
      await symlink(
        path.relative(workspaceDir, outsideFile),
        path.join(workspaceDir, 'relative-link.txt'),
      );

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry(
            'relative-link.txt',
            snapshot('relative-link.txt', 'outside-v0'),
            snapshot('relative-link.txt', 'outside-v1'),
          ),
        ]),
        'revert',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      expect(await readFile(outsideFile, 'utf8')).toBe('outside-v1');
    });

    it('refuses a symlink cycle instead of following it', async () => {
      // The link points at itself. There is no real path to compare, so the
      // target is refused — the containment check never resolves a path it
      // cannot follow to the end.
      await symlink(path.join(workspaceDir, 'cycle.txt'), path.join(workspaceDir, 'cycle.txt'));

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry(
            'cycle.txt',
            snapshot('cycle.txt', 'cycle-v0'),
            snapshot('cycle.txt', 'cycle-v1'),
          ),
        ]),
        'revert',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
    });

    it('still reverts a symlink that points at another file inside the workspace', async () => {
      // The fix must not refuse every symlink: a link that stays inside the
      // workspace is contained, so it reverts like any other file.
      await writeFile(path.join(workspaceDir, 'target.ts'), 'target-v1');
      await symlink(path.join(workspaceDir, 'target.ts'), path.join(workspaceDir, 'link.ts'));

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry(
            'link.ts',
            snapshot('link.ts', 'target-v0'),
            snapshot('link.ts', 'target-v1'),
          ),
        ]),
        'revert',
      );

      expect(result).toEqual({ success: true });
      expect(await readFile(path.join(workspaceDir, 'target.ts'), 'utf8')).toBe('target-v0');
    });

    it('still reverts when the workspace is reached through a symlinked root', async () => {
      // The workspace root itself can be a symlink (a linked checkout, a
      // temporary directory behind `/var` on macOS). The containment check
      // compares real paths on both sides, so a legitimate workspace is not
      // refused for it.
      const realWorkspace = path.join(root, 'real-workspace');
      const alias = path.join(root, 'workspace-alias');
      await mkdir(realWorkspace, { recursive: true });
      await writeFile(path.join(realWorkspace, 'one.ts'), 'one-v1');
      await symlink(realWorkspace, alias, 'dir');

      const result = await applyLocalTurnDiffSnapshotMutation(
        record(
          [
            undoEntry('one.ts', snapshot('one.ts', 'one-v0'), snapshot('one.ts', 'one-v1')),
          ],
          alias,
        ),
        'revert',
      );

      expect(result).toEqual({ success: true });
      expect(await readFile(path.join(realWorkspace, 'one.ts'), 'utf8')).toBe('one-v0');
    });

    it('refuses a revert that escapes through a symlinked workspace root', async () => {
      // The same root alias, but the target leaves the workspace through a
      // symlink inside it: the alias must not launder the escape.
      const realWorkspace = path.join(root, 'real-workspace');
      const alias = path.join(root, 'workspace-alias');
      await mkdir(realWorkspace, { recursive: true });
      await writeFile(path.join(realWorkspace, 'one.ts'), 'one-v1');
      await symlink(realWorkspace, alias, 'dir');
      await symlink(outsideFile, path.join(realWorkspace, 'link.txt'));

      const result = await applyLocalTurnDiffSnapshotMutation(
        record(
          [
            undoEntry(
              'link.txt',
              snapshot('link.txt', 'outside-v0'),
              snapshot('link.txt', 'outside-v1'),
            ),
          ],
          alias,
        ),
        'revert',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      expect(await readFile(outsideFile, 'utf8')).toBe('outside-v1');
    });

    it('refuses the whole run, so a safe file in the same record is not written either', async () => {
      // The mutation is all-or-nothing: one unsafe target refuses the run
      // before the first write, so the contained file in the same record
      // keeps its post-turn content.
      await symlink(outsideFile, path.join(workspaceDir, 'link.txt'));

      const result = await applyLocalTurnDiffSnapshotMutation(
        record([
          undoEntry('one.ts', snapshot('one.ts', 'one-v0'), snapshot('one.ts', 'one-v1')),
          undoEntry(
            'link.txt',
            snapshot('link.txt', 'outside-v0'),
            snapshot('link.txt', 'outside-v1'),
          ),
        ]),
        'revert',
      );

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      expect(await read('one.ts')).toBe('one-v1');
      expect(await readFile(outsideFile, 'utf8')).toBe('outside-v1');
    });
  },
);
