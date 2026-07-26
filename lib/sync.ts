import { getBackend, type BackendItem } from './mediaserver';
import {
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
  getSonarrInstances,
  getRadarrInstances,
  isArrConfigured,
} from './settings';
import { aggregatedWatchHistory } from './tautulli';
import { requestedRatingKeysForUser } from './seerr';
import { fetchSonarr, fetchRadarr, type ArrRecord } from './arr';
import {
  existingShowSizes,
  listUsers,
  ratingKeysByGuid,
  replaceArrItems,
  replaceArrConflicts,
  replaceArrUnmatched,
  replaceSeerrRequests,
  showRatingKeys,
  tombstoneStale,
  updateItemSize,
  upsertMediaBatch,
  upsertWatchBatch,
  type ArrConflictInput,
  type ArrItemInput,
  type ArrUnmatchedInput,
  type UpsertMediaInput,
} from './queries';
import type { LibraryKind } from './types';

const nowSec = () => Math.floor(Date.now() / 1000);

/** Result of a job runner: a count + a human message for the status row. */
export interface JobResult {
  result: number;
  message: string;
}

function requireServer(): void {
  if (!isServerConfigured()) throw new Error('Media server not configured');
}

/**
 * Library inventory refresh (cheap): sections + items + adds/removes. Movie
 * sizes are read inline; show sizes are preserved from the existing cache and
 * only computed (per-series) for newly-seen shows. The expensive full recompute
 * lives in the separate `syncSizes` job. Backend-agnostic via getBackend().
 */
export async function syncLibrary(): Promise<JobResult> {
  requireServer();
  const backend = getBackend();
  const syncStart = nowSec();

  const sections = await backend.listSections();
  // A 200 with no sections is a server hiccup (e.g. PMS mid-restart), not an
  // empty install — proceeding would overwrite the stored sections (and their
  // paths[] used for storage mapping) and tombstone the entire library.
  if (sections.length === 0) {
    throw new Error(
      'Backend returned no library sections; aborting sync to protect existing data.'
    );
  }
  // Persist every discovered section so the admin can choose which to manage…
  setPlexSections(
    sections.map((s) => ({ id: s.id, title: s.title, type: s.kind, paths: s.paths }))
  );

  // …but only scan the managed ones (empty = all). Unmanaged sections aren't
  // touched, so their rows tombstone via tombstoneStale below and drop out.
  const managed = new Set(getManagedSectionIds());
  const scanned = managed.size === 0 ? sections : sections.filter((s) => managed.has(s.id));

  const knownSizes = existingShowSizes();
  let itemsSynced = 0;
  // Sections that answered with zero items get no removal sweep below — an
  // empty-but-200 response (backend hiccup) must not tombstone a whole library.
  // Cost: a genuinely emptied library keeps its rows until it has items again.
  const emptySections: string[] = [];

  for (const section of scanned) {
    const items = await backend.listSectionItems(section.id, section.kind);
    if (items.length === 0) {
      emptySections.push(section.id);
      continue;
    }

    if (section.kind === 'movie') {
      const batch = items.map((m) => toInput(m, section.id, 'movie'));
      itemsSynced += upsertMediaBatch(batch, syncStart);
    } else {
      const batch: UpsertMediaInput[] = [];
      for (const show of items) {
        let size = knownSizes.get(show.ratingKey);
        if (size == null) {
          // New show — compute its size now so it never shows as 0 GB.
          try {
            size = await backend.showSize(show.ratingKey);
          } catch {
            size = 0;
          }
        }
        batch.push(toInput({ ...show, sizeBytes: size }, section.id, 'show'));
      }
      itemsSynced += upsertMediaBatch(batch, syncStart);
    }
  }

  const removed = tombstoneStale(syncStart, emptySections);
  const emptyNote = emptySections.length
    ? `; ${emptySections.length} section(s) returned no items (removal check skipped)`
    : '';
  return {
    result: itemsSynced,
    message: `Synced ${itemsSynced} items${removed ? `, removed ${removed}` : ''}${emptyNote}.`,
  };
}

