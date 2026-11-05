import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Point the app at a REAL SQLite file in a temp dir (no mocks of storage -
// only the paths are redirected so backup/restore exercise actual files).
const { TMP } = vi.hoisted(() => ({
  // vi.hoisted runs before imports - no path/os available; plain concat is fine.
  TMP: `${process.env.TMP ?? process.env.TEMP ?? '/tmp'}/keeparr-backup-test-${process.pid}`,
}));
vi.mock('./config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./config')>();
  return {
    ...orig,
    DATA_DIR: TMP,
    DB_PATH: path.join(TMP, 'keeparr.db'),
  };
});

import { __closeDb, getDb } from './db';
import { upsertMediaBatch, queryLibrary, type UpsertMediaInput } from './queries';
import {
  BACKUP_DIR,
  createBackup,
  deleteBackup,
  isValidBackupName,
  listBackups,
  pruneBackups,
  restoreBackup,
  runBackup,
} from './backup';

const media = (ratingKey: string): UpsertMediaInput => ({
  ratingKey,
  sectionId: '1',
  libraryKind: 'movie',
  title: `Title ${ratingKey}`,
  year: 2020,
  thumb: null,
  sizeBytes: 1024,
  addedAt: 1000,
  guidTmdb: null,
  guidTvdb: null,
  guidImdb: null,
});

const titles = () =>
  queryLibrary({ plexUserId: 'u', limit: 100, offset: 0 })
    .map((r) => r.rating_key)
    .sort();

beforeEach(() => {
  __closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  getDb(); // open the on-disk test db fresh
});

afterAll(() => {
  __closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('isValidBackupName', () => {
  it('accepts the generated shapes only', () => {
    expect(isValidBackupName('keeparr-20260706-193000.db')).toBe(true);
    expect(isValidBackupName('keeparr-20260706-193000-1.db')).toBe(true);
    expect(isValidBackupName('keeparr-pre-restore-20260706-193000.db')).toBe(true);
  });

  it('rejects traversal and arbitrary names', () => {
    expect(isValidBackupName('../keeparr-20260706-193000.db')).toBe(false);
    expect(isValidBackupName('..\\evil.db')).toBe(false);
    expect(isValidBackupName('keeparr-20260706-193000.db/../x')).toBe(false);
    expect(isValidBackupName('foo.db')).toBe(false);
    expect(isValidBackupName('keeparr.db')).toBe(false); // never the live db
  });
});

describe('backup + list + delete', () => {
  it('creates a snapshot file and lists it newest-first', async () => {
    upsertMediaBatch([media('1')]);
    const name = await createBackup();
    expect(isValidBackupName(name)).toBe(true);
    const listed = listBackups();
    expect(listed.map((b) => b.name)).toContain(name);
    expect(listed[0].sizeBytes).toBeGreaterThan(0);
  });

  it('same-second creates get distinct names (no overwrite)', async () => {
    const a = await createBackup();
    const b = await createBackup();
    expect(a).not.toBe(b);
    expect(listBackups()).toHaveLength(2);
  });

  it('deleteBackup removes the file; false when absent', async () => {
    const name = await createBackup();
    expect(deleteBackup(name)).toBe(true);
    expect(deleteBackup(name)).toBe(false);
    expect(listBackups()).toHaveLength(0);
  });
});

describe('restore round-trip', () => {
  it('restores the pre-backup state and leaves a safety-net snapshot', async () => {
    upsertMediaBatch([media('1'), media('2')]);
    const name = await createBackup();

    // Mutate after the backup: add a row.
    upsertMediaBatch([media('3')]);
    expect(titles()).toEqual(['1', '2', '3']);

    const { safetyNet } = await restoreBackup(name);
    expect(titles()).toEqual(['1', '2']); // back to the snapshot
    expect(safetyNet).toMatch(/^keeparr-pre-restore-/);
    // The safety net captured the pre-restore (mutated) state.
    const netPath = path.join(BACKUP_DIR, safetyNet);
    expect(fs.existsSync(netPath)).toBe(true);
  });

  it('the reopened db is fully usable (writes work after restore)', async () => {
    upsertMediaBatch([media('1')]);
    const name = await createBackup();
    await restoreBackup(name);
    upsertMediaBatch([media('9')]);
    expect(titles()).toEqual(['1', '9']);
  });

  it('throws on a missing or invalid name (no traversal)', async () => {
    await expect(restoreBackup('keeparr-19990101-000000.db')).rejects.toThrow(
      /not found/i
    );
    await expect(restoreBackup('../../etc/passwd')).rejects.toThrow(/invalid/i);
  });
});

describe('pruneBackups + runBackup', () => {
  it('keeps only the newest N', async () => {
    const names: string[] = [];
    for (let i = 0; i < 4; i++) names.push(await createBackup());
    // Space out mtimes so "newest" is deterministic.
    names.forEach((n, i) =>
      fs.utimesSync(path.join(BACKUP_DIR, n), new Date(), new Date(Date.now() - (names.length - i) * 60_000))
    );
    const removed = pruneBackups(2);
    expect(removed).toBe(2);
    expect(listBackups().map((b) => b.name)).toEqual([names[3], names[2]]);
  });

  it('runBackup snapshots and prunes to the retention setting', async () => {
    const res = await runBackup();
    expect(res.result).toBe(1);
    expect(res.message).toMatch(/Backed up to keeparr-/);
    expect(listBackups()).toHaveLength(1);
  });
});
