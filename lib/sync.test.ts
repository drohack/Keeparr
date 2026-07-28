import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __setTestDbToMemory, __closeDb } from './db';
import {
  arrFolderNames,
  getArrConflicts,
  getArrUnmatched,
  getMediaItem,
  replaceArrConflicts,
  libraryStats,
  replaceArrItems,
  replaceArrUnmatched,
  seerrRequestKeys,
  upsertMediaBatch,
  upsertUser,
  watchedRatingKeys,
  queryLibrary,
  type UpsertMediaInput,
} from './queries';
import {
  getPlexSections,
  setManagedSectionIds,
  setPlexSections,
  setRadarrInstances,
  setSonarrInstances,
  setStorageMappings,
  writeSetting,
} from './settings';
import type { BackendItem, BackendSection, MediaBackend } from './mediaserver';
import { fetchSonarr, fetchRadarr, type ArrRecord } from './arr';
import { requestedRatingKeysForUser } from './seerr';
import {
  syncArr,
  syncLibrary,
  syncRecentlyAdded,
  syncSeerrRequests,
  syncSizes,
  syncWatchHistory,
} from './sync';

// The sync engine reads through getBackend() (the seam, not storage) — swap in
// a per-test fake. The factory closure reads `fakeBackend` lazily at run time.
let fakeBackend: MediaBackend;
vi.mock('./mediaserver', () => ({ getBackend: () => fakeBackend }));

// Network clients are mocked (never storage); everything below them is real.
vi.mock('./arr', () => ({ fetchSonarr: vi.fn(), fetchRadarr: vi.fn() }));
vi.mock('./seerr', () => ({ requestedRatingKeysForUser: vi.fn() }));

const GB = 1024 ** 3;

function section(id: string, kind: 'movie' | 'show' = 'movie'): BackendSection {
  return { id, title: `Lib ${id}`, kind, paths: [`/media/${id}`] };
}

function backendItem(ratingKey: string, over: Partial<BackendItem> = {}): BackendItem {
  return {
    ratingKey,
    title: `Title ${ratingKey}`,
    year: 2020,
    thumb: null,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
    guidImdb: null,
    sizeBytes: 1 * GB,
    dirName: null,
    fileName: null,
    dirPath: null,
    fileCount: null,
    ...over,
  };
}

function media(ratingKey: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
  return {
    ratingKey,
    sectionId: '1',
    libraryKind: 'movie',
    title: `Title ${ratingKey}`,
    year: 2020,
    thumb: null,
    sizeBytes: 1 * GB,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
    ...over,
  };
}

function backendWith(
  sections: BackendSection[],
  itemsBySection: Record<string, BackendItem[]>
): MediaBackend {
  return {
    listSections: async () => sections,
    listSectionItems: async (id) => itemsBySection[id] ?? [],
    recentItems: async () => [],
    showSize: async () => ({ sizeBytes: 0, dirPath: null, dirNames: [] }),
    getWatchData: async () => null,
  };
}

beforeEach(() => {
  __setTestDbToMemory();
  // Real settings rows (not mocks) so isServerConfigured() passes as Plex.
  writeSetting('plex_machine_id', 'abc');
  writeSetting('plex_base_url', 'http://plex:32400');
  writeSetting('plex_server_token', 't');
  vi.mocked(fetchSonarr).mockReset();
  vi.mocked(fetchRadarr).mockReset();
  vi.mocked(requestedRatingKeysForUser).mockReset();
});

afterAll(() => {
  __closeDb();
});

