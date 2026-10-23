// D-1 follow-up — the turn-diff *capture* must not read the content of a
// file outside the workspace through a symlink.
//
// The write side of the same hole is closed by PR #232: the mutation refuses
// a target whose real path leaves the workspace. The read side was still
// lexical. `snapshotCapturedFile` resolved the captured path with
// `path.resolve` and then read it with `fs.stat`/`fs.open`, and both of
// those follow symlinks. A path inside the workspace whose final component
// is a symlink to a file outside it passes the lexical check — the string is
// inside the workspace — and only then resolves outside it. The capture
// therefore put the *content* of a file outside the workspace into the
// turn-diff record, and from there into the database and into the WebUI
// review panel.
//
// The fixtures below drive the real capture service over the real SQLite
// store, so the assertions are about what actually lands in the persisted
// record — not about an internal helper's return value.
//
// Symlink creation needs privileges on Windows, so the whole suite skips
// there.

import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeLocalRuntimeDb } from '../../src/persistence/db.js';
import type { LocalTurnDiffRecord } from '../../src/persistence/ports.js';
import { SqliteLocalTurnDiffStore } from '../../src/persistence/sqlite-persistence.js';
import type { LocalSessionRecord } from '../../src/sessions/controller.js';
import { LocalTurnFileChangeCaptureService } from '../../src/turns/file-changes.js';

const SESSION_ID = 'test-session';
const TURN_ID = 'turn-1';
const ASSISTANT_MESSAGE_ID = 'msg-1';
/** A sentinel that appears nowhere else, so "the content leaked" is exact. */
const OUTSIDE_V1 = 'outside-secret-v1\n';
const OUTSIDE_V2 = 'outside-secret-v2-with-a-different-length\n';

let root: string;
let workspaceDir: string;
let outsideDir: string;
let outsideFile: string;
let dataDir: string;
let store: SqliteLocalTurnDiffStore;
let service: LocalTurnFileChangeCaptureService;
let idCounter: number;

/**
 * Run one turn's worth of capture over the real store and return the
 * persisted record.
 *
 * The mutation between the two snapshots stands in for the agent's write:
 * the capture reads the file *before* the tool runs and again *after* it.
 */
async function captureTurn(
  filePath: string,
  mutate: () => Promise<void>,
  workspace: string = workspaceDir,
): Promise<LocalTurnDiffRecord | undefined> {
  const session = {
    sessionId: SESSION_ID,
    agentName: 'test-agent',
    workspaceDir: workspace,
  } as LocalSessionRecord;
  await service.begin(session, TURN_ID);
  await service.captureToolUseStart({
    sessionId: SESSION_ID,
    toolName: 'write',
    toolCallId: 'call-1',
    toolArgs: { file_path: filePath },
  });
  await mutate();
  await service.captureToolUseFinish({
    sessionId: SESSION_ID,
    toolName: 'write',
    toolCallId: 'call-1',
    toolArgs: { file_path: filePath },
  });
  await service.finalizeLatestPending(SESSION_ID, { assistantMessageId: ASSISTANT_MESSAGE_ID });
  return store.getByTurn(SESSION_ID, TURN_ID);
}

/** The undo entry the capture recorded for one path. */
function undoEntry(record: LocalTurnDiffRecord | undefined, file: string) {
  return record?.undo.find((entry) => entry.file === file);
}

beforeEach(async () => {
  // `realpath` so the fixture root is the canonical path: on macOS the
  // temporary directory itself sits behind a symlink, and a fixture that
  // mixes the two spellings would not say anything about containment.
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mcode-diff-capture-')));
  workspaceDir = path.join(root, 'workspace');
  outsideDir = path.join(root, 'outside');
  outsideFile = path.join(outsideDir, 'secret.txt');
  dataDir = path.join(root, 'data');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(workspaceDir, 'inside.ts'), 'inside-v1\n');
  await writeFile(outsideFile, OUTSIDE_V1);
  idCounter = 0;
  store = new SqliteLocalTurnDiffStore(dataDir);
  service = new LocalTurnFileChangeCaptureService(store, {
    nowMs: () => 1_700_000_000_000,
    makeId: (prefix) => `${prefix}-${(idCounter += 1)}`,
  });
});

afterEach(async () => {
  closeLocalRuntimeDb(dataDir);
  await rm(root, { recursive: true, force: true, maxRetries: 4 });
});

