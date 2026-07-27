import { describe, expect, it } from 'vitest';
import {
  lastSegment,
  normalizeName,
  parentPath,
  parentSegment,
  pathSegments,
  pathTail,
} from './paths';

describe('paths (foreign-path string helpers)', () => {
  it('pathSegments splits POSIX, Windows, and mixed separators', () => {
    expect(pathSegments('/data/tv/Show X')).toEqual(['data', 'tv', 'Show X']);
    expect(pathSegments('C:\\Media\\Movies\\Dune (2021)')).toEqual([
      'C:',
      'Media',
      'Movies',
      'Dune (2021)',
    ]);
    expect(pathSegments('/data//tv///Show')).toEqual(['data', 'tv', 'Show']);
    expect(pathSegments('smb://nas/share\\TV')).toEqual(['smb:', 'nas', 'share', 'TV']);
  });

  it('lastSegment handles trailing separators and empty input', () => {
    expect(lastSegment('/data/tv/Show X')).toBe('Show X');
    expect(lastSegment('/data/tv/Show X/')).toBe('Show X');
    expect(lastSegment('C:\\Media\\Movies\\file.mkv')).toBe('file.mkv');
    expect(lastSegment('')).toBeNull();
    expect(lastSegment(null)).toBeNull();
    expect(lastSegment(undefined)).toBeNull();
    expect(lastSegment('///')).toBeNull();
  });

  it('parentSegment returns the containing folder name', () => {
    expect(parentSegment('/movies/Dune (2021)/dune.mkv')).toBe('Dune (2021)');
    expect(parentSegment('C:\\Media\\Movies\\Dune\\dune.mkv')).toBe('Dune');
    expect(parentSegment('/loose.mkv')).toBeNull(); // only one segment
    expect(parentSegment(null)).toBeNull();
  });

  it('parentPath strips the last segment, preserving original separators', () => {
    expect(parentPath('/data/tv/Scrubs/ep.mkv')).toBe('/data/tv/Scrubs');
    expect(parentPath('D:\\Movies\\Dune\\d.mkv')).toBe('D:\\Movies\\Dune');
    expect(parentPath('/data/tv/Scrubs/')).toBe('/data/tv'); // trailing separator
    expect(parentPath('/media/movie.mkv')).toBe('/media');
    expect(parentPath('/loose.mkv')).toBeNull(); // root-level: no useful parent
    expect(parentPath('single')).toBeNull();
    expect(parentPath(null)).toBeNull();
    expect(parentPath(undefined)).toBeNull();
  });

  it('pathTail shows the last segments, marking dropped ones', () => {
    expect(pathTail('/data/tv/Scrubs')).toBe('…/tv/Scrubs');
    expect(pathTail('D:\\Media\\Movies\\Dune (2021)')).toBe('…/Movies/Dune (2021)');
    expect(pathTail('/tv/Scrubs')).toBe('tv/Scrubs'); // nothing dropped → no ellipsis
    expect(pathTail('Scrubs')).toBe('Scrubs');
    expect(pathTail('/a/b/c/d', 3)).toBe('…/b/c/d');
  });

  it('normalizeName case-folds and NFC-normalizes', () => {
    expect(normalizeName('Show X')).toBe(normalizeName('SHOW x'));
    // NFD ("e" + combining acute) vs NFC ("é") must compare equal.
    expect(normalizeName('Ame\u0301lie')).toBe(normalizeName('Am\u00e9lie'));
  });
});