describe('syncLibrary tombstone guards', () => {
  it('aborts on zero sections without touching stored sections or media', async () => {
    setPlexSections([{ id: '1', title: 'Movies', type: 'movie', paths: ['/data/movies'] }]);
    upsertMediaBatch([media('1')], 1000);
    fakeBackend = backendWith([], {});
    await expect(syncLibrary()).rejects.toThrow(/no library sections/);
    // The sections blob (incl. paths for storage mapping) was not overwritten…
    expect(getPlexSections()).toEqual([
      { id: '1', title: 'Movies', type: 'movie', paths: ['/data/movies'] },
    ]);
    // …and nothing was tombstoned.
    expect(getMediaItem('1')?.removed).toBe(0);
  });

  it('an empty-but-200 section keeps its rows; a scanned section still tombstones', async () => {
    // Section 1 previously had items 1+2; section 2 had item 3.
    upsertMediaBatch([media('1'), media('2')], 1000);
    upsertMediaBatch([media('3', { sectionId: '2' })], 1000);
    // This scan: section 1 returns only item 1 (item 2 genuinely deleted);
    // section 2 answers 200 with no items (backend hiccup).
    fakeBackend = backendWith([section('1'), section('2')], {
      '1': [backendItem('1')],
      '2': [],
    });
    const res = await syncLibrary();
    expect(getMediaItem('1')?.removed).toBe(0);
    expect(getMediaItem('2')?.removed).toBe(1); // real deletion still detected
    expect(getMediaItem('3')?.removed).toBe(0); // shielded by the empty-section guard
    expect(res.message).toContain('1 section(s) returned no items');
  });

  it('unmanaged sections still tombstone out (intentional behavior)', async () => {
    upsertMediaBatch([media('1'), media('9', { sectionId: '9' })], 1000);
    setManagedSectionIds(['1']);
    fakeBackend = backendWith([section('1'), section('9')], {
      '1': [backendItem('1')],
      '9': [backendItem('9')], // discovered but unmanaged → never scanned
    });
    await syncLibrary();
    expect(getMediaItem('1')?.removed).toBe(0);
    expect(getMediaItem('9')?.removed).toBe(1); // dropped out as before
  });
});