describe.skipIf(process.platform === 'win32')(
  'turn-diff capture symlink containment',
  () => {
    it('does not capture the content of a file outside the workspace reached through a symlink', async () => {
      // The reported defect: `link.txt` lives inside the workspace, but it
      // is a symlink to a file outside it. The OLD code read the link's
      // target and put its content into the turn-diff record.
      await symlink(outsideFile, path.join(workspaceDir, 'link.txt'));

      const record = await captureTurn('link.txt', async () => {
        // The agent's write lands outside the workspace, through the link.
        await writeFile(outsideFile, OUTSIDE_V2);
      });

      expect(record).toBeDefined();
      // Nothing of the file outside the workspace reaches the record.
      expect(JSON.stringify(record)).not.toContain('outside-secret');
      const entry = undoEntry(record, 'link.txt');
      expect(entry?.before.content).toBeUndefined();
      expect(entry?.after.content).toBeUndefined();
      // The path itself is still recorded: the turn did touch it, and the
      // review panel should say so even though it cannot show the content.
      expect(entry?.before.exists).toBe(true);
      expect(entry?.after.exists).toBe(true);
      // The outside file is untouched by the capture itself.
      expect(await readFile(outsideFile, 'utf8')).toBe(OUTSIDE_V2);
    });

    it('does not capture the content of a file outside the workspace reached through a symlinked directory', async () => {
      // The escape does not have to be the final path component: a symlinked
      // directory inside the workspace carries the read out of it just the
      // same.
      await symlink(outsideDir, path.join(workspaceDir, 'dir-link'), 'dir');

      const record = await captureTurn('dir-link/secret.txt', async () => {
        await writeFile(outsideFile, OUTSIDE_V2);
      });

      expect(record).toBeDefined();
      expect(JSON.stringify(record)).not.toContain('outside-secret');
      const entry = undoEntry(record, 'dir-link/secret.txt');
      expect(entry?.before.content).toBeUndefined();
      expect(entry?.after.content).toBeUndefined();
    });

    it('does not capture the content of a file outside the workspace reached through a relative symlink', async () => {
      // A relative link is relative to the directory that holds it, so this
      // one leaves the workspace as surely as an absolute link does.
      await symlink(
        path.relative(workspaceDir, outsideFile),
        path.join(workspaceDir, 'relative-link.txt'),
      );

      const record = await captureTurn('relative-link.txt', async () => {
        await writeFile(outsideFile, OUTSIDE_V2);
      });

      expect(record).toBeDefined();
      expect(JSON.stringify(record)).not.toContain('outside-secret');
      expect(undoEntry(record, 'relative-link.txt')?.after.content).toBeUndefined();
    });

    it('still captures a file inside the workspace', async () => {
      // The positive control: the containment check must not stop the
      // capture from doing its job.
      const record = await captureTurn('inside.ts', async () => {
        await writeFile(path.join(workspaceDir, 'inside.ts'), 'inside-v2\n');
      });

      expect(record).toBeDefined();
      const entry = undoEntry(record, 'inside.ts');
      expect(entry?.before.content).toBe('inside-v1\n');
      expect(entry?.after.content).toBe('inside-v2\n');
      expect(record?.fileChanges[0]?.diff).toContain('inside-v2');
    });

    it('still captures a symlink that points at another file inside the workspace', async () => {
      // The fix must not refuse every symlink: a link that stays inside the
      // workspace is contained, so it is captured like any other file.
      await writeFile(path.join(workspaceDir, 'target.ts'), 'target-v1\n');
      await symlink(path.join(workspaceDir, 'target.ts'), path.join(workspaceDir, 'link.ts'));

      const record = await captureTurn('link.ts', async () => {
        await writeFile(path.join(workspaceDir, 'target.ts'), 'target-v2\n');
      });

      expect(record).toBeDefined();
      const entry = undoEntry(record, 'link.ts');
      expect(entry?.before.content).toBe('target-v1\n');
      expect(entry?.after.content).toBe('target-v2\n');
    });

    it('still captures through a workspace reached through a symlinked root', async () => {
      // The workspace root itself can be a symlink (a linked checkout, a
      // temporary directory behind `/var` on macOS). The containment check
      // compares real paths on both sides, so a legitimate workspace is not
      // refused for it.
      const realWorkspace = path.join(root, 'real-workspace');
      const alias = path.join(root, 'workspace-alias');
      await mkdir(realWorkspace, { recursive: true });
      await writeFile(path.join(realWorkspace, 'inside.ts'), 'inside-v1\n');
      await symlink(realWorkspace, alias, 'dir');

      const record = await captureTurn(
        'inside.ts',
        async () => {
          await writeFile(path.join(realWorkspace, 'inside.ts'), 'inside-v2\n');
        },
        alias,
      );

      expect(record).toBeDefined();
      const entry = undoEntry(record, 'inside.ts');
      expect(entry?.before.content).toBe('inside-v1\n');
      expect(entry?.after.content).toBe('inside-v2\n');
    });
  },
);
