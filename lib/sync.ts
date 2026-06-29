import {
  extractGuids,
  getAllLeaves,
  getRecentlyAdded,
  getSectionItems,
  getSections,
  sumLeafSizes,
  sumPartSizes,
  type PlexMetadata,
} from './plex';
import {
  getServerToken,
  getPlexBaseUrl,
  isServerConfigured,
  isTautulliConfigured,
  getTautulliUrl,
  getTautulliKey,
  isSeerrConfigured,
  getSeerrUrl,
  getSeerrKey,
  getManagedSectionIds,
  getManagedSections,
  setPlexSections,
} from './settings';
import { aggregatedWatchHistory } from './tautulli';
import { requestedRatingKeysForUser } from './seerr';
import {
  existingShowSizes,
  listUsers,
  replaceSeerrRequests,
  showRatingKeys,
  tombstoneStale,
  updateItemSize,
  upsertMediaBatch,
  upsertWatchBatch,
  type UpsertMediaInput,
} from './queries';
import type { LibraryKind } from './types';

const nowSec = () => Math.floor(Date.now() / 1000);

/** Result of a job runner: a count + a human message for the status row. */
export interface JobResult {
  result: number;
  message: string;
}

function requirePlex(): { baseUrl: string; token: string } {
  if (!isServerConfigured()) throw new Error('Plex server not configured');
  return { baseUrl: getPlexBaseUrl()!, token: getServerToken()! };
}

/**
 * Library inventory refresh (cheap): sections + items + adds/removes. Movie
 * sizes are read inline; show sizes are preserved from the existing cache and
 * only computed (via allLeaves) for newly-seen shows. The expensive full
 * recompute lives in the separate `syncSizes` job.
 */
export async function syncLibrary(): Promise<JobResult> {
  const { baseUrl, token } = requirePlex();
  const syncStart = nowSec();

  const sections = await getSections(baseUrl, token);
  const wanted = sections.filter((s) => s.type === 'movie' || s.type === 'show');
  // Persist every discovered section so the admin can choose which to manage…
  setPlexSections(
    wanted.map((s) => ({
      id: s.key,
      title: s.title,
      type: s.type,
      paths: (s.Location ?? []).map((l) => l.path),
    }))
  );

  // …but only scan the managed ones (empty = all). Unmanaged sections aren't
  // touched, so their rows tombstone via tombstoneStale below and drop out.
  const managed = new Set(getManagedSectionIds());
  const scanned = managed.size === 0 ? wanted : wanted.filter((s) => managed.has(s.key));

  const knownSizes = existingShowSizes();
  let itemsSynced = 0;

  for (const section of scanned) {
    const kind: LibraryKind = section.type === 'movie' ? 'movie' : 'show';
    const type = kind === 'movie' ? 1 : 2;
    const items = await getSectionItems(baseUrl, token, section.key, type);

    if (kind === 'movie') {
      const batch = items.map((m) =>
        toInput(m, section.key, 'movie', sumPartSizes(m))
      );
      itemsSynced += upsertMediaBatch(batch, syncStart);
    } else {
      const batch: UpsertMediaInput[] = [];
      for (const show of items) {
        const rk = String(show.ratingKey);
        let size = knownSizes.get(rk);
        if (size == null) {
          // New show — compute its size now so it never shows as 0 GB.
          try {
            size = sumLeafSizes(await getAllLeaves(baseUrl, token, rk));
          } catch {
            size = 0;
          }
        }
        batch.push(toInput(show, section.key, 'show', size));
      }
      itemsSynced += upsertMediaBatch(batch, syncStart);
    }
  }

  const removed = tombstoneStale(syncStart);
  return {
    result: itemsSynced,
    message: `Synced ${itemsSynced} items${removed ? `, removed ${removed}` : ''}.`,
  };
}

/**
 * Recently Added scan (cheap, frequent): for each managed library, pull the
 * newest items and upsert just those — so new titles appear between full scans.
 * Does NOT tombstone (removals are handled by the full Library scan).
 */