describe('syncArr per-instance replace', () => {
  const rec = (over: Partial<ArrRecord>): ArrRecord => ({
    source: 'radarr',
    instanceId: 'r1',
    instanceName: 'Radarr',
    arrId: 1,
    matchId: '22',
    imdbId: null,
    title: 'Movie',
    monitored: true,
    status: 'released',
    quality: 'Bluray-1080p',
    qualityKind: 'file',
    rootFolder: '/m',
    sizeOnDisk: 1 * GB,
    path: null,
    tags: [],
    ...over,
  });

  const arrSource = (ratingKey: string) =>
    queryLibrary({ plexUserId: 'u', limit: 100, offset: 0 }).find(
      (r) => r.rating_key === ratingKey
    )?.arr_source ?? null;

  beforeEach(() => {
    setSonarrInstances([{ id: 's1', name: 'Sonarr', url: 'http://s1', apiKey: 'k' }]);
    setRadarrInstances([{ id: 'r1', name: 'Radarr', url: 'http://r1', apiKey: 'k' }]);
    upsertMediaBatch([
      media('m1', { guidTmdb: '22' }),
      media('sh1', { libraryKind: 'show', guidTvdb: '11' }),
    ]);
    // Prior run cached rows for both instances.
    replaceArrItems([
      {
        ratingKey: 'sh1', source: 'sonarr', instanceId: 's1', instanceName: 'Sonarr',
        arrId: 1, monitored: true, status: 'ended', quality: 'HD-1080p',
        qualityKind: 'profile', rootFolder: '/tv', arrSizeBytes: 1 * GB, tags: [],
      },
    ]);
    replaceArrUnmatched([
      { source: 'sonarr', instanceId: 's1', instanceName: 'Sonarr', title: 'Orphan', extKind: 'tvdb', extId: '99', sizeBytes: 500 },
    ]);
  });

  it('keeps a failed instance\'s cached rows while refreshing the healthy one', async () => {
    vi.mocked(fetchSonarr).mockRejectedValue(new Error('down'));
    vi.mocked(fetchRadarr).mockResolvedValue([rec({})]);
    const res = await syncArr();
    expect(arrSource('m1')).toBe('radarr'); // fresh
    expect(arrSource('sh1')).toBe('sonarr'); // preserved despite the failure
    expect(getArrUnmatched().map((u) => u.title)).toEqual(['Orphan']); // preserved
    expect(res.message).toContain('1 instance error(s); their cached data kept');
  });

  it('keeps the whole cache when every instance fails', async () => {
    vi.mocked(fetchSonarr).mockRejectedValue(new Error('down'));
    vi.mocked(fetchRadarr).mockRejectedValue(new Error('down'));
    const res = await syncArr();
    expect(res.message).toContain('kept existing cache');
    expect(arrSource('sh1')).toBe('sonarr');
    expect(getArrUnmatched()).toHaveLength(1);
  });

  it('a fully successful run still replaces wholesale', async () => {
    vi.mocked(fetchSonarr).mockResolvedValue([]);
    vi.mocked(fetchRadarr).mockResolvedValue([rec({})]);
    await syncArr();
    expect(arrSource('m1')).toBe('radarr');
    expect(arrSource('sh1')).toBeNull(); // Sonarr reported nothing → row dropped
    expect(getArrUnmatched()).toEqual([]); // stale orphan swept
  });

  it('captures folder names for matched AND unmatched titles (disk-orphan set)', async () => {
    vi.mocked(fetchSonarr).mockResolvedValue([]);
    vi.mocked(fetchRadarr).mockResolvedValue([
      rec({ path: '/movies/Dune (2021)' }), // matches m1
      rec({ arrId: 2, matchId: '404', title: 'Lost Film', path: '/movies/Lost Film' }), // unmatched, downloaded
    ]);
    await syncArr();
    expect(arrFolderNames().sort()).toEqual(['Dune (2021)', 'Lost Film']);
    // The unmatched record also keeps its FULL *arr-side path (Problems Location).
    expect(getArrUnmatched().map((u) => u.path)).toEqual(['/movies/Lost Film']);
  });

  it('reality-checks unmatched folders against mapped roots right after the sync', async () => {
    const root = mkdtempSync(join(tmpdir(), 'keeparr-arr-verify-'));
    try {
      mkdirSync(join(root, 'On Disk Orphan'));
      writeFileSync(join(root, 'On Disk Orphan', 'f.mkv'), 'x'.repeat(50));
      setStorageMappings([{ sectionId: '1', path: root }]);
      vi.mocked(fetchSonarr).mockResolvedValue([]);
      vi.mocked(fetchRadarr).mockResolvedValue([
        rec({ arrId: 2, matchId: '404', title: 'On Disk Orphan', sizeOnDisk: 2 * GB, path: '/movies/On Disk Orphan' }),
        rec({ arrId: 3, matchId: '405', title: 'Ghost Record', sizeOnDisk: 1 * GB, path: '/movies/Ghost Record' }),
      ]);
      await syncArr();
      const byTitle = new Map(getArrUnmatched(false).map((u) => [u.title, u]));
      expect(byTitle.get('On Disk Orphan')).toMatchObject({ onDisk: true, diskSizeBytes: 50 });
      expect(byTitle.get('Ghost Record')).toMatchObject({ onDisk: false, diskSizeBytes: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records FILELESS unmatched titles too, but only counts downloaded in the message', async () => {
    vi.mocked(fetchSonarr).mockResolvedValue([]);
    vi.mocked(fetchRadarr).mockResolvedValue([
      rec({}), // matches m1
      rec({ arrId: 2, matchId: '404', title: 'Downloaded Orphan', sizeOnDisk: 2 * GB, path: '/movies/DO' }),
      rec({ arrId: 3, matchId: '405', title: 'Wanted Only', sizeOnDisk: 0, path: '/movies/WO' }),
    ]);
    const res = await syncArr();
    expect(res.message).toContain('(1 downloaded but not in Plex)'); // fileless not counted
    expect(getArrUnmatched().map((u) => u.title)).toEqual(['Downloaded Orphan']);
    const all = getArrUnmatched(false);
    expect(all.map((u) => u.title).sort()).toEqual(['Downloaded Orphan', 'Wanted Only']);
    expect(all.find((u) => u.title === 'Wanted Only')?.downloaded).toBe(false);
  });
});

describe('syncArr cross-instance conflicts', () => {
  const rec = (over: Partial<ArrRecord>): ArrRecord => ({
    source: 'radarr',
    instanceId: 'r1',
    instanceName: 'Radarr',
    arrId: 1,
    matchId: '22',
    imdbId: null,
    title: 'Movie',
    monitored: true,
    status: 'released',
    quality: 'Bluray-1080p',
    qualityKind: 'file',
    rootFolder: '/m',
    sizeOnDisk: 1 * GB,
    path: null,
    tags: [],
    ...over,
  });

  beforeEach(() => {
    setSonarrInstances([]);
    setRadarrInstances([
      { id: 'r1', name: 'Radarr', url: 'http://r1', apiKey: 'k' },
      { id: 'r2', name: 'Radarr 4K', url: 'http://r2', apiKey: 'k' },
    ]);
    upsertMediaBatch([media('m1', { guidTmdb: '22', guidImdb: 'tt5' })]);
  });

  it('records the second claimant as a conflict; the first keeps the arr_items row', async () => {
    vi.mocked(fetchRadarr)
      .mockResolvedValueOnce([rec({})]) // r1 claims m1 first
      .mockResolvedValueOnce([
        rec({ instanceId: 'r2', instanceName: 'Radarr 4K', sizeOnDisk: 2 * GB }),
      ]);
    const res = await syncArr();

    const conflicts = getArrConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ratingKey).toBe('m1');
    expect(conflicts[0].winner).toEqual({
      source: 'radarr',
      instanceId: 'r1',
      instanceName: 'Radarr',
    });
    expect(conflicts[0].loser).toEqual({
      source: 'radarr',
      instanceId: 'r2',
      instanceName: 'Radarr 4K',
    });
    expect(conflicts[0].sameInstance).toBe(false);
    expect(conflicts[0].sizeOnDisk).toBe(2 * GB); // the loser's copy
    // arr_items kept the FIRST claimant.
    const row = queryLibrary({ plexUserId: 'u', limit: 10, offset: 0 }).find(
      (r) => r.rating_key === 'm1'
    );
    expect(row?.arr_instance_name).toBe('Radarr');
    expect(res.message).toContain('1 cross-instance conflict(s)');
  });

  it('a collision via the imdb fallback is recorded too', async () => {
    vi.mocked(fetchRadarr)
      .mockResolvedValueOnce([rec({})]) // r1 claims m1 via tmdb
      .mockResolvedValueOnce([
        // r2's record carries a different tmdb id but the same imdb id.
        rec({ instanceId: 'r2', instanceName: 'Radarr 4K', matchId: '404', imdbId: 'tt5' }),
      ]);
    await syncArr();
    expect(getArrConflicts().map((c) => c.loser.instanceName)).toEqual(['Radarr 4K']);
  });

  it('two titles of ONE instance resolving to one item → sameInstance conflict (merged multi-part)', async () => {
    setRadarrInstances([{ id: 'r1', name: 'Radarr', url: 'http://r1', apiKey: 'k' }]);
    vi.mocked(fetchRadarr).mockResolvedValueOnce([
      // Part I claims the media item via the shared imdb id…
      rec({ arrId: 1, title: 'Film, Part I', matchId: '404', imdbId: 'tt5' }),
      // …then Part II — the item's real tmdb match — collides.
      rec({ arrId: 2, title: 'Film, Part II', matchId: '22', sizeOnDisk: 2 * GB }),
    ]);
    await syncArr();
    const conflicts = getArrConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      ratingKey: 'm1',
      title: 'Film, Part II',
      sameInstance: true,
    });
  });

  it('a clean run sweeps stale conflict rows', async () => {
    replaceArrConflicts([
      {
        ratingKey: 'm1', title: 'Movie', firstSource: 'radarr', firstInstanceId: 'r1',
        firstInstanceName: 'Radarr', source: 'radarr', instanceId: 'r2',
        instanceName: 'Radarr 4K', sizeOnDisk: 1 * GB,
      },
    ]);
    vi.mocked(fetchRadarr)
      .mockResolvedValueOnce([rec({})]) // only r1 has it now
      .mockResolvedValueOnce([]);
    await syncArr();
    expect(getArrConflicts()).toEqual([]);
  });

  it("a failed instance's prior conflict rows are preserved", async () => {
    replaceArrConflicts([
      {
        ratingKey: 'm1', title: 'Movie', firstSource: 'radarr', firstInstanceId: 'r1',
        firstInstanceName: 'Radarr', source: 'radarr', instanceId: 'r2',
        instanceName: 'Radarr 4K', sizeOnDisk: 1 * GB,
      },
    ]);
    vi.mocked(fetchRadarr)
      .mockResolvedValueOnce([rec({})])
      .mockRejectedValueOnce(new Error('down')); // r2 (the row's owner) failed
    await syncArr();
    expect(getArrConflicts()).toHaveLength(1); // preserved, not swept
  });

  it('every instance failing leaves the conflict table untouched', async () => {
    replaceArrConflicts([
      {
        ratingKey: 'm1', title: 'Movie', firstSource: 'radarr', firstInstanceId: 'r1',
        firstInstanceName: 'Radarr', source: 'radarr', instanceId: 'r2',
        instanceName: 'Radarr 4K', sizeOnDisk: 1 * GB,
      },
    ]);
    vi.mocked(fetchRadarr).mockRejectedValue(new Error('down'));
    await syncArr();
    expect(getArrConflicts()).toHaveLength(1);
  });
});

