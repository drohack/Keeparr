import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { __setTestDbToMemory, __closeDb } from './db';
import { getSetting } from './queries';
import { normalizeSonarr, normalizeRadarr } from './arr';
import {
  getSonarrInstances,
  setSonarrInstances,
  getRadarrInstances,
  setRadarrInstances,
  isArrConfigured,
  type ArrInstance,
} from './settings';

const inst: ArrInstance = { id: 'i1', name: 'Main', url: 'http://x', apiKey: 'k' };

describe('arr normalize (pure, no network)', () => {
  it('normalizes a Sonarr series: profile name + resolved tags', () => {
    const tags = new Map([
      [1, 'Anime'],
      [2, 'Bounty'],
    ]);
    const profiles = new Map([[5, 'Ultra-HD']]);
    const r = normalizeSonarr(
      {
        id: 10,
        title: 'Frieren',
        tvdbId: 424536,
        monitored: true,
        status: 'continuing',
        qualityProfileId: 5,
        rootFolderPath: '/anime',
        path: '/anime/Frieren',
        statistics: { sizeOnDisk: 1234 },
        tags: [1, 2, 9], // 9 is unknown → dropped
      },
      inst,
      tags,
      profiles
    );
    expect(r).toMatchObject({
      source: 'sonarr',
      matchId: '424536',
      quality: 'Ultra-HD',
      qualityKind: 'profile',
      monitored: true,
      sizeOnDisk: 1234,
      arrId: 10,
      path: '/anime/Frieren',
    });
    expect(r?.tags).toEqual(['Anime', 'Bounty']);
  });

  it('returns null for a series with no tvdbId (cannot be matched)', () => {
    expect(normalizeSonarr({ id: 1, title: 'x' }, inst, new Map(), new Map())).toBeNull();
  });

  it('normalizes a Radarr movie: actual file quality', () => {
    const r = normalizeRadarr(
      {
        id: 7,
        title: 'Dune',
        tmdbId: 438631,
        imdbId: 'tt1160419',
        monitored: false,
        status: 'released',
        sizeOnDisk: 80,
        path: '/movies/Dune (2021)',
        movieFile: { quality: { quality: { name: 'Bluray-2160p' } } },
        tags: [2],
      },
      inst,
      new Map([[2, 'Bounty']])
    );
    expect(r).toMatchObject({
      source: 'radarr',
      matchId: '438631',
      imdbId: 'tt1160419',
      quality: 'Bluray-2160p',
      qualityKind: 'file',
      monitored: false,
      path: '/movies/Dune (2021)',
    });
    expect(r?.tags).toEqual(['Bounty']);
  });

  it('movie with no downloaded file → null quality', () => {
    const r = normalizeRadarr({ id: 7, title: 'x', tmdbId: 1 }, inst, new Map());
    expect(r?.quality).toBeNull();
  });
});

describe('arr settings (encrypted round-trip)', () => {
  beforeEach(() => {
    __setTestDbToMemory();
  });
  afterAll(() => {
    __closeDb();
  });

  it('round-trips Sonarr + Radarr instances', () => {
    expect(isArrConfigured()).toBe(false);
    setSonarrInstances([
      { id: 's1', name: 'Main', url: 'http://localhost:8989', apiKey: 'secret' },
    ]);
    setRadarrInstances([
      { id: 'r1', name: 'Movies', url: 'http://localhost:7878', apiKey: 'rkey' },
    ]);
    expect(isArrConfigured()).toBe(true);
    expect(getSonarrInstances()[0]).toMatchObject({
      id: 's1',
      url: 'http://localhost:8989',
      apiKey: 'secret',
    });
    expect(getRadarrInstances()[0].apiKey).toBe('rkey');
  });

  it('stores the blob encrypted at rest (no plaintext key)', () => {
    setSonarrInstances([{ id: 's1', name: 'M', url: 'http://h', apiKey: 'topsecret' }]);
    const raw = getSetting('sonarr_instances');
    expect(raw).toContain('enc:v1:');
    expect(raw).not.toContain('topsecret');
  });
});
