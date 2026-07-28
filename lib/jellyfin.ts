import { fetchJson } from './http';
import { getMediaDeviceId, type MediaServerType } from './settings';
import { deriveShowDirPaths, lastSegment, parentPath, parentSegment } from './paths';
import type { LibraryKind } from './types';
import type { BackendItem, BackendSection } from './mediaserver/types';

/**
 * Jellyfin / Emby client. Both speak the same "MediaBrowser" API (Jellyfin is an
 * Emby fork), so one client serves both — `kind` only tweaks the auth header's
 * product version. Node-only (used from route handlers + the sync engine).
 *
 * Endpoints verified against Seerr's `server/api/jellyfin.ts`:
 *   POST /Users/AuthenticateByName        — login (username/password)
 *   GET  /System/Info/Public              — unauthenticated server identity (Test)
 *   GET  /System/Info                     — authenticated server identity
 *   GET  /Users                           — server users (for import)
 *   GET  /Library/MediaFolders            — libraries           (Phase 3)
 *   GET  /Items?Recursive=true&fields=…   — items + sizes + ids (Phase 3)
 */

const PRODUCT = 'Keeparr';
const VERSION = '1.0.0';

/** Stable device id for the MediaBrowser auth header (persisted once). */
export function getDeviceId(): string {
  return getMediaDeviceId();
}

/**
 * The MediaBrowser authorization header value. Sent on BOTH `Authorization`
 * (modern Jellyfin) and `X-Emby-Authorization` (Emby + older Jellyfin) for
 * maximum compatibility.
 */