describe('syncRecentlyAdded', () => {
  it('upserts recent items per managed section, sizing new shows; never tombstones', async () => {
    setPlexSections([
      { id: '1', title: 'Movies', type: 'movie', paths: [] },
      { id: '2', title: 'TV', type: 'show', paths: [] },
    ]);
    upsertMediaBatch([media('old', { sectionId: '1' })], 1000); // pre-existing, not re-touched
    fakeBackend = {
      ...backendWith([], {}),
      recentItems: async (sectionId) =>
        sectionId === '1'
          ? [backendItem('m-new')]
          : [backendItem('sh-new', { sizeBytes: 0 })],
      showSize: async () => ({ sizeBytes: 7 * GB, dirPath: '/tv/New Show', dirNames: ['New Show'] }),
    };
    const res = await syncRecentlyAdded();
    expect(res.result).toBe(2);
    expect(getMediaItem('m-new')?.removed).toBe(0);
    expect(getMediaItem('sh-new')?.size_bytes).toBe(7 * GB); // new show sized inline
    // The listing carried no Location (dirPath null) — the episode-derived
    // folder from showSize() fills in dir_path/dir_name instead.
    expect(getMediaItem('sh-new')?.dir_path).toBe('/tv/New Show');
    expect(getMediaItem('sh-new')?.dir_name).toBe('New Show');
    expect(getMediaItem('old')?.removed).toBe(0); // no tombstoning here, ever
  });

  it("re-upserting a KNOWN show doesn't wipe the sizes-job path backfill", async () => {
    // The live-server regression: Location-less PMS → sizes job derives the
    // show folder; recentlyAdded then re-upserts the (known-size) show WITHOUT
    // recomputing it and must not null the path back out.
    setPlexSections([{ id: '2', title: 'TV', type: 'show', paths: [] }]);
    upsertMediaBatch([media('sh1', { sectionId: '2', libraryKind: 'show', sizeBytes: 5 * GB })]);
    fakeBackend = {
      ...backendWith([], {}),
      showSize: async () => ({ sizeBytes: 5 * GB, dirPath: '/tv/Airing Show', dirNames: ['Airing Show'] }),
    };
    await syncSizes(); // backfills dir_path
    expect(getMediaItem('sh1')?.dir_path).toBe('/tv/Airing Show');

    fakeBackend = {
      ...backendWith([], {}),
      // The show is in the recently-added window but its size is known, so
      // showSize is never called — the item arrives with dirPath null.
      recentItems: async () => [backendItem('sh1', { sizeBytes: 0 })],
      showSize: async () => {
        throw new Error('must not be called for known-size shows');
      },
    };
    await syncRecentlyAdded();
    expect(getMediaItem('sh1')?.dir_path).toBe('/tv/Airing Show'); // survived
  });

  it('a failing section is skipped, the rest still sync', async () => {
    setPlexSections([
      { id: '1', title: 'Movies', type: 'movie', paths: [] },
      { id: '2', title: 'TV', type: 'show', paths: [] },
    ]);
    fakeBackend = {
      ...backendWith([], {}),
      recentItems: async (sectionId) => {
        if (sectionId === '1') throw new Error('boom');
        return [backendItem('sh-new', { sizeBytes: 0 })];
      },
      showSize: async () => ({ sizeBytes: 1 * GB, dirPath: null, dirNames: [] }),
    };
    const res = await syncRecentlyAdded();
    expect(res.result).toBe(1);
    expect(getMediaItem('sh-new')).not.toBeNull();
  });
});

