import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

import { __setTestDbToMemory, __closeDb } from '@/lib/db';
import {
  addKeep,
  replaceArrConflicts,
  replaceArrItems,
  replaceArrUnmatched,
  replaceDiskOrphansForSection,
  setJobState,
  tombstoneStale,
  upsertMediaBatch,
  upsertUser,
  type ArrItemInput,
  type UpsertMediaInput,
} from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { setRadarrInstances, setSonarrInstances, setStorageMappings } from '@/lib/settings';
import { GET as problemsGet } from '@/app/api/admin/problems/route';
import { GET as summaryGet } from '@/app/api/admin/problems/summary/route';
import type { ProblemCategorySummary } from '@/lib/types';

const GB = 1024 ** 3;

function media(ratingKey: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
  return {
    ratingKey,
    sectionId: '1',
    libraryKind: 'movie',
    title: `Title ${ratingKey}`,
    year: 2020,
    thumb: `/library/metadata/${ratingKey}/thumb`,
    sizeBytes: 1 * GB,
    addedAt: 1000,
    guidTmdb: ratingKey, // give every item an id so missingIds stays empty by default
    guidTvdb: null,
    ...over,
  };
}

const arrRow = (over: Partial<ArrItemInput>): ArrItemInput => ({
  ratingKey: '1',
  source: 'radarr',
  instanceId: 'r1',
  instanceName: 'Radarr',
  arrId: 1,
  monitored: true,
  status: 'released',
  quality: 'Bluray-1080p',
  qualityKind: 'file',
  rootFolder: '/m',
  arrSizeBytes: 1 * GB,
  tags: [],
  ...over,
});

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
});
afterAll(() => __closeDb());

async function loginAs(plexUserId: string, isAdmin = false) {
  upsertUser({ plexUserId, username: plexUserId, email: null, thumb: null, isAdmin });
  await setSessionCookie(plexUserId);
}

const listReq = (qs: string) => new Request(`http://localhost/api/admin/problems?${qs}`);

const configureArr = () =>
  setRadarrInstances([{ id: 'r1', name: 'Radarr', url: 'http://r1', apiKey: 'k' }]);

// Grouped: server ↔ *arr · within the server · on disk.
const CATEGORY_ORDER = [
  'sizeMismatch',
  'notInArr',
  'missingFromPlex',
  'identityMismatch',
  'arrConflicts',
  'duplicates',
  'zeroSize',
  'removedButKept',
  'missingIds',
  'diskOrphans',
];

