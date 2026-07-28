import { describe, expect, it } from 'vitest';
import {
  deriveShowDirPath,
  deriveShowDirPaths,
  lastSegment,
  normalizeName,
  parentPath,
  parentSegment,
  pathSegments,
  pathTail,
  titleKey,
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

  it('deriveShowDirPath: show folder = first segment under a library root', () => {
    const roots = ['/data/tv', '/data/anime'];
    expect(
      deriveShowDirPath(['/data/tv/Scrubs/Season 1/ep1.mkv'], roots)
    ).toBe('/data/tv/Scrubs');
    // Files directly in the show folder (no season dirs) work the same way.
    expect(deriveShowDirPath(['/data/anime/FLCL/ep1.mkv'], roots)).toBe('/data/anime/FLCL');
    // Root matching is case-insensitive but the ORIGINAL casing is preserved.
    expect(
      deriveShowDirPath(['/Data/TV/Scrubs/Season 1/ep1.mkv'], ['/data/tv'])
    ).toBe('/Data/TV/Scrubs');
    // Deeply nested extras still resolve to the top-level show folder.
    expect(
      deriveShowDirPath(['/data/tv/Scrubs/Season 1/Extras/cut.mkv'], roots)
    ).toBe('/data/tv/Scrubs');
  });

  it('deriveShowDirPath: no matching root → parent dir, hopping season folders', () => {
    expect(deriveShowDirPath(['/media/Shows/Scrubs/Season 2/ep.mkv'], [])).toBe(
      '/media/Shows/Scrubs'
    );
    expect(deriveShowDirPath(['/media/Shows/Scrubs/Specials/ep.mkv'], [])).toBe(
      '/media/Shows/Scrubs'
    );
    // Non-season subfolder: the parent IS the best guess.
    expect(deriveShowDirPath(['/media/Shows/Scrubs/ep.mkv'], [])).toBe('/media/Shows/Scrubs');
    expect(deriveShowDirPath([], ['/data/tv'])).toBeNull();
  });

  it('deriveShowDirPaths returns EVERY folder a show spans, deduped', () => {
    const roots = ['/data/tv'];
    expect(
      deriveShowDirPaths(
        [
          '/data/tv/Lupin the 3rd/Season 1/e1.mkv',
          '/data/tv/Lupin the 3rd/Season 2/e1.mkv', // same folder → deduped
          '/data/tv/Lupin III Movies & Specials/special1.mkv', // second folder
          '/data/tv/LUPIN THE 3RD/Season 3/e1.mkv', // case-variant → deduped
        ],
        roots
      )
    ).toEqual(['/data/tv/Lupin the 3rd', '/data/tv/Lupin III Movies & Specials']);
    expect(deriveShowDirPaths([], roots)).toEqual([]);
  });

  it('titleKey matches folder/file names to library titles', () => {
    // Year/bracket groups + release tags stripped.
    expect(titleKey('The Avengers (2012)')).toBe(titleKey('The Avengers'));
    expect(titleKey('Pulp Fiction (1994) [XviD]')).toBe(titleKey('Pulp Fiction'));
    expect(titleKey('Scrubs (2026) {tvdb-465690}')).toBe(titleKey('Scrubs'));
    // Dotted release name + extension.
    expect(titleKey('Some.Movie.2019.mkv')).toBe(titleKey('Some Movie'));
    // Trailing article moves to the front.
    expect(titleKey('40 Year Old Virgin The (2005)')).toBe(
      titleKey('The 40-Year-Old Virgin')
    );
    // Non-matches stay distinct.
    expect(titleKey('The Avengers')).not.toBe(titleKey('Avengers Endgame'));
  });

  it('normalizeName case-folds and NFC-normalizes', () => {
    expect(normalizeName('Show X')).toBe(normalizeName('SHOW x'));
    // NFD ("e" + combining acute) vs NFC ("é") must compare equal.
    expect(normalizeName('Ame\u0301lie')).toBe(normalizeName('Am\u00e9lie'));
  });
});