describe('syncSizes', () => {
  it('recomputes every show size; one failing show does not abort', async () => {
    upsertMediaBatch([
      media('sh1', { libraryKind: 'show', sizeBytes: 1 * GB }),
      media('sh2', { libraryKind: 'show', sizeBytes: 1 * GB }),
      media('mv', { libraryKind: 'movie', sizeBytes: 1 * GB }),
    ]);
    fakeBackend = {
      ...backendWith([], {}),
      showSize: async (rk) => {
        if (rk === 'sh1') throw new Error('boom');
        return {
          sizeBytes: 9 * GB,
          dirPath: '/tv/Show sh2',
          dirNames: ['Show sh2', 'Show sh2 Specials'], // multi-folder show
        };
      },
    };
    const res = await syncSizes();
    expect(res.result).toBe(1); // only sh2 updated
    expect(getMediaItem('sh2')?.size_bytes).toBe(9 * GB);
    expect(getMediaItem('sh1')?.size_bytes).toBe(1 * GB); // unchanged
    expect(getMediaItem('mv')?.size_bytes).toBe(1 * GB); // movies untouched
    // The derived show folder is backfilled alongside the size (the fallback
    // for servers that omit Location from listings); EVERY folder the show
    // spans lands in dir_name, newline-joined.
    expect(getMediaItem('sh2')?.dir_path).toBe('/tv/Show sh2');
    expect(getMediaItem('sh2')?.dir_name).toBe('Show sh2\nShow sh2 Specials');
  });
});