/**
 * Recently Added scan (cheap, frequent): for each managed library, pull the
 * newest items and upsert just those — so new titles appear between full scans.
 * Does NOT tombstone (removals are handled by the full Library scan).
 */
export async function syncRecentlyAdded(): Promise<JobResult> {
  requireServer();
  const backend = getBackend();
  const syncStart = nowSec();
  const knownSizes = existingShowSizes();
  let added = 0;

  for (const section of getManagedSections()) {
    const kind: LibraryKind = section.type === 'movie' ? 'movie' : 'show';
    let items: BackendItem[];
    try {
      items = await backend.recentItems(section.id, kind, 50);
    } catch {
      continue; // skip a failing section
    }
    const batch: UpsertMediaInput[] = [];
    for (const node of items) {
      let size = node.sizeBytes;
      if (kind === 'show') {
        size = knownSizes.get(node.ratingKey) ?? 0;
        if (size === 0) {
          try {
            size = await backend.showSize(node.ratingKey);
          } catch {
            size = 0;
          }
        }
      }
      batch.push(toInput({ ...node, sizeBytes: size }, section.id, kind));
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
  requireServer();
  const backend = getBackend();
  const keys = showRatingKeys();
  let updated = 0;
  for (const rk of keys) {
    try {
      updateItemSize(rk, await backend.showSize(rk));
      updated++;
    } catch {
      // a single failing show shouldn't abort the recompute
    }
  }
  return { result: updated, message: `Recomputed sizes for ${updated} series.` };
}

/**
 * Watch-history refresh. Jellyfin/Emby expose their own watch data (native), so
 * we use that; Plex has none of its own, so it falls back to Tautulli. No-op
 * (clear message) when neither source is available.
 */
export async function syncWatchHistory(): Promise<JobResult> {
  if (isServerConfigured()) {
    const native = await getBackend().getWatchData();
    if (native) {
      const n = upsertWatchBatch(native);
      return { result: n, message: `Refreshed ${n} watch-history rows (native).` };
    }
  }
  if (!isTautulliConfigured()) {
    return { result: 0, message: 'No watch source configured.' };
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

function toArrInput(ratingKey: string, r: ArrRecord): ArrItemInput {
  return {
    ratingKey,
    source: r.source,
    instanceId: r.instanceId,
    instanceName: r.instanceName,
    arrId: r.arrId,
    monitored: r.monitored,
    status: r.status,
    quality: r.quality,
    qualityKind: r.qualityKind,
    rootFolder: r.rootFolder,
    arrSizeBytes: r.sizeOnDisk,
    tags: r.tags,
  };
}

/**
 * Sonarr/Radarr refresh: pull every instance's titles, match each to a Plex
 * media item by stable external id (tvdb→show, tmdb→movie), and replace the
 * arr_items cache. Skips cleanly when unconfigured; one failing instance doesn't
 * abort the rest. First instance to claim a rating_key wins (rare collisions).
 */
export async function syncArr(): Promise<JobResult> {
  if (!isArrConfigured()) {
    return { result: 0, message: 'Sonarr/Radarr not configured.' };
  }
  const tvdbMap = ratingKeysByGuid('tvdb');
  const tmdbMap = ratingKeysByGuid('tmdb');
  const imdbMap = ratingKeysByGuid('imdb'); // secondary axis (spans movies + shows)
  const matched: ArrItemInput[] = [];
  const unmatchedRecs: ArrUnmatchedInput[] = [];
  const conflictRecs: ArrConflictInput[] = [];
  // First instance to claim a rating_key wins; later claimants are recorded as
  // conflicts (two instances managing one title, or two arr entries resolving
  // to one merged Plex item) instead of being silently dropped.
  const seen = new Map<
    string,
    { source: string; instanceId: string; instanceName: string }
  >();
  let total = 0;
  let errors = 0;
  let ok = 0;

  const ingest = (recs: ArrRecord[], idMap: Map<string, string>) => {
    total += recs.length;
    for (const r of recs) {
      // Match on the primary id (tvdb/tmdb); fall back to imdb so items Plex only
      // matched to IMDb (no tmdb/tvdb) still resolve.
      const rk = idMap.get(r.matchId) ?? (r.imdbId ? imdbMap.get(r.imdbId) : undefined);
      if (!rk) {
        // No Plex item carries this title's tvdb/tmdb id. Only record it if it's
        // actually DOWNLOADED (has files on disk) — that's media on disk Plex
        // can't see (actionable). Wanted-but-not-downloaded titles are just
        // missing media and aren't Keeparr's concern, so we skip them.
        if (r.sizeOnDisk > 0) {
          unmatchedRecs.push({
            source: r.source,
            instanceId: r.instanceId,
            instanceName: r.instanceName,
            title: r.title,
            extKind: r.source === 'sonarr' ? 'tvdb' : 'tmdb',
            extId: r.matchId,
            sizeBytes: r.sizeOnDisk,
          });
        }
        continue;
      }
      const first = seen.get(rk);
      if (first) {
        conflictRecs.push({
          ratingKey: rk,
          title: r.title,
          firstSource: first.source,
          firstInstanceId: first.instanceId,
          firstInstanceName: first.instanceName,
          source: r.source,
          instanceId: r.instanceId,
          instanceName: r.instanceName,
          sizeOnDisk: r.sizeOnDisk,
        });
        continue;
      }
      seen.set(rk, {
        source: r.source,
        instanceId: r.instanceId,
        instanceName: r.instanceName,
      });
      matched.push(toArrInput(rk, r));
    }
  };

  const instanceCount = getSonarrInstances().length + getRadarrInstances().length;
  // Instances that errored this run keep their cached rows in the replace below
  // — their fresh data is missing from this run, not gone from the arr.
  const failedInstanceIds: string[] = [];
  for (const inst of getSonarrInstances()) {
    try {
      ingest(await fetchSonarr(inst), tvdbMap);
      ok++;
    } catch {
      errors++;
      failedInstanceIds.push(inst.id);
    }
  }
  for (const inst of getRadarrInstances()) {
    try {
      ingest(await fetchRadarr(inst), tmdbMap);
      ok++;
    } catch {
      errors++;
      failedInstanceIds.push(inst.id);
    }
  }

  // Don't wipe the cache when nothing was reachable (every instance errored) —
  // keep the last good data rather than blanking the Quality view.
  if (ok === 0 && instanceCount > 0) {
    return {
      result: 0,
      message: `No instances reachable (${errors} error(s)); kept existing cache.`,
    };
  }

  replaceArrItems(matched, failedInstanceIds);
  replaceArrUnmatched(unmatchedRecs, failedInstanceIds);
  replaceArrConflicts(conflictRecs, failedInstanceIds);
  const unmatched = unmatchedRecs.length;
  const conflictNote = conflictRecs.length
    ? `, ${conflictRecs.length} cross-instance conflict(s)`
    : '';
  const errNote = errors
    ? ` (${errors} instance error(s); their cached data kept)`
    : '';
  return {
    result: matched.length,
    message: `Matched ${matched.length} of ${total} titles (${unmatched} downloaded but not in Plex${conflictNote})${errNote}.`,
  };
}

function toInput(
  item: BackendItem,
  sectionId: string,
  kind: LibraryKind
): UpsertMediaInput {
  return {
    ratingKey: item.ratingKey,
    sectionId,
    libraryKind: kind,
    title: item.title,
    year: item.year,
    thumb: item.thumb,
    sizeBytes: item.sizeBytes,
    addedAt: item.addedAt,
    guidTmdb: item.guidTmdb,
    guidTvdb: item.guidTvdb,
    guidImdb: item.guidImdb,
  };
}
