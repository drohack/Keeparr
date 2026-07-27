import { describe, expect, it } from 'vitest';
import { mapItem } from './plex';
import type { PlexMetadata } from '../plex';

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
});
