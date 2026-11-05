/**
 * Tautulli API client. Base call shape:
 *   GET {url}/api/v2?apikey={key}&cmd={cmd}&out_type=json
 * Envelope: { response: { result, message, data } }.
 * NOTE: get_history rows are at response.data.data[] (data is an object).
 */
import { fetchJson } from './http';

function buildUrl(
  base: string,
  apiKey: string,
  cmd: string,
  extra: Record<string, string | number> = {}
): string {
  const u = new URL(base.replace(/\/$/, '') + '/api/v2');
  u.searchParams.set('apikey', apiKey);
  u.searchParams.set('cmd', cmd);
  u.searchParams.set('out_type', 'json');
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
  return u.toString();
}

async function call<T = unknown>(
  base: string,
  apiKey: string,
  cmd: string,
  extra: Record<string, string | number> = {}
): Promise<T> {
  // fetchJson rejects non-JSON (e.g. an HTML error/login page from a wrong URL)
  // with a clear message instead of a cryptic "Unexpected token '<'".
  const json = await fetchJson<{
    response?: { result?: string; message?: string; data?: T };
  }>(buildUrl(base, apiKey, cmd, extra), { label: `Tautulli ${cmd}` });
  if (json.response?.result !== 'success') {
    throw new Error(`Tautulli ${cmd}: ${json.response?.message ?? 'error'}`);
  }
  return json.response.data as T;
}

/** Verify the URL + API key are valid. */
export async function testTautulli(
  base: string,
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const data = await call<{ pms_name?: string }>(base, apiKey, 'get_server_info');
    return { ok: true, message: data?.pms_name ? `Connected to ${data.pms_name}` : 'Connected' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export interface HistoryRow {
  user_id: number;
  rating_key: string | number;
  grandparent_rating_key: string | number;
  media_type: string;
  date: number;
  group_count?: number;
}

/**
 * Aggregate watch history into per-user plays keyed by the SERIES rating key
 * (for episodes) or the movie rating key. Pages through get_history via
 * `start`/`length` until exhausted (one pull returns only the first `length`
 * grouped rows, which would hide older watches from the never-watched
 * metric). History can shift between pages (new plays
 * arrive mid-loop, newest-first sort), so a boundary row may repeat and
 * slightly overcount plays - harmless for this use, so no dedupe.
 * A mid-loop error envelope throws (partial data must not report success).
 */
export async function aggregatedWatchHistory(
  base: string,
  apiKey: string,
  pageLen = 1000,
  maxPages = 100
): Promise<
  { plexUserId: string; ratingKey: string; plays: number; lastWatched: number }[]
> {
  const rows: HistoryRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await call<{ data?: HistoryRow[]; recordsFiltered?: number }>(
      base,
      apiKey,
      'get_history',
      { start: page * pageLen, length: pageLen, grouping: 1 }
    );
    const batch = data.data ?? [];
    rows.push(...batch);
    if (batch.length < pageLen) break;
    const total = Number(data.recordsFiltered);
    if (Number.isFinite(total) && rows.length >= total) break;
  }
  const acc = new Map<
    string,
    { plexUserId: string; ratingKey: string; plays: number; lastWatched: number }
  >();
  for (const r of rows) {
    const isEpisode = r.media_type === 'episode';
    const key = String(
      isEpisode ? r.grandparent_rating_key : r.rating_key
    );
    if (!key || key === 'undefined') continue;
    const userId = String(r.user_id);
    const mapKey = `${userId}:${key}`;
    const plays = r.group_count ?? 1;
    const prev = acc.get(mapKey);
    if (prev) {
      prev.plays += plays;
      prev.lastWatched = Math.max(prev.lastWatched, r.date ?? 0);
    } else {
      acc.set(mapKey, {
        plexUserId: userId,
        ratingKey: key,
        plays,
        lastWatched: r.date ?? 0,
      });
    }
  }
  return [...acc.values()];
}