describe('syncWatchHistory', () => {
  it('uses native backend watch data when available', async () => {
    fakeBackend = {
      ...backendWith([], {}),
      getWatchData: async () => [
        { plexUserId: 'u1', ratingKey: '1', plays: 3, lastWatched: 500 },
      ],
    };
    const res = await syncWatchHistory();
    expect(res.result).toBe(1);
    expect(res.message).toContain('native');
    expect(watchedRatingKeys('u1').has('1')).toBe(true);
  });

  it('reports no source when the backend has none and Tautulli is unconfigured', async () => {
    fakeBackend = backendWith([], {}); // getWatchData → null (the Plex case)
    const res = await syncWatchHistory();
    expect(res.result).toBe(0);
    expect(res.message).toContain('No watch source');
  });
});

describe('syncSeerrRequests', () => {
  beforeEach(() => {
    writeSetting('seerr_url', 'http://seerr');
    writeSetting('seerr_api_key', 'k');
    upsertUser({ plexUserId: 'u1', username: 'one', email: 'one@x.com', thumb: null, isAdmin: false });
    upsertUser({ plexUserId: 'u2', username: 'two', email: 'two@x.com', thumb: null, isAdmin: false });
  });

  it('caches each user; one failing user does not abort the rest', async () => {
    vi.mocked(requestedRatingKeysForUser).mockImplementation(async (_b, _k, match) => {
      if (match.username === 'two') throw new Error('boom');
      return new Set(['42']);
    });
    const res = await syncSeerrRequests();
    expect(res.result).toBe(1); // only u1 cached
    expect(seerrRequestKeys('u1')).toEqual(['42']);
    expect(seerrRequestKeys('u2')).toEqual([]);
  });
});
