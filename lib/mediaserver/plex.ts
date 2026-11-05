import {
  extractGuids,
  getAllLeaves,
  getRecentlyAdded,
  getSectionItems,
  getSections,
  plexOwnerLogin,
  plexWatchHistory,
  sumLeafSizes,
  sumPartSizes,
  type PlexMetadata,
} from '../plex';
import {
  getPlexBaseUrl,
  getPlexOwnerToken,
  getPlexSections,
  getServerToken,
} from '../settings';
import { findUserIdByLogin } from '../queries';
import { deriveShowDirPaths, lastSegment, parentPath, parentSegment } from '../paths';
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
  let fileCount: number | null = null;
  if (kind === 'movie') {
    const file = m.Media?.[0]?.Part?.[0]?.file ?? null;
    dirName = parentSegment(file);
    fileName = lastSegment(file);
    dirPath = parentPath(file);
    // Distinct video files merged into this item (multi-part movies, extra
    // versions): every Part, deduped by file path like sumLeafSizes.
    const files = new Set<string>();
    let parts = 0;
    for (const media of m.Media ?? []) {
      for (const part of media.Part ?? []) {
        parts += 1;
        if (part.file) files.add(part.file);
      }
    }
    fileCount = files.size > 0 ? files.size : parts > 0 ? parts : null;
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
    fileCount,
  };
}

/** Plex backend: thin adapter over lib/plex.ts. */
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
    // Derive the show folder from episode paths - some PMS versions omit the
    // show's own Location from section listings, so this is the reliable source.
    const files: string[] = [];
    for (const leaf of leaves) {
      const file = leaf.Media?.[0]?.Part?.[0]?.file;
      if (file) files.push(file);
    }
    const roots = getPlexSections().flatMap((s) => s.paths ?? []);
    const dirs = deriveShowDirPaths(files, roots);
    return {
      sizeBytes: sumLeafSizes(leaves),
      dirPath: dirs[0] ?? null,
      dirNames: dirs.map((d) => lastSegment(d)).filter((n): n is string => !!n),
    };
  },
  // Plex's own play history - deeper than Tautulli's (it starts when the server
  // was built, not when Tautulli was installed). `lib/sync.ts` merges the two.
  //
  // History labels the SERVER OWNER with the bare local account id 1, so we ask
  // PMS who that is and resolve them to a Keeparr user. Do NOT substitute
  // `getOwnerId()` here: that setting names whoever first set Keeparr up, which
  // is often a shared user, and using it would file the server owner's viewing
  // under the wrong person. Unresolvable => no remap, leaving those rows under
  // "1" - they still count for "never watched by anyone", just not for one
  // user's own watched badges. Under-attribution beats mis-attribution.
  async getWatchData() {
    const { baseUrl, token } = creds();
    // Prefer an explicitly configured owner token: Plex hands over EVERY
    // account's history only to the server owner, and silently truncates to
    // the token holder otherwise. Falls back to the ordinary server token,
    // which still yields that one user's (much deeper than Tautulli) history.
    const histToken = getPlexOwnerToken() || token;
    const ownerId = findUserIdByLogin(await plexOwnerLogin(baseUrl, histToken));
    return plexWatchHistory(baseUrl, histToken, { ownerId });
  },
};
