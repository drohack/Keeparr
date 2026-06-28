/**
 * Overseerr / Seerr API client (base /api/v1, auth header X-Api-Key).
 * We use it read-only: test the connection and find which items a given Plex
 * user has requested (joined to Plex via media.ratingKey).
 */

interface SeerrUser {
  id: number;
  email?: string | null;
  plexUsername?: string | null;
  username?: string | null;
}

interface SeerrRequest {
  media?: { ratingKey?: string | number | null };
}

async function seerrGet<T>(
  base: string,
  apiKey: string,
  path: string
): Promise<T> {
  const url = base.replace(/\/$/, '') + '/api/v1' + path;
  const res = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
  if (!res.ok) throw new Error(`Seerr ${path} HTTP ${res.status}`);
  return (await res.json()) as T;
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
  const data = await seerrGet<{ results?: SeerrUser[] }>(
    base,
    apiKey,
    '/user?take=200'
  );
  const users = data.results ?? [];
  const lcEmail = match.email?.toLowerCase();
  const lcUser = match.username?.toLowerCase();
  const found = users.find(
    (u) =>
      (lcEmail && u.email?.toLowerCase() === lcEmail) ||
      (lcUser && u.plexUsername?.toLowerCase() === lcUser) ||
      (lcUser && u.username?.toLowerCase() === lcUser)
  );
  return found?.id ?? null;
}

/**
 * Set of Plex rating keys the given user has requested via Seerr. Returns empty
 * set if the user can't be matched or has no requests. Best-effort (never throws
 * into the caller's render path — caller should try/catch).
 */
export async function requestedRatingKeysForUser(
  base: string,
  apiKey: string,
  match: { email: string | null; username: string | null }
): Promise<Set<string>> {
  const userId = await findSeerrUserId(base, apiKey, match);
  if (userId == null) return new Set();
  const data = await seerrGet<{ results?: SeerrRequest[] }>(
    base,
    apiKey,
    `/user/${userId}/requests?take=200`
  );
  const keys = new Set<string>();
  for (const r of data.results ?? []) {
    const rk = r.media?.ratingKey;
    if (rk != null && String(rk).length > 0) keys.add(String(rk));
  }
  return keys;
}
