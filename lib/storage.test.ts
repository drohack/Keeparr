import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import os from 'node:os';
import { __setTestDbToMemory, __closeDb } from './db';
import { upsertMediaBatch, usedBytesBySection, type UpsertMediaInput } from './queries';
import { buildStorageReport, statfsSafe } from './storage';

const GB = 1024 ** 3;

function media(rk: string, sectionId: string, sizeBytes: number): UpsertMediaInput {
  return {
    ratingKey: rk,
    sectionId,
    libraryKind: 'movie',
    title: `Title ${rk}`,
    year: 2020,
    thumb: null,
    sizeBytes,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
  };
}

beforeEach(() => {
  __setTestDbToMemory();
});
afterAll(() => {
  __closeDb();
});

describe('usedBytesBySection', () => {
  it('sums size per section, ignoring removed', () => {
    upsertMediaBatch([
      media('1', '1', 2 * GB),
      media('2', '1', 3 * GB),
      media('3', '2', 5 * GB),
    ]);
    const m = usedBytesBySection();
    expect(m.get('1')).toBe(5 * GB);
    expect(m.get('2')).toBe(5 * GB);
  });
});

describe('statfsSafe', () => {
  it('reports positive totals for a real directory', async () => {
    const res = await statfsSafe(os.tmpdir());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.totalBytes).toBeGreaterThan(0);
      expect(res.freeBytes).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns an error for a bogus path', async () => {
    const res = await statfsSafe(`${os.tmpdir()}/keeparr-does-not-exist-xyz`);
    expect(res.ok).toBe(false);
  });
});

describe('buildStorageReport', () => {
  it('is unconfigured with no mappings', async () => {
    const report = await buildStorageReport([], new Map());
    expect(report.configured).toBe(false);
    expect(report.totals).toBeNull();
  });

  it('dedupes sections sharing a filesystem and sums their plex usage', async () => {
    upsertMediaBatch([media('1', '1', 2 * GB), media('2', '2', 3 * GB)]);
    const used = usedBytesBySection();
    // Two sections map to the same real dir → one filesystem entry.
    const report = await buildStorageReport(
      [
        { sectionId: '1', path: os.tmpdir() },
        { sectionId: '2', path: os.tmpdir() },
      ],
      used
    );
    expect(report.configured).toBe(true);
    const okFs = report.filesystems.filter((f) => f.ok);
    expect(okFs).toHaveLength(1);
    if (okFs[0].ok) {
      expect(okFs[0].sectionIds.sort()).toEqual(['1', '2']);
      expect(okFs[0].plexUsedBytes).toBe(5 * GB);
    }
    expect(report.totals?.totalBytes).toBeGreaterThan(0);
  });

  it('records an error entry for an inaccessible path', async () => {
    const report = await buildStorageReport(
      [{ sectionId: '1', path: `${os.tmpdir()}/keeparr-nope-xyz` }],
      new Map()
    );
    expect(report.configured).toBe(true);
    expect(report.filesystems.some((f) => !f.ok)).toBe(true);
  });

  it('fakeTotalBytes yields a synthetic filesystem (no statfs)', async () => {
    const used = new Map([
      ['1', 3 * GB],
      ['2', 1 * GB],
    ]);
    const total = 16 * GB;
    const report = await buildStorageReport(
      [
        { sectionId: '1', path: '/whatever' },
        { sectionId: '2', path: '/also-fake' },
      ],
      used,
      { fakeTotalBytes: total }
    );
    expect(report.configured).toBe(true);
    expect(report.filesystems).toHaveLength(1);
    expect(report.totals).toEqual({
      totalBytes: total,
      usedBytes: 4 * GB,
      freeBytes: total - 4 * GB,
    });
  });
});