describe('GET /api/admin/problems/summary', () => {
  it('returns all 10 categories in display order + the server type for labels', async () => {
    await loginAs('admin', true);
    const body = await summaryGet().then((r) => r.json());
    expect(body.categories.map((c: ProblemCategorySummary) => c.type)).toEqual(CATEGORY_ORDER);
    expect(body.serverType).toBe('plex'); // default when unset
  });

  it('arr-gated categories are unavailable (zeroed) without Sonarr/Radarr', async () => {
    await loginAs('admin', true);
    const body = await summaryGet().then((r) => r.json());
    expect(body.arrConfigured).toBe(false);
    const byType = new Map<string, ProblemCategorySummary>(
      body.categories.map((c: ProblemCategorySummary) => [c.type, c])
    );
    for (const t of ['sizeMismatch', 'notInArr', 'missingFromPlex', 'identityMismatch', 'arrConflicts']) {
      expect(byType.get(t)).toMatchObject({ available: false, titles: 0, bytes: 0 });
    }
    for (const t of ['duplicates', 'zeroSize', 'removedButKept', 'missingIds']) {
      expect(byType.get(t)?.available).toBe(true);
    }
  });

  it('notInArr stays unavailable until the arr job has matched something', async () => {
    await loginAs('admin', true);
    configureArr();
    upsertMediaBatch([media('1')]);
    let body = await summaryGet().then((r) => r.json());
    let cat = body.categories.find((c: ProblemCategorySummary) => c.type === 'notInArr');
    expect(cat.available).toBe(false); // arr configured, but nothing matched yet

    replaceArrItems([arrRow({ ratingKey: '1' })]);
    upsertMediaBatch([media('2', { sizeBytes: 3 * GB })]);
    body = await summaryGet().then((r) => r.json());
    cat = body.categories.find((c: ProblemCategorySummary) => c.type === 'notInArr');
    expect(cat).toMatchObject({ available: true, titles: 1, bytes: 3 * GB });
  });

  it('diskOrphans reports why it cannot run yet, then goes live', async () => {
    await loginAs('admin', true);
    // No storage mappings → setup needed.
    let cat = (await summaryGet().then((r) => r.json())).categories.at(-1);
    expect(cat).toEqual({
      type: 'diskOrphans',
      available: false,
      reason: 'storage_not_configured',
      titles: 0,
      bytes: 0,
    });

    // Mapped but the Disk scan job has never run → not scanned.
    setStorageMappings([{ sectionId: '1', path: '/media/Movies' }]);
    cat = (await summaryGet().then((r) => r.json())).categories.at(-1);
    expect(cat).toMatchObject({ available: false, reason: 'not_scanned' });

    // Mapped + scanned → live with real counts.
    setJobState('diskScan', { lastStatus: 'ok', lastRun: 1000 });
    replaceDiskOrphansForSection('1', [
      { name: 'Leftover', path: '/media/Movies/Leftover', isDir: true, sizeBytes: 3 * GB, sizeSkipped: false, mtime: 1 },
    ]);
    cat = (await summaryGet().then((r) => r.json())).categories.at(-1);
    expect(cat).toEqual({
      type: 'diskOrphans',
      available: true,
      titles: 1,
      bytes: 3 * GB,
    });
  });

  it('counts reflect seeded problem data', async () => {
    await loginAs('admin', true);
    configureArr();
    upsertMediaBatch([
      media('1', { sizeBytes: 10 * GB }), // mismatch (arr 4 GB)
      media('2', { sizeBytes: 0 }), // zero size
      media('3', { guidTmdb: '603' }),
      media('4', { guidTmdb: '603' }), // 3+4 duplicates
      media('5', { guidTmdb: null }), // missing ids
    ]);
    replaceArrItems([arrRow({ ratingKey: '1', arrSizeBytes: 4 * GB })]);
    replaceArrUnmatched([
      {
        source: 'radarr', instanceId: 'r1', instanceName: 'Radarr',
        title: 'Orphan', extKind: 'tmdb', extId: '9', sizeBytes: 2 * GB,
      },
    ]);
    upsertMediaBatch([media('gone', { sizeBytes: 5 * GB })], 10);
    addKeep('u1', 'gone');
    tombstoneStale(11);

    const body = await summaryGet().then((r) => r.json());
    const byType = new Map<string, ProblemCategorySummary>(
      body.categories.map((c: ProblemCategorySummary) => [c.type, c])
    );
    expect(byType.get('sizeMismatch')).toMatchObject({ titles: 1, bytes: 6 * GB });
    expect(byType.get('missingFromPlex')).toMatchObject({ titles: 1, bytes: 2 * GB });
    expect(byType.get('duplicates')).toMatchObject({ titles: 1, bytes: 2 * GB }); // 1 group
    expect(byType.get('zeroSize')).toMatchObject({ titles: 1, bytes: 0 });
    expect(byType.get('removedButKept')).toMatchObject({ titles: 1, bytes: 5 * GB });
    expect(byType.get('missingIds')).toMatchObject({ titles: 1, bytes: 1 * GB });
  });
});

