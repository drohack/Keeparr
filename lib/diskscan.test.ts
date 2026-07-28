import { afterEach, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __setTestDbToMemory, __closeDb } from './db';
import { runDiskScan, verifyArrUnmatchedOnDisk } from './diskscan';
import { setStorageMappings } from './settings';
import {
  getArrUnmatched,
  getDiskOrphans,
  replaceArrUnmatched,
  replaceArrItems,
  replaceDiskOrphansForSection,
  sizeMismatchItems,
  upsertMediaBatch,
  type UpsertMediaInput,
} from './queries';

/** Real temp directories + a real in-memory DB — no fs or storage mocks. */

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'keeparr-scan-'));
  roots.push(root);
  return root;
}

function media(ratingKey: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
  return {
    ratingKey,
    sectionId: '1',
    libraryKind: 'show',
    title: `Title ${ratingKey}`,
    year: 2020,
    thumb: null,
    sizeBytes: 1024,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
    dirName: `Show ${ratingKey}`,
    fileName: null,
    ...over,
  };
}

beforeEach(() => {
  __setTestDbToMemory();
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
afterAll(() => __closeDb());

describe('runDiskScan', () => {
  it('no mappings → clean no-op message', async () => {
    const res = await runDiskScan();
    expect(res.result).toBe(0);
    expect(res.message).toContain('No storage mappings');
  });

  it('a fully-known root yields zero orphans (case-insensitive matching)', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'SHOW A')); // case differs from the captured name
    mkdirSync(join(root, 'Show B'));
    upsertMediaBatch([
      media('A', { dirName: 'Show A' }),
      media('B', { dirName: 'Show B' }),
    ]);
    setStorageMappings([{ sectionId: '1', path: root }]);
    const res = await runDiskScan();
    expect(res.result).toBe(0);
    expect(getDiskOrphans()).toEqual([]);
  });

  it('flags unknown dirs (recursively sized) and loose files; skips junk', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Show A'));
    // Orphan dir with nested content: 100 + 50 bytes.
    mkdirSync(join(root, 'Forgotten Show', 'Season 1'), { recursive: true });
    writeFileSync(join(root, 'Forgotten Show', 'Season 1', 'ep1.mkv'), 'x'.repeat(100));
    writeFileSync(join(root, 'Forgotten Show', 'note.txt'), 'x'.repeat(50));
    // Orphan loose file.
    writeFileSync(join(root, 'random.mkv'), 'x'.repeat(25));
    // Junk that must never be flagged.
    mkdirSync(join(root, '@eaDir'));
    writeFileSync(join(root, '.DS_Store'), 'junk');
    // A loose file KNOWN via a movie's fileName.
    writeFileSync(join(root, 'Known Movie.mkv'), 'x'.repeat(10));

    upsertMediaBatch([
      media('A', { dirName: 'Show A' }),
      media('M', { libraryKind: 'movie', dirName: null, fileName: 'Known Movie.mkv' }),
    ]);
    setStorageMappings([{ sectionId: '1', path: root }]);

    const res = await runDiskScan();
    expect(res.result).toBe(2);
    const rows = getDiskOrphans();
    expect(rows.map((r) => r.name)).toEqual(['Forgotten Show', 'random.mkv']); // size DESC
    expect(rows[0]).toMatchObject({ isDir: true, sizeBytes: 150, sizeSkipped: false });
    expect(rows[1]).toMatchObject({ isDir: false, sizeBytes: 25 });
  });

  it('arr folder names (matched AND unmatched) count as known', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Arr Managed Show'));
    mkdirSync(join(root, 'Arr Orphan Show'));
    upsertMediaBatch([media('A', { dirName: 'Show A' })]); // passes the guard
    replaceArrItems([
      {
        ratingKey: 'A', source: 'sonarr', instanceId: 's1', instanceName: 'S',
        arrId: 1, monitored: true, status: 'ended', quality: 'HD', qualityKind: 'profile',
        rootFolder: '/tv', arrSizeBytes: 1, tags: [], folderName: 'Arr Managed Show',
      },
    ]);
    replaceArrUnmatched([
      {
        source: 'sonarr', instanceId: 's1', instanceName: 'S', title: 'Orphan',
        extKind: 'tvdb', extId: '9', sizeBytes: 1, folderName: 'Arr Orphan Show',
      },
    ]);
    setStorageMappings([{ sectionId: '1', path: root }]);
    const res = await runDiskScan();
    expect(res.result).toBe(0);
  });

  it('safety guard: mostly-unnamed sections are skipped and keep prior rows', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Would Be Orphan'));
    // 2 of 3 items unnamed → coverage 33% < 50%.
    upsertMediaBatch([
      media('A', { dirName: null }),
      media('B', { dirName: null }),
      media('C', { dirName: 'Show C' }),
    ]);
    replaceDiskOrphansForSection('1', [
      { name: 'Prior', path: '/x/Prior', isDir: true, sizeBytes: 7, sizeSkipped: false, mtime: 1 },
    ]);
    setStorageMappings([{ sectionId: '1', path: root }]);

    const res = await runDiskScan();
    expect(res.message).toContain('folder names not captured yet');
    expect(getDiskOrphans().map((r) => r.name)).toEqual(['Prior']); // untouched
  });

  it('circuit breaker: a mostly-orphan root records names but skips sizing', async () => {
    const root = makeRoot();
    for (let i = 0; i < 25; i++) {
      mkdirSync(join(root, `Unknown ${i}`));
      writeFileSync(join(root, `Unknown ${i}`, 'big.bin'), 'x'.repeat(500));
    }
    upsertMediaBatch([media('A', { dirName: 'Show A' })]); // guard passes, names just don't match
    setStorageMappings([{ sectionId: '1', path: root }]);

    const res = await runDiskScan();
    expect(res.message).toContain('check this library');
    const rows = getDiskOrphans();
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => r.sizeSkipped && r.sizeBytes === 0)).toBe(true);
  });

  it('an unreadable root keeps its prior rows', async () => {
    upsertMediaBatch([media('A')]);
    replaceDiskOrphansForSection('1', [
      { name: 'Prior', path: '/x/Prior', isDir: true, sizeBytes: 7, sizeSkipped: false, mtime: 1 },
    ]);
    setStorageMappings([{ sectionId: '1', path: join(tmpdir(), 'keeparr-definitely-missing') }]);
    const res = await runDiskScan();
    expect(res.message).toContain('unreadable');
    expect(getDiskOrphans().map((r) => r.name)).toEqual(['Prior']);
  });

  it('verifyArrUnmatchedOnDisk: found folders sized, empty found, missing flagged', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Real Download'));
    writeFileSync(join(root, 'Real Download', 'file.mkv'), 'x'.repeat(120));
    mkdirSync(join(root, 'Empty Husk'));
    upsertMediaBatch([media('A', { dirName: 'Show A' })]); // unrelated
    replaceArrUnmatched([
      {
        source: 'radarr', instanceId: 'r1', instanceName: 'R', title: 'Real',
        extKind: 'tmdb', extId: '1', sizeBytes: 5 * 1024, folderName: 'Real Download',
      },
      {
        source: 'radarr', instanceId: 'r1', instanceName: 'R', title: 'Husk',
        extKind: 'tmdb', extId: '2', sizeBytes: 5 * 1024, folderName: 'Empty Husk',
      },
      {
        source: 'radarr', instanceId: 'r1', instanceName: 'R', title: 'Gone',
        extKind: 'tmdb', extId: '3', sizeBytes: 5 * 1024, folderName: 'Deleted Folder',
      },
    ]);

    // Without mappings: skipped entirely, rows stay unverified.
    expect(await verifyArrUnmatchedOnDisk()).toBeNull();
    expect(getArrUnmatched(false).every((r) => r.onDisk === null)).toBe(true);

    setStorageMappings([{ sectionId: '1', path: root }]);
    const res = await verifyArrUnmatchedOnDisk();
    expect(res).toEqual({ checked: 3, missing: 1 });
    const byTitle = new Map(getArrUnmatched(false).map((r) => [r.title, r]));
    expect(byTitle.get('Real')).toMatchObject({ onDisk: true, diskSizeBytes: 120 });
    expect(byTitle.get('Husk')).toMatchObject({ onDisk: true, diskSizeBytes: 0 });
    expect(byTitle.get('Gone')).toMatchObject({ onDisk: false, diskSizeBytes: null });
  });

  it('runDiskScan measures size-mismatched titles (multi-folder sum + loose file)', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Show A'));
    writeFileSync(join(root, 'Show A', 'e1.mkv'), 'x'.repeat(100));
    mkdirSync(join(root, 'Show A Specials'));
    writeFileSync(join(root, 'Show A Specials', 's1.mkv'), 'x'.repeat(40));
    writeFileSync(join(root, 'Loose Movie.mkv'), 'x'.repeat(70));

    const GB = 1024 ** 3;
    upsertMediaBatch([
      media('sh', { libraryKind: 'show', dirName: 'Show A\nShow A Specials', sizeBytes: 10 * GB }),
      media('mv', { libraryKind: 'movie', dirName: null, fileName: 'Loose Movie.mkv', sizeBytes: 8 * GB }),
    ]);
    // Both mismatch hard vs the arr claim (2 GB), so both get measured.
    replaceArrItems([
      {
        ratingKey: 'sh', source: 'sonarr', instanceId: 's1', instanceName: 'S', arrId: 1,
        monitored: true, status: 'ended', quality: 'HD', qualityKind: 'profile',
        rootFolder: '/tv', arrSizeBytes: 2 * GB, tags: [],
      },
      {
        ratingKey: 'mv', source: 'radarr', instanceId: 'r1', instanceName: 'R', arrId: 2,
        monitored: true, status: 'released', quality: 'HD', qualityKind: 'file',
        rootFolder: '/m', arrSizeBytes: 2 * GB, tags: [],
      },
    ]);
    setStorageMappings([{ sectionId: '1', path: root }]);

    const res = await runDiskScan();
    expect(res.message).toContain('measured 2 mismatched title(s)');
    const rows = sizeMismatchItems(10, 0);
    expect(rows.find((r) => r.ratingKey === 'sh')?.diskSizeBytes).toBe(140); // both folders summed
    expect(rows.find((r) => r.ratingKey === 'mv')?.diskSizeBytes).toBe(70); // loose file lstat
  });

  it('mtime size cache: unchanged orphan dirs reuse the cached size', async () => {
    const root = makeRoot();
    const orphan = join(root, 'Sticky Orphan');
    mkdirSync(orphan);
    writeFileSync(join(orphan, 'file.bin'), 'x'.repeat(60));
    upsertMediaBatch([media('A', { dirName: 'Show A' })]);
    setStorageMappings([{ sectionId: '1', path: root }]);

    // Pre-seed a prior row for the SAME path + current mtime with a sentinel
    // size: a scan must trust the cache instead of re-walking.
    const mtime = Math.floor(statSync(orphan).mtimeMs / 1000);
    replaceDiskOrphansForSection('1', [
      { name: 'Sticky Orphan', path: orphan, isDir: true, sizeBytes: 999, sizeSkipped: false, mtime },
    ]);
    await runDiskScan();
    expect(getDiskOrphans()[0].sizeBytes).toBe(999); // reused, not 60

    // Bump the dir mtime → the cache misses and the real walk runs.
    utimesSync(orphan, new Date(), new Date(Date.now() + 5000));
    await runDiskScan();
    expect(getDiskOrphans()[0].sizeBytes).toBe(60);
  });
});
