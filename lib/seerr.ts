/**
 * Overseerr / Seerr API client (base /api/v1, auth header X-Api-Key).
 * We use it read-only: test the connection and find which items a given user has
 * requested. On Plex we join via `media.ratingKey`; on Jellyfin/Emby (where that
 * key isn't our item id) we match by tmdb/tvdb id -> `media_items.guid_*`.
 */
import { fetchJson } from './http';
import { getMediaServerType } from './settings';
import { ratingKeysByGuid } from './queries';

interface SeerrUser {
  id: number;
  email?: string | null;
  plexUsername?: string | null;
  username?: string | null;
  jellyfinUsername?: string | null;
}

interface SeerrRequest {
  media?: {
    ratingKey?: string | number | null;
    tmdbId?: number | null;
    tvdbId?: number | null;
    mediaType?: string | null;
  };
}

async function seerrGet<T>(
  base: string,
  apiKey: string,
  path: string
): Promise<T> {
  const url = base.replace(/\/$/, '') + '/api/v1' + path;
  // fetchJson rejects non-JSON (e.g. an HTML login/error page from a wrong URL)
  // with a clear message instead of a cryptic "Unexpected token '<'".
  return fetchJson<T>(url, {
    headers: { 'X-Api-Key': apiKey },
    label: `Seerr ${path}`,
  });
}

const PAGE_SIZE = 200;
const MAX_PAGES = 50; // safety cap (10k rows) against a server that never ends

/**
 * Page through a Seerr list endpoint (`take`/`skip`, `{pageInfo, results}`
 * envelope) until exhausted. A single `take=200` silently drops everything past
 * the first page (users beyond 200, a heavy requester's older requests).
 */
async function seerrGetPaged<T>(
  base: string,
  apiKey: string,
  path: string
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await seerrGet<{
      pageInfo?: { pages?: number; page?: number };
      results?: T[];
    }>(base, apiKey, `${path}?take=${PAGE_SIZE}&skip=${page * PAGE_SIZE}`);
    const batch = data.results ?? [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    const info = data.pageInfo;
    if (info?.pages != null && info?.page != null && info.page >= info.pages) break;
  }
  return out;
}

export async function testSeerr(
  base: string,
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const status = await seerrGet<{ version?: string }>(base, apiKey, '/status');
    return {
      ok: true,
      message: status?.version ? `Connected (v${status.version})` : 'Connected',
    };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

/** Find the Seerr user id matching a Plex account by email or plex username. */
async function findSeerrUserId(
  base: string,
  apiKey: string,
  match: { email: string | null; username: string | null }
): Promise<number | null> {
  const users = await seerrGetPaged<SeerrUser>(base, apiKey, '/user');
  const lcEmail = match.email?.toLowerCase();
  const lcUser = match.username?.toLowerCase();
  const found = users.find(
    (u) =>
      (lcEmail && u.email?.toLowerCase() === lcEmail) ||
      (lcUser && u.plexUsername?.toLowerCase() === lcUser) ||
      (lcUser && u.jellyfinUsername?.toLowerCase() === lcUser) ||
      (lcUser && u.username?.toLowerCase() === lcUser)
  );
  return found?.id ?? null;
}

/**
 * Set of our rating keys the given user has requested via Seerr. Empty if the
 * user can't be matched or has no requests. Throws when a Seerr call fails.
 * On Plex this is `media.ratingKey`
 * directly; on Jellyfin/Emby it resolves the request's tmdb/tvdb id to the matching
 * media item (`media_items.guid_tmdb/guid_tvdb`), so it works without Plex ids.
 */
export async function requestedRatingKeysForUser(
  base: string,
  apiKey: string,
  match: { email: string | null; username: string | null }
): Promise<Set<string>> {
  const userId = await findSeerrUserId(base, apiKey, match);
  if (userId == null) return new Set();
  const requests = await seerrGetPaged<SeerrRequest>(
    base,
    apiKey,
    `/user/${userId}/requests`
  );
  const keys = new Set<string>();

  if (getMediaServerType() === 'plex') {
    for (const r of requests) {
      const rk = r.media?.ratingKey;
      if (rk != null && String(rk).length > 0) keys.add(String(rk));
    }
    return keys;
  }

  // Jellyfin/Emby: match by external id -> our media item.
  const tmdb = ratingKeysByGuid('tmdb');
  const tvdb = ratingKeysByGuid('tvdb');
  for (const r of requests) {
    const m = r.media;
    if (!m) continue;
    const isTv = m.mediaType === 'tv';
    const rk = isTv
      ? m.tvdbId != null
        ? tvdb.get(String(m.tvdbId))
        : undefined
      : m.tmdbId != null
        ? tmdb.get(String(m.tmdbId))
        : undefined;
    if (rk) keys.add(rk);
  }
  return keys;
}
