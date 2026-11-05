import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapItem, plexBackend } from './plex';
import type { PlexMetadata } from '../plex';
import * as plexApi from '../plex';
import { __setTestDbToMemory, __closeDb } from '../db';
import { writeSetting } from '../settings';
import { upsertUser } from '../queries';

const node = (over: Partial<PlexMetadata> = {}): PlexMetadata => ({
  ratingKey: '1',
  title: 'Title',
  ...over,
});

describe('plex backend mapItem (on-disk name capture)', () => {
  it('movie: folder + file names + full folder path derive from Part.file', () => {
    const row = mapItem(
      node({
        Media: [{ Part: [{ file: '/data/movies/Dune (2021)/Dune.2021.mkv', size: 1 }] }],
      }),
      'movie',
      1
    );
    expect(row.dirName).toBe('Dune (2021)');
    expect(row.fileName).toBe('Dune.2021.mkv');
    expect(row.dirPath).toBe('/data/movies/Dune (2021)');
  });

  it('movie: Windows-style PMS paths work (foreign separators)', () => {
    const row = mapItem(
      node({ Media: [{ Part: [{ file: 'D:\\Movies\\Heat (1995)\\heat.mkv' }] }] }),
      'movie',
      1
    );
    expect(row.dirName).toBe('Heat (1995)');
    expect(row.fileName).toBe('heat.mkv');
    expect(row.dirPath).toBe('D:\\Movies\\Heat (1995)');
  });

  it('show: folder name + path derive from Location', () => {
    const row = mapItem(
      node({ Location: [{ path: '/data/tv/Severance' }] }),
      'show',
      0
    );
    expect(row.dirName).toBe('Severance');
    expect(row.fileName).toBeNull();
    expect(row.dirPath).toBe('/data/tv/Severance');
  });

  it('missing path data → nulls (safety guard handles coverage)', () => {
    expect(mapItem(node(), 'movie', 1).dirName).toBeNull();
    expect(mapItem(node(), 'movie', 1).fileName).toBeNull();
    expect(mapItem(node(), 'movie', 1).dirPath).toBeNull();
    expect(mapItem(node(), 'show', 0).dirName).toBeNull();
    expect(mapItem(node(), 'show', 0).dirPath).toBeNull();
  });

  it('movie fileCount: counts distinct files across Media/Part (merged multi-part)', () => {
    // A merged two-part movie: two Media entries, one file each.
    const merged = mapItem(
      node({
        Media: [
          { Part: [{ file: '/m/Film (1970)/part1.mkv', size: 1 }] },
          { Part: [{ file: '/m/Film (1970) II/part2.mkv', size: 2 }] },
        ],
      }),
      'movie',
      3
    );
    expect(merged.fileCount).toBe(2);
    // Single file -> 1; duplicate file paths dedupe (like sumLeafSizes).
    expect(
      mapItem(node({ Media: [{ Part: [{ file: '/m/a.mkv' }] }] }), 'movie', 1).fileCount
    ).toBe(1);
    expect(
      mapItem(
        node({ Media: [{ Part: [{ file: '/m/a.mkv' }] }, { Part: [{ file: '/m/a.mkv' }] }] }),
        'movie',
        1
      ).fileCount
    ).toBe(1);
    // No Media data -> null; shows never carry a count.
    expect(mapItem(node(), 'movie', 1).fileCount).toBeNull();
    expect(mapItem(node({ Location: [{ path: '/tv/X' }] }), 'show', 0).fileCount).toBeNull();
  });
});

describe('plex backend getWatchData (owner attribution)', () => {
  beforeEach(() => {
    __setTestDbToMemory();
    writeSetting('plex_base_url', 'http://plex:32400');
    writeSetting('plex_server_token', 'tok');
    // Keeparr was set up by a SHARED user, so plex_owner_id is NOT the person
    // who owns the Plex server; a getOwnerId()-based remap would mis-attribute
    // the owner's history.
    writeSetting('plex_owner_id', '3629986');
    upsertUser({
      plexUserId: '10000001',
      username: 'serverowner',
      email: 'owner@example.com',
      thumb: null,
      isAdmin: true,
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => __closeDb());

  it('remaps PMS account 1 to the SERVER owner, not to plex_owner_id', async () => {
    vi.spyOn(plexApi, 'plexOwnerLogin').mockResolvedValue('owner@example.com');
    const spy = vi.spyOn(plexApi, 'plexWatchHistory').mockResolvedValue([]);
    await plexBackend.getWatchData();
    expect(spy).toHaveBeenCalledWith('http://plex:32400', 'tok', {
      ownerId: '10000001',
    });
    // The trap: plex_owner_id is 3629986 and must NOT be used here.
    expect(spy.mock.calls[0][2]).not.toMatchObject({ ownerId: '3629986' });
  });

  it('does not remap when the owner cannot be resolved to a Keeparr user', async () => {
    vi.spyOn(plexApi, 'plexOwnerLogin').mockResolvedValue('stranger@example.com');
    const spy = vi.spyOn(plexApi, 'plexWatchHistory').mockResolvedValue([]);
    await plexBackend.getWatchData();
    expect(spy).toHaveBeenCalledWith('http://plex:32400', 'tok', { ownerId: null });
  });

  it('does not remap when PMS will not say who the owner is', async () => {
    vi.spyOn(plexApi, 'plexOwnerLogin').mockResolvedValue(null);
    const spy = vi.spyOn(plexApi, 'plexWatchHistory').mockResolvedValue([]);
    await plexBackend.getWatchData();
    expect(spy).toHaveBeenCalledWith('http://plex:32400', 'tok', { ownerId: null });
  });
});