export async function syncRecentlyAdded(): Promise<JobResult> {
  const { baseUrl, token } = requirePlex();
  const syncStart = nowSec();
  const knownSizes = existingShowSizes();
  let added = 0;

  for (const section of getManagedSections()) {
    const kind: LibraryKind = section.type === 'movie' ? 'movie' : 'show';
    const type = kind === 'movie' ? 1 : 2;
    let items: PlexMetadata[];
    try {
      items = await getRecentlyAdded(baseUrl, token, section.id, type, 50);
    } catch {
      continue; // skip a failing section
    }
    const batch: UpsertMediaInput[] = [];
    for (const node of items) {
      let size: number;
      if (kind === 'movie') {
        size = sumPartSizes(node);
      } else {
        const rk = String(node.ratingKey);
        size = knownSizes.get(rk) ?? 0;
        if (size === 0) {
          try {
            size = sumLeafSizes(await getAllLeaves(baseUrl, token, rk));
          } catch {
            size = 0;
          }
        }
      }
      batch.push(toInput(node, section.id, kind, size));
    }
    added += upsertMediaBatch(batch, syncStart);
  }
  return { result: added, message: `Checked recently added (${added} items).` };
}

/**
 * Series size recompute (expensive): re-descend every show to episodes via
 * allLeaves and update its size on disk. Movie sizes are kept fresh by
 * `syncLibrary`, so this job only touches shows.
 */
export async function syncSizes(): Promise<JobResult> {
  const { baseUrl, token } = requirePlex();
  const keys = showRatingKeys();
  let updated = 0;
  for (const rk of keys) {
    try {
      const size = sumLeafSizes(await getAllLeaves(baseUrl, token, rk));
      updateItemSize(rk, size);
      updated++;
    } catch {
      // a single failing show shouldn't abort the recompute
    }
  }
  return { result: updated, message: `Recomputed sizes for ${updated} series.` };
}

/** Tautulli watch-history refresh. No-op (clear message) when unconfigured. */
export async function syncWatchHistory(): Promise<JobResult> {
  if (!isTautulliConfigured()) {
    return { result: 0, message: 'Tautulli not configured.' };
  }
  const rows = await aggregatedWatchHistory(getTautulliUrl()!, getTautulliKey()!);
  const n = upsertWatchBatch(rows);
  return { result: n, message: `Refreshed ${n} watch-history rows.` };
}

/**
 * Seerr request refresh: cache each known user's requested rating keys. Skips
 * cleanly when Seerr is unconfigured; one failing user doesn't abort the rest.
 */
export async function syncSeerrRequests(): Promise<JobResult> {
  if (!isSeerrConfigured()) {
    return { result: 0, message: 'Seerr not configured.' };
  }
  const url = getSeerrUrl()!;
  const key = getSeerrKey()!;
  const users = listUsers();
  let ok = 0;
  for (const u of users) {
    try {
      const keys = await requestedRatingKeysForUser(url, key, {
        email: u.email,
        username: u.username,
      });
      replaceSeerrRequests(u.plexUserId, [...keys]);
      ok++;
    } catch {
      // skip this user; keep going
    }
  }
  return { result: ok, message: `Cached Seerr requests for ${ok} user(s).` };
}

/**
 * Cache a single user's Seerr requests. Used to warm the cache on first login so
 * "Requested by me" works right away instead of waiting for the daily job.
 * No-op (returns 0) when Seerr isn't configured.
 */
export async function syncSeerrRequestsForUser(
  plexUserId: string,
  match: { email: string | null; username: string | null }
): Promise<number> {
  if (!isSeerrConfigured()) return 0;
  const keys = await requestedRatingKeysForUser(
    getSeerrUrl()!,
    getSeerrKey()!,
    match
  );
  replaceSeerrRequests(plexUserId, [...keys]);
  return keys.size;
}

function toInput(
  node: PlexMetadata,
  sectionId: string,
  kind: LibraryKind,
  sizeBytes: number
): UpsertMediaInput {
  const { tmdb, tvdb } = extractGuids(node);
  return {
    ratingKey: String(node.ratingKey),
    sectionId,
    libraryKind: kind,
    title: node.title,
    year: node.year ?? null,
    thumb: node.thumb ?? null,
    sizeBytes,
    addedAt: node.addedAt ?? null,
    guidTmdb: tmdb,
    guidTvdb: tvdb,
  };
}
