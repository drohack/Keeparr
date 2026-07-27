import {
  extractGuids,
  getAllLeaves,
  getRecentlyAdded,
  getSectionItems,
  getSections,
  sumLeafSizes,
  sumPartSizes,
  type PlexMetadata,
} from '../plex';
import { getPlexBaseUrl, getPlexSections, getServerToken } from '../settings';
import { deriveShowDirPath, lastSegment, parentPath, parentSegment } from '../paths';
import type { LibraryKind } from '../types';
import type { BackendItem, BackendSection, MediaBackend } from './types';

function creds(): { baseUrl: string; token: string } {
  const baseUrl = getPlexBaseUrl();
  const token = getServerToken();
  if (!baseUrl || !token) throw new Error('Plex server not configured');
  return { baseUrl, token };
}

/** Exported for tests. Movies derive their on-disk names from Part.file (Media
 *  is inline in section listings); shows from their Location (series folder). */
export function mapItem(m: PlexMetadata, kind: LibraryKind, sizeBytes: number): BackendItem {
  const { tmdb, tvdb, imdb } = extractGuids(m);
  let dirName: string | null = null;
  let fileName: string | null = null;
  let dirPath: string | null = null;
  if (kind === 'movie') {
    const file = m.Media?.[0]?.Part?.[0]?.file ?? null;
    dirName = parentSegment(file);
    fileName = lastSegment(file);
    dirPath = parentPath(file);
  } else {
    const loc = m.Location?.[0]?.path ?? null;
    dirName = lastSegment(loc);
    dirPath = loc;
  }
  return {
    ratingKey: String(m.ratingKey),
    title: m.title,
    year: m.year ?? null,
    thumb: m.thumb ?? null,
    addedAt: m.addedAt ?? null,
    guidTmdb: tmdb,
    guidTvdb: tvdb,
    guidImdb: imdb,
    sizeBytes,
    dirName,
    fileName,
    dirPath,
  };
}

/** Plex backend: thin adapter over lib/plex.ts so Plex behavior is unchanged. */
export const plexBackend: MediaBackend = {
  async listSections(): Promise<BackendSection[]> {
    const { baseUrl, token } = creds();
    const secs = await getSections(baseUrl, token);
    return secs
      .filter((s) => s.type === 'movie' || s.type === 'show')
      .map((s) => ({
        id: s.key,
        title: s.title,
        kind: (s.type === 'movie' ? 'movie' : 'show') as LibraryKind,
        paths: (s.Location ?? []).map((l) => l.path),
      }));
  },
  async listSectionItems(sectionId, kind) {
    const { baseUrl, token } = creds();
    const items = await getSectionItems(baseUrl, token, sectionId, kind === 'movie' ? 1 : 2);
    return items.map((m) => mapItem(m, kind, kind === 'movie' ? sumPartSizes(m) : 0));
  },
  async recentItems(sectionId, kind, limit) {
    const { baseUrl, token } = creds();
    const items = await getRecentlyAdded(baseUrl, token, sectionId, kind === 'movie' ? 1 : 2, limit);
    return items.map((m) => mapItem(m, kind, kind === 'movie' ? sumPartSizes(m) : 0));
  },
  async showSize(ratingKey) {
    const { baseUrl, token } = creds();
    const leaves = await getAllLeaves(baseUrl, token, ratingKey);
    // Derive the show folder from episode paths — some PMS versions omit the
    // show's own Location from section listings, so this is the reliable source.
    const files: string[] = [];
    for (const leaf of leaves) {
      const file = leaf.Media?.[0]?.Part?.[0]?.file;
      if (file) files.push(file);
    }
    const roots = getPlexSections().flatMap((s) => s.paths ?? []);
    return {
      sizeBytes: sumLeafSizes(leaves),
      dirPath: deriveShowDirPath(files, roots),
    };
  },
  // Plex watch history comes from Tautulli (separate connector), not Plex itself.
  async getWatchData() {
    return null;
  },
};