describe('GET /api/admin/problems', () => {
  it('400 on a missing or unknown type', async () => {
    await loginAs('admin', true);
    expect((await problemsGet(listReq(''))).status).toBe(400);
    const res = await problemsGet(listReq('type=nope'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_type');
  });

  it('diskOrphans: 400 without storage mappings, rows once configured', async () => {
    await loginAs('admin', true);
    const denied = await problemsGet(listReq('type=diskOrphans'));
    expect(denied.status).toBe(400);
    expect((await denied.json()).error).toBe('storage_not_configured');

    setStorageMappings([{ sectionId: '1', path: '/media/Movies' }]);
    replaceDiskOrphansForSection('1', [
      { name: 'Big Leftover', path: '/media/Movies/Big Leftover', isDir: true, sizeBytes: 9 * GB, sizeSkipped: false, mtime: 1 },
      { name: 'flagged', path: '/media/Movies/flagged', isDir: false, sizeBytes: 0, sizeSkipped: true, mtime: 1 },
    ]);
    const body = await problemsGet(listReq('type=diskOrphans')).then((r) => r.json());
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      name: 'Big Leftover',
      sectionId: '1',
      path: '/media/Movies/Big Leftover',
      isDir: true,
      sizeBytes: 9 * GB,
      sizeSkipped: false,
      likely: null, // nothing in the library shares this title
    });
    expect(body.items[1]).toMatchObject({ sizeSkipped: true, isDir: false });

    // An orphan whose name matches a library title gets the "Looks like" diagnosis.
    upsertMediaBatch([media('av', { title: 'Big Leftover', sizeBytes: 16 * GB })]);
    const again = await problemsGet(listReq('type=diskOrphans')).then((r) => r.json());
    expect(again.items[0].likely).toMatchObject({ ratingKey: 'av', sizeBytes: 16 * GB });
  });

  it('400 arr_not_configured for arr-gated types without Sonarr/Radarr', async () => {
    await loginAs('admin', true);
    for (const t of ['sizeMismatch', 'notInArr', 'missingFromPlex', 'identityMismatch', 'arrConflicts']) {
      const res = await problemsGet(listReq(`type=${t}`));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('arr_not_configured');
    }
    // Non-arr types still work.
    expect((await problemsGet(listReq('type=zeroSize'))).status).toBe(200);
  });

  it('lists zero-size items with proxied posters and pages at 60', async () => {
    await loginAs('admin', true);
    upsertMediaBatch(
      Array.from({ length: 61 }, (_, i) => media(`z${i}`, { sizeBytes: 0, addedAt: 5000 - i }))
    );
    const page1 = await problemsGet(listReq('type=zeroSize')).then((r) => r.json());
    expect(page1.items).toHaveLength(60);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextOffset).toBe(60);
    expect(page1.items[0].thumbUrl).toContain('/api/image?path=');
    expect(page1.items[0].thumb).toBeUndefined(); // raw path never leaves the server

    const page2 = await problemsGet(listReq('type=zeroSize&offset=60')).then((r) => r.json());
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('notInArr hides missing-id titles by default; includeMissingIds=1 shows them', async () => {
    await loginAs('admin', true);
    configureArr();
    upsertMediaBatch([
      media('1', { sizeBytes: 8 * GB }), // builder gives it a tmdb id → always listed
      media('2', { guidTmdb: null, sizeBytes: 4 * GB }), // no id at all → hidden by default
    ]);
    const def = await problemsGet(listReq('type=notInArr')).then((r) => r.json());
    expect(def.items.map((i: { ratingKey: string }) => i.ratingKey)).toEqual(['1']);
    const all = await problemsGet(listReq('type=notInArr&includeMissingIds=1')).then((r) =>
      r.json()
    );
    expect(all.items.map((i: { ratingKey: string }) => i.ratingKey)).toEqual(['1', '2']);
  });

  it('sort/dir/sections/kind view options apply (SQL-paged + JS-sliced)', async () => {
    await loginAs('admin', true);
    upsertMediaBatch([
      media('z1', { title: 'Zebra', sizeBytes: 0, addedAt: 100 }),
      media('z2', { title: 'Alpha', sizeBytes: 0, addedAt: 300, sectionId: '2', libraryKind: 'show' }),
    ]);
    // SQL-paged (zeroSize): sort by title asc + kind filter.
    const byTitle = await problemsGet(listReq('type=zeroSize&sort=title')).then((r) => r.json());
    expect(byTitle.items.map((i: { title: string }) => i.title)).toEqual(['Alpha', 'Zebra']);
    const movies = await problemsGet(listReq('type=zeroSize&kind=movie')).then((r) => r.json());
    expect(movies.items.map((i: { title: string }) => i.title)).toEqual(['Zebra']);
    const sec2 = await problemsGet(listReq('type=zeroSize&sections=2')).then((r) => r.json());
    expect(sec2.items.map((i: { title: string }) => i.title)).toEqual(['Alpha']);

    // JS-sliced (missingFromPlex): sort by title + kind via extKind.
    configureArr();
    replaceArrUnmatched([
      { source: 'radarr', instanceId: 'r1', instanceName: 'R', title: 'B Movie', extKind: 'tmdb', extId: '1', sizeBytes: 1 * GB },
      { source: 'radarr', instanceId: 'r1', instanceName: 'R', title: 'A Movie', extKind: 'tmdb', extId: '2', sizeBytes: 2 * GB },
      { source: 'sonarr', instanceId: 'r1', instanceName: 'R', title: 'Some Show', extKind: 'tvdb', extId: '3', sizeBytes: 3 * GB },
    ]);
    const mfp = await problemsGet(listReq('type=missingFromPlex&sort=title')).then((r) => r.json());
    expect(mfp.items.map((i: { title: string }) => i.title)).toEqual(['A Movie', 'B Movie', 'Some Show']);
    const mfpMovies = await problemsGet(listReq('type=missingFromPlex&kind=movie')).then((r) =>
      r.json()
    );
    expect(mfpMovies.items.map((i: { title: string }) => i.title)).toEqual(['A Movie', 'B Movie']); // size DESC
    // Rows carry the disk reality check (null until a job verifies them).
    expect(mfpMovies.items[0].onDisk).toBeNull();
    expect(mfpMovies.items[0].diskSizeBytes).toBeNull();
  });

  it('cross-links: notInArr + missingFromPlex rows point at their identity pair', async () => {
    await loginAs('admin', true);
    configureArr();
    upsertMediaBatch([
      media('1', {
        title: 'Wrong Match',
        dirName: 'Real Title (1995)',
        sizeBytes: 4 * GB,
      }),
      media('2', { title: 'Plain Unmanaged', dirName: 'Plain Unmanaged (2001)' }),
    ]);
    replaceArrUnmatched([
      {
        source: 'radarr', instanceId: 'r1', instanceName: 'Radarr', title: 'Real Title',
        extKind: 'tmdb', extId: '999', sizeBytes: 2 * GB, folderName: 'Real Title (1995)',
        downloaded: true,
      },
    ]);
    const nia = await problemsGet(listReq('type=notInArr')).then((r) => r.json());
    const byRk = new Map(nia.items.map((i: { ratingKey: string; identityArrTitle: string | null }) => [i.ratingKey, i.identityArrTitle]));
    expect(byRk.get('1')).toBe('Real Title'); // half of the identity pair
    expect(byRk.get('2')).toBeNull(); // genuinely unmanaged

    const mfp = await problemsGet(listReq('type=missingFromPlex')).then((r) => r.json());
    expect(mfp.items[0].claimedByTitle).toBe('Wrong Match');
  });

  it('zeroSize rows expose the arr context', async () => {
    await loginAs('admin', true);
    upsertMediaBatch([media('z', { sizeBytes: 0 })]);
    replaceArrItems([arrRow({ ratingKey: 'z', arrSizeBytes: 19 * GB })]);
    const body = await problemsGet(listReq('type=zeroSize')).then((r) => r.json());
    expect(body.items[0]).toMatchObject({ ratingKey: 'z', arrBytes: 19 * GB, instanceName: 'Radarr' });
  });

  it('identityMismatch pairs media + arr claims on one folder', async () => {
    await loginAs('admin', true);
    configureArr();
    upsertMediaBatch([
      media('1', {
        title: 'Wrong Match',
        guidTmdb: '111',
        dirName: 'Real Title (1995)',
        dirPath: '/media/Movies/Real Title (1995)',
        sizeBytes: 4 * GB,
      }),
    ]);
    replaceArrUnmatched([
      {
        source: 'radarr', instanceId: 'r1', instanceName: 'Radarr', title: 'Real Title',
        extKind: 'tmdb', extId: '999', sizeBytes: 0, folderName: 'Real Title (1995)',
        path: '/movies/Real Title (1995)', downloaded: false,
      },
    ]);
    const body = await problemsGet(listReq('type=identityMismatch')).then((r) => r.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0].media).toMatchObject({
      title: 'Wrong Match',
      dirPath: '/media/Movies/Real Title (1995)',
      guidTmdb: '111', // the server's own id — shown against the arr's extId
    });
    expect(body.items[0].media.thumbUrl).toContain('/api/image?path=');
    expect(body.items[0].arr).toMatchObject({
      title: 'Real Title',
      extId: '999',
      downloaded: false,
    });
  });

  it('duplicates returns groups with members incl. their locations', async () => {
    await loginAs('admin', true);
    upsertMediaBatch([
      media('1', { guidTmdb: '603', sizeBytes: 4 * GB, dirPath: '/media/4K/Title 1' }),
      media('2', { guidTmdb: '603', sizeBytes: 2 * GB, dirPath: '/media/Movies/Title 2' }),
    ]);
    const body = await problemsGet(listReq('type=duplicates')).then((r) => r.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ idKind: 'tmdb', idValue: '603', totalBytes: 6 * GB });
    expect(body.items[0].items.map((m: { ratingKey: string }) => m.ratingKey)).toEqual(['1', '2']);
    expect(body.items[0].items[0].thumbUrl).toContain('/api/image?path=');
    expect(body.items[0].items.map((m: { dirPath: string | null }) => m.dirPath)).toEqual([
      '/media/4K/Title 1',
      '/media/Movies/Title 2',
    ]);
  });

  it('removedButKept returns flattened keeper names + the last-known location', async () => {
    await loginAs('admin', true);
    upsertUser({ plexUserId: 'u1', username: 'Alice', email: null, thumb: null, isAdmin: false });
    upsertMediaBatch([media('gone', { sizeBytes: 5 * GB, dirPath: '/media/TV/Gone Show' })], 10);
    addKeep('u1', 'gone');
    addKeep('u2', 'gone'); // no users row
    tombstoneStale(11);
    const body = await problemsGet(listReq('type=removedButKept')).then((r) => r.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0].keptBy.sort()).toEqual(['Alice', 'User u2']);
    expect(body.items[0].dirPath).toBe('/media/TV/Gone Show');
  });

  it('sizeMismatch and arrConflicts return their category payloads', async () => {
    await loginAs('admin', true);
    configureArr();
    setSonarrInstances([{ id: 's1', name: 'Sonarr', url: 'http://s1', apiKey: 'k' }]);
    upsertMediaBatch([media('1', { sizeBytes: 10 * GB, fileCount: 2 })]);
    replaceArrItems([arrRow({ ratingKey: '1', arrSizeBytes: 4 * GB })]);
    replaceArrConflicts([
      {
        ratingKey: '1', title: 'Title 1', firstSource: 'radarr', firstInstanceId: 'r1',
        firstInstanceName: 'Radarr', source: 'sonarr', instanceId: 's1',
        instanceName: 'Sonarr', sizeOnDisk: 2 * GB,
      },
      // Same-instance collision (two Radarr titles → one item): flagged so the
      // UI can suggest "split the merged item" instead of "remove from one".
      {
        ratingKey: '1', title: 'Title 1, Part II', firstSource: 'radarr', firstInstanceId: 'r1',
        firstInstanceName: 'Radarr', source: 'radarr', instanceId: 'r1',
        instanceName: 'Radarr', sizeOnDisk: 1 * GB,
      },
    ]);

    const mm = await problemsGet(listReq('type=sizeMismatch')).then((r) => r.json());
    expect(mm.items[0]).toMatchObject({
      ratingKey: '1',
      plexBytes: 10 * GB,
      arrBytes: 4 * GB,
      deltaBytes: 6 * GB,
      instanceName: 'Radarr',
      diskSizeBytes: null, // measured by the Disk scan job
      fileCount: 2, // multi-part movie → the UI badges it "likely fine"
    });

    const cf = await problemsGet(listReq('type=arrConflicts')).then((r) => r.json());
    expect(cf.items[0]).toMatchObject({
      ratingKey: '1',
      winner: { source: 'radarr', instanceName: 'Radarr' },
      loser: { source: 'sonarr', instanceName: 'Sonarr' },
      sameInstance: false,
      sizeOnDisk: 2 * GB,
    });
    expect(cf.items[0].thumbUrl).toContain('/api/image?path=');
    const same = cf.items.find((c: { title: string }) => c.title === 'Title 1, Part II');
    expect(same).toMatchObject({ sameInstance: true });
  });
});
