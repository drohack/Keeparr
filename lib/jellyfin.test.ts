import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setTestDbToMemory, __closeDb } from './db';
import {
  getSeriesSize,
  providerId,
  sumMediaSources,
  toBackendItem,
  type JfItem,
} from './jellyfin';

const GB = 1024 ** 3;

describe('jellyfin mapping (pure)', () => {
  it('providerId is case-insensitive and handles missing ids', () => {
    expect(providerId({ Tmdb: '550' }, 'tmdb')).toBe('550');
    expect(providerId({ tvdb: '81189' }, 'Tvdb')).toBe('81189');
    expect(providerId({ Imdb: 'tt0137523' }, 'tmdb')).toBeNull();
    expect(providerId(undefined, 'tmdb')).toBeNull();
  });

  it('sumMediaSources counts each physical file once (multi-episode files dedupe by Path)', () => {
    const items: JfItem[] = [
      // Two episodes packed in ONE file → Plex/Jellyfin report the full size on
      // each; must be counted once.
      { MediaSources: [{ Path: '/tv/show/s01e01e02.mkv', Size: 2 * GB }] },
      { MediaSources: [{ Path: '/tv/show/s01e01e02.mkv', Size: 2 * GB }] },
      // A distinct file → added.
      { MediaSources: [{ Path: '/tv/show/s01e03.mkv', Size: 1 * GB }] },
      // No path → can't dedupe, summed as-is.
      { MediaSources: [{ Size: 500 }] },
    ];
    expect(sumMediaSources(items)).toBe(3 * GB + 500);
  });

  it('toBackendItem maps id/title/year/guids/date/size', () => {
    const it: JfItem = {
      Id: 'abc123',
      Name: 'The Matrix',
      ProductionYear: 1999,
      DateCreated: '2020-01-02T03:04:05.000Z',
      ProviderIds: { Tmdb: '603' },
      MediaSources: [{ Path: '/movies/matrix.mkv', Size: 8 * GB }],
    };
    const row = toBackendItem(it, true); // movie → include size
    expect(row.ratingKey).toBe('abc123');
    expect(row.title).toBe('The Matrix');
    expect(row.year).toBe(1999);
    expect(row.thumb).toBe('abc123'); // image proxy builds the URL from the id
    expect(row.guidTmdb).toBe('603');
    expect(row.guidTvdb).toBeNull();
    expect(row.sizeBytes).toBe(8 * GB);
    expect(row.addedAt).toBe(Math.floor(Date.parse('2020-01-02T03:04:05.000Z') / 1000));
    // Movie disk names fall back to MediaSources when the item has no Path.
    expect(row.dirName).toBe('movies');
    expect(row.fileName).toBe('matrix.mkv');
    expect(row.fileCount).toBe(1);
  });

  it('toBackendItem movie fileCount counts distinct MediaSources paths', () => {
    const merged = toBackendItem(
      {
        Id: 'm2',
        Name: 'Two-Parter',
        MediaSources: [
          { Path: '/movies/tp/part1.mkv', Size: 1 },
          { Path: '/movies/tp/part2.mkv', Size: 2 },
        ],
      },
      true
    );
    expect(merged.fileCount).toBe(2);
    // No sources → null; series never carry a count.
    expect(toBackendItem({ Id: 'm3', Name: 'X' }, true).fileCount).toBeNull();
    expect(
      toBackendItem({ Id: 's1', Name: 'Show', Path: '/tv/Show' }, false).fileCount
    ).toBeNull();
  });

  it('toBackendItem movie prefers the item Path for disk names', () => {
    const row = toBackendItem(
      {
        Id: 'm1',
        Name: 'Dune',
        Path: '/movies/Dune (2021)/dune.mkv',
        MediaSources: [{ Path: '/other/place.mkv', Size: 1 }],
      },
      true
    );
    expect(row.dirName).toBe('Dune (2021)');
    expect(row.fileName).toBe('dune.mkv');
    expect(row.dirPath).toBe('/movies/Dune (2021)');
  });

  it('toBackendItem with withSize=false (series) returns size 0 (sized via showSize)', () => {
    const it: JfItem = {
      Id: 'series1',
      Name: 'Breaking Bad',
      Path: '/tv/Breaking Bad',
      ProviderIds: { Tvdb: '81189' },
      MediaSources: [{ Path: '/x', Size: 99 * GB }],
    };
    const row = toBackendItem(it, false);
    expect(row.sizeBytes).toBe(0);
    expect(row.guidTvdb).toBe('81189');
    // Series Path IS the folder — its basename is the disk name.
    expect(row.dirName).toBe('Breaking Bad');
    expect(row.fileName).toBeNull();
    expect(row.dirPath).toBe('/tv/Breaking Bad');
  });
});

function fakeRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('paged /Items reads (StartIndex/Limit)', () => {
  beforeEach(() => {
    __setTestDbToMemory(); // authHeaders reads the persisted device id
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => __closeDb());

  it('getSeriesSize pages until TotalRecordCount is exhausted', async () => {
    const ep = (path: string, size: number): JfItem => ({
      MediaSources: [{ Path: path, Size: size }],
    });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      // Server answers with fewer rows than asked — the loop must follow
      // TotalRecordCount, not assume one page covers everything.
      .mockResolvedValueOnce(
        fakeRes({
          Items: [ep('/tv/Show/Season 1/a.mkv', 1 * GB), ep('/tv/Show/Season 1/b.mkv', 2 * GB)],
          TotalRecordCount: 3,
        })
      )
      .mockResolvedValueOnce(
        fakeRes({ Items: [ep('/tv/Show/Season 2/c.mkv', 4 * GB)], TotalRecordCount: 3 })
      );
    const disk = await getSeriesSize('http://jf:8096', 'tok', 'series1');
    expect(disk.sizeBytes).toBe(7 * GB);
    // Series folder derived from episode paths (season folder hopped).
    expect(disk.dirPath).toBe('/tv/Show');
    expect(spy).toHaveBeenCalledTimes(2);
    // The second page picked up where the first left off.
    expect(String(spy.mock.calls[1][0])).toContain('StartIndex=2');
  });

  it('stops immediately on an empty page', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeRes({ Items: [], TotalRecordCount: 0 }));
    await expect(getSeriesSize('http://jf:8096', 'tok', 's')).resolves.toEqual({
      sizeBytes: 0,
      dirPath: null,
      dirNames: [],
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
