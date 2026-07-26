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
  tombstoneStale,
  upsertMediaBatch,
  upsertUser,
  type ArrItemInput,
  type UpsertMediaInput,
} from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { setRadarrInstances, setSonarrInstances } from '@/lib/settings';
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

const CATEGORY_ORDER = [
  'sizeMismatch',
  'notInArr',
  'missingFromPlex',
  'duplicates',
  'arrConflicts',
  'zeroSize',
  'removedButKept',
  'missingIds',
  'diskOrphans',
];

describe('GET /api/admin/problems/summary', () => {
  it('returns all 9 categories in display order + the server type for labels', async () => {
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
    for (const t of ['sizeMismatch', 'notInArr', 'missingFromPlex', 'arrConflicts']) {
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

  it('diskOrphans is always the planned stub', async () => {
    await loginAs('admin', true);
    const body = await summaryGet().then((r) => r.json());
    expect(body.categories.at(-1)).toEqual({
      type: 'diskOrphans',
      available: false,
      planned: true,
      titles: 0,
      bytes: 0,
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
  it('400 on a missing, unknown, or stub type', async () => {
    await loginAs('admin', true);
    expect((await problemsGet(listReq(''))).status).toBe(400);
    expect((await problemsGet(listReq('type=nope'))).status).toBe(400);
    const res = await problemsGet(listReq('type=diskOrphans'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_type');
  });

  it('400 arr_not_configured for arr-gated types without Sonarr/Radarr', async () => {
    await loginAs('admin', true);
    for (const t of ['sizeMismatch', 'notInArr', 'missingFromPlex', 'arrConflicts']) {
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

  it('duplicates returns groups with members', async () => {
    await loginAs('admin', true);
    upsertMediaBatch([
      media('1', { guidTmdb: '603', sizeBytes: 4 * GB }),
      media('2', { guidTmdb: '603', sizeBytes: 2 * GB }),
    ]);
    const body = await problemsGet(listReq('type=duplicates')).then((r) => r.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ idKind: 'tmdb', idValue: '603', totalBytes: 6 * GB });
    expect(body.items[0].items.map((m: { ratingKey: string }) => m.ratingKey)).toEqual(['1', '2']);
    expect(body.items[0].items[0].thumbUrl).toContain('/api/image?path=');
  });

  it('removedButKept returns flattened keeper names (username or User <id>)', async () => {
    await loginAs('admin', true);
    upsertUser({ plexUserId: 'u1', username: 'Alice', email: null, thumb: null, isAdmin: false });
    upsertMediaBatch([media('gone', { sizeBytes: 5 * GB })], 10);
    addKeep('u1', 'gone');
    addKeep('u2', 'gone'); // no users row
    tombstoneStale(11);
    const body = await problemsGet(listReq('type=removedButKept')).then((r) => r.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0].keptBy.sort()).toEqual(['Alice', 'User u2']);
  });

  it('sizeMismatch and arrConflicts return their category payloads', async () => {
    await loginAs('admin', true);
    configureArr();
    setSonarrInstances([{ id: 's1', name: 'Sonarr', url: 'http://s1', apiKey: 'k' }]);
    upsertMediaBatch([media('1', { sizeBytes: 10 * GB })]);
    replaceArrItems([arrRow({ ratingKey: '1', arrSizeBytes: 4 * GB })]);
    replaceArrConflicts([
      {
        ratingKey: '1', title: 'Title 1', firstSource: 'radarr', firstInstanceId: 'r1',
        firstInstanceName: 'Radarr', source: 'sonarr', instanceId: 's1',
        instanceName: 'Sonarr', sizeOnDisk: 2 * GB,
      },
    ]);

    const mm = await problemsGet(listReq('type=sizeMismatch')).then((r) => r.json());
    expect(mm.items[0]).toMatchObject({
      ratingKey: '1',
      plexBytes: 10 * GB,
      arrBytes: 4 * GB,
      deltaBytes: 6 * GB,
      instanceName: 'Radarr',
    });

    const cf = await problemsGet(listReq('type=arrConflicts')).then((r) => r.json());
    expect(cf.items[0]).toMatchObject({
      ratingKey: '1',
      winner: { source: 'radarr', instanceName: 'Radarr' },
      loser: { source: 'sonarr', instanceName: 'Sonarr' },
      sizeOnDisk: 2 * GB,
    });
    expect(cf.items[0].thumbUrl).toContain('/api/image?path=');
  });
});