function authValue(token?: string): string {
  const parts = [
    `Client="${PRODUCT}"`,
    `Device="${PRODUCT}"`,
    `DeviceId="${getDeviceId()}"`,
    `Version="${VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

function authHeaders(token?: string): Record<string, string> {
  const v = authValue(token);
  return { Authorization: v, 'X-Emby-Authorization': v };
}

const base = (url: string) => url.trim().replace(/\/$/, '');

export interface JellyfinAuthResult {
  accessToken: string;
  user: { id: string; name: string; isAdmin: boolean };
}

/** Authenticate a username/password against the server. Throws on bad creds. */
export async function authenticateByName(
  baseUrl: string,
  username: string,
  password: string
): Promise<JellyfinAuthResult> {
  const res = await fetch(`${base(baseUrl)}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ Username: username, Pw: password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new Error('Invalid username or password.');
  if (!res.ok) throw new Error(`Jellyfin auth → HTTP ${res.status}`);
  const d = (await res.json()) as {
    AccessToken?: string;
    User?: { Id?: string; Name?: string; Policy?: { IsAdministrator?: boolean } };
  };
  if (!d.AccessToken || !d.User?.Id) {
    throw new Error('Jellyfin auth returned no access token.');
  }
  return {
    accessToken: d.AccessToken,
    user: {
      id: String(d.User.Id),
      name: String(d.User.Name ?? username),
      isAdmin: d.User.Policy?.IsAdministrator === true,
    },
  };
}

export interface MediaServerInfo {
  id: string;
  name: string;
}

/** Unauthenticated server identity — for the "Test" button before login. */
export async function getPublicServerInfo(baseUrl: string): Promise<MediaServerInfo> {
  const d = await fetchJson<{ Id?: string; ServerName?: string }>(
    `${base(baseUrl)}/System/Info/Public`,
    { label: 'Jellyfin System/Info/Public' }
  );
  return { id: String(d.Id ?? ''), name: String(d.ServerName ?? 'Jellyfin server') };
}

/** Authenticated server identity (id + friendly name). */
export async function getServerInfo(
  baseUrl: string,
  token: string
): Promise<MediaServerInfo> {
  const d = await fetchJson<{ Id?: string; ServerName?: string }>(
    `${base(baseUrl)}/System/Info`,
    { headers: authHeaders(token), label: 'Jellyfin System/Info' }
  );
  return { id: String(d.Id ?? ''), name: String(d.ServerName ?? 'Jellyfin server') };
}

export interface JellyfinUserRow {
  id: string;
  username: string | null;
  thumb: string | null;
  isAdmin: boolean;
}

/** List the server's user accounts (for the admin "import users" screen). */
export async function getUsers(
  baseUrl: string,
  token: string
): Promise<JellyfinUserRow[]> {
  const arr = await fetchJson<Record<string, unknown>[]>(`${base(baseUrl)}/Users`, {
    headers: authHeaders(token),
    label: 'Jellyfin Users',
  });
  return (Array.isArray(arr) ? arr : []).map((u) => ({
    id: String(u.Id ?? ''),
    username: (u.Name as string) ?? null,
    thumb: (u.PrimaryImageTag as string) ? String(u.Id) : null,
    isAdmin:
      (u.Policy as { IsAdministrator?: boolean } | undefined)?.IsAdministrator === true,
  }));
}

/** Test reachability + credentials-free identity for the Connections "Test" button. */
export async function testJellyfin(
  baseUrl: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const info = await getPublicServerInfo(baseUrl);
    return { ok: true, message: `Reached ${info.name}` };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// `kind` is accepted by callers for clarity / future Emby-specific tweaks; the
// API surface used here is identical between Jellyfin and Emby.
export type JellyfinKind = Extract<MediaServerType, 'jellyfin' | 'emby'>;

// ---------------------------------------------------------------------------
// Read API (libraries / items / sizes) — used by the sync engine via the
// MediaBackend in lib/mediaserver/jellyfin.ts.
// ---------------------------------------------------------------------------

export interface JfItem {
  Id?: string;
  Name?: string;
  ProductionYear?: number;
  DateCreated?: string;
  /** Movie: the video file path; Series: the series folder. */
  Path?: string;
  ProviderIds?: Record<string, string>;
  MediaSources?: { Path?: string; Size?: number }[];
}

/** Case-insensitive ProviderIds lookup ("Tmdb"/"tmdb"/"TheMovieDb" vary). Exported for tests. */
export function providerId(ids: Record<string, string> | undefined, name: string): string | null {
  if (!ids) return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(ids)) {
    if (k.toLowerCase() === want && v) return String(v);
  }
  return null;
}

function isoToUnix(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Sum MediaSources sizes, counting each physical file once (multi-episode files
 *  share a Path and would otherwise be over-counted — mirrors Plex sumLeafSizes).
 *  Exported for tests. */
export function sumMediaSources(items: JfItem[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const it of items) {
    for (const ms of it.MediaSources ?? []) {
      if (ms.Path) {
        if (seen.has(ms.Path)) continue;
        seen.add(ms.Path);
      }
      total += ms.Size ?? 0;
    }
  }
  return total;
}

/** Map a raw Jellyfin item to our generic BackendItem. Exported for tests.
 *  `withSize` doubles as the movie/series discriminator (movies carry size). */
export function toBackendItem(it: JfItem, withSize: boolean): BackendItem {
  // On-disk names for the disk-orphan scan. Movie Path is the video FILE (fall
  // back to MediaSources); Series Path is the series FOLDER itself.
  let dirName: string | null = null;
  let fileName: string | null = null;
  let dirPath: string | null = null;
  if (withSize) {
    const file = it.Path ?? it.MediaSources?.[0]?.Path ?? null;
    dirName = parentSegment(file);
    fileName = lastSegment(file);
    dirPath = parentPath(file);
  } else {
    dirName = lastSegment(it.Path ?? null);
    dirPath = it.Path ?? null;
  }
  return {
    ratingKey: String(it.Id),
    title: String(it.Name ?? ''),
    year: it.ProductionYear ?? null,
    thumb: it.Id ? String(it.Id) : null, // proxy builds /Items/{id}/Images/Primary
    addedAt: isoToUnix(it.DateCreated),
    guidTmdb: providerId(it.ProviderIds, 'tmdb') ?? providerId(it.ProviderIds, 'themoviedb'),
    guidTvdb: providerId(it.ProviderIds, 'tvdb'),
    guidImdb: providerId(it.ProviderIds, 'imdb'),
    sizeBytes: withSize ? sumMediaSources([it]) : 0,
    dirName,
    fileName,
    dirPath,
  };
}

/** Libraries to track: movie/show CollectionFolders (skip music/books/etc). */
export async function getLibraries(
  baseUrl: string,
  token: string
): Promise<BackendSection[]> {
  const d = await fetchJson<{ Items?: Record<string, unknown>[] }>(
    `${base(baseUrl)}/Library/MediaFolders`,
    { headers: authHeaders(token), label: 'Jellyfin MediaFolders' }
  );
  const out: BackendSection[] = [];
  for (const f of d.Items ?? []) {
    const ct = String(f.CollectionType ?? '').toLowerCase();
    const kind: LibraryKind | null =
      ct === 'movies' ? 'movie' : ct === 'tvshows' ? 'show' : null;
    if (!kind) continue; // skip music/books/boxsets/homevideos/mixed
    out.push({ id: String(f.Id), title: String(f.Name ?? ''), kind, paths: [] });
  }
  return out;
}

const itemTypeFor = (kind: LibraryKind) => (kind === 'movie' ? 'Movie' : 'Series');

/** Page through all items in a library. Movies carry size; series return 0
 *  (sized via getSeriesSize). */
export async function getItems(
  baseUrl: string,
  token: string,
  parentId: string,
  kind: LibraryKind,
  recentLimit?: number
): Promise<BackendItem[]> {
  const out: BackendItem[] = [];
  const pageSize = recentLimit ?? 200;
  let start = 0;
  for (;;) {
    const qs = new URLSearchParams({
      ParentId: parentId,
      Recursive: 'true',
      IncludeItemTypes: itemTypeFor(kind),
      fields: 'ProviderIds,MediaSources,DateCreated,Path',
      StartIndex: String(start),
      Limit: String(pageSize),
    });
    if (recentLimit) {
      qs.set('SortBy', 'DateCreated');
      qs.set('SortOrder', 'Descending');
    }
    const d = await fetchJson<{ Items?: JfItem[]; TotalRecordCount?: number }>(
      `${base(baseUrl)}/Items?${qs.toString()}`,
      { headers: authHeaders(token), label: 'Jellyfin Items' }
    );
    const batch = d.Items ?? [];
    for (const it of batch) out.push(toBackendItem(it, kind === 'movie'));
    start += batch.length;
    const total = d.TotalRecordCount ?? batch.length;
    if (recentLimit || batch.length === 0 || start >= total) break;
  }
  return out;
}

/**
 * Page through an /Items-style endpoint (StartIndex/Limit, TotalRecordCount
 * envelope) until exhausted — same loop as getItems. A flat Limit silently
 * truncates large result sets (episodes dominate watch history).
 */
async function fetchAllPages<T>(
  urlWithoutPaging: string,
  token: string,
  label: string,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  let start = 0;
  for (;;) {
    const d = await fetchJson<{ Items?: T[]; TotalRecordCount?: number }>(
      `${urlWithoutPaging}&StartIndex=${start}&Limit=${pageSize}`,
      { headers: authHeaders(token), label }
    );
    const batch = d.Items ?? [];
    out.push(...batch);
    start += batch.length;
    const total = d.TotalRecordCount ?? batch.length;
    if (batch.length === 0 || start >= total) break;
  }
  return out;
}

/**
 * Native watch history across all server users. Movies key on their item id;
 * episodes roll up to their series (SeriesId) so a series counts as watched if
 * any episode is — mirroring how the Tautulli path aggregates to grandparent.
 * Returns rows ready for `upsertWatchBatch`.
 */
export async function getWatchHistory(
  baseUrl: string,
  token: string
): Promise<{ plexUserId: string; ratingKey: string; plays: number; lastWatched: number | null }[]> {
  const users = await getUsers(baseUrl, token);
  const agg = new Map<
    string,
    { plexUserId: string; ratingKey: string; plays: number; lastWatched: number | null }
  >();
  for (const u of users) {
    const qs = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Episode',
      IsPlayed: 'true',
      fields: 'UserData,SeriesId',
    });
    let items: Record<string, unknown>[];
    try {
      items = await fetchAllPages<Record<string, unknown>>(
        `${base(baseUrl)}/Users/${u.id}/Items?${qs.toString()}`,
        token,
        'Jellyfin watched'
      );
    } catch {
      continue; // skip a user we can't read
    }
    for (const it of items) {
      const isEpisode = it.Type === 'Episode';
      const ratingKey = isEpisode
        ? it.SeriesId
          ? String(it.SeriesId)
          : null
        : it.Id
          ? String(it.Id)
          : null;
      if (!ratingKey) continue;
      const ud = (it.UserData as { PlayCount?: number; LastPlayedDate?: string }) ?? {};
      const plays = Number(ud.PlayCount) || 1;
      const last = isoToUnix(ud.LastPlayedDate);
      const key = `${u.id}|${ratingKey}`;
      const prev = agg.get(key);
      if (prev) {
        prev.plays += plays;
        if (last && (prev.lastWatched == null || last > prev.lastWatched)) {
          prev.lastWatched = last;
        }
      } else {
        agg.set(key, { plexUserId: u.id, ratingKey, plays, lastWatched: last });
      }
    }
  }
  return [...agg.values()];
}

/** Total on-disk size of a series (every episode's media, file-deduped) plus
 *  the series folder(s) derived from episode paths. */
export async function getSeriesSize(
  baseUrl: string,
  token: string,
  seriesId: string
): Promise<{ sizeBytes: number; dirPath: string | null; dirNames: string[] }> {
  const qs = new URLSearchParams({
    ParentId: seriesId,
    Recursive: 'true',
    IncludeItemTypes: 'Episode',
    fields: 'MediaSources',
  });
  const items = await fetchAllPages<JfItem>(
    `${base(baseUrl)}/Items?${qs.toString()}`,
    token,
    'Jellyfin episodes'
  );
  // Derive the series folder from episode paths — the fallback for servers
  // that omit the series' own Path from listings. JF sections report no
  // library roots, so this relies on deriveShowDirPath's season-folder hop.
  const files: string[] = [];
  for (const it of items) {
    const p = it.MediaSources?.[0]?.Path;
    if (p) files.push(p);
  }
  const dirs = deriveShowDirPaths(files, []);
  return {
    sizeBytes: sumMediaSources(items),
    dirPath: dirs[0] ?? null,
    dirNames: dirs.map((d) => lastSegment(d)).filter((n): n is string => !!n),
  };
}
