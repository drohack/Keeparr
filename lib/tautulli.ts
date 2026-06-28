/**
 * Tautulli API client. Base call shape:
 *   GET {url}/api/v2?apikey={key}&cmd={cmd}&out_type=json
 * Envelope: { response: { result, message, data } }.
 * NOTE: get_history rows are at response.data.data[] (data is an object).
 */

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
  const res = await fetch(buildUrl(base, apiKey, cmd, extra));
  if (!res.ok) throw new Error(`Tautulli ${cmd} HTTP ${res.status}`);
  const json = (await res.json()) as {
    response?: { result?: string; message?: string; data?: T };
  };
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
 * (for episodes) or the movie rating key. Pulls up to `length` recent rows.
 */
export async function aggregatedWatchHistory(
  base: string,
  apiKey: string,
  length = 10000
): Promise<
  { plexUserId: string; ratingKey: string; plays: number; lastWatched: number }[]
> {
  const data = await call<{ data?: HistoryRow[] }>(base, apiKey, 'get_history', {
    length,
    grouping: 1,
  });
  const rows = data.data ?? [];
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
