import { randomUUID } from 'node:crypto';
import { getSetting, setSetting } from './queries';
import { fetchJson } from './http';

/**
 * Plex client: the plex.tv PIN OAuth flow (login + identity + server-access
 * checks) and the Plex Media Server read API (libraries, items, size-on-disk).
 * Node-only (used from route handlers + the sync engine with runtime 'nodejs').
 *
 * API details verified against Overseerr/python-plexapi — see CLAUDE.md.
 */

export const PLEX_PRODUCT = 'Keeparr';
export const PLEX_VERSION = '1.0.0';
const PLEX_TV = 'https://plex.tv';

/** Stable X-Plex-Client-Identifier, generated once and persisted in settings. */
export function getClientId(): string {
  let id = getSetting('plex_client_id');
  if (!id) {
    id = randomUUID();
    setSetting('plex_client_id', id);
  }
  return id;
}

function plexHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Product': PLEX_PRODUCT,
    'X-Plex-Version': PLEX_VERSION,
    'X-Plex-Client-Identifier': getClientId(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// plex.tv PIN OAuth
// ---------------------------------------------------------------------------

export interface PlexPin {
  id: number;
  code: string;
  authToken: string | null;
}

/** Create a strong PIN. Returns { id, code, authToken: null }. */
export async function createPin(): Promise<PlexPin> {
  const data = await fetchJson<PlexPin>(`${PLEX_TV}/api/v2/pins?strong=true`, {
    method: 'POST',
    headers: plexHeaders(),
    label: 'Plex createPin',
  });
  return { id: data.id, code: data.code, authToken: data.authToken ?? null };
}

/** Build the app.plex.tv auth URL the user is sent to (popup or redirect). */
export function buildAuthUrl(code: string, forwardUrl?: string): string {
  const params = new URLSearchParams();
  params.set('clientID', getClientId());
  params.set('code', code);
  params.set('context[device][product]', PLEX_PRODUCT);
  if (forwardUrl) params.set('forwardUrl', forwardUrl);
  return `https://app.plex.tv/auth#?${params.toString()}`;
}

/** Poll a PIN. Returns the user's plex.tv token once authorized, else null. */
export async function checkPin(id: number): Promise<string | null> {
  const data = await fetchJson<{ authToken: string | null }>(
    `${PLEX_TV}/api/v2/pins/${id}`,
    { headers: plexHeaders(), label: 'Plex checkPin' }
  );
  return data.authToken ?? null;
}

export interface PlexAccount {
  id: string; // numeric account id (as string for our id space)
  uuid: string;
  username: string | null;
  email: string | null;
  title: string | null;
  thumb: string | null;
}

/** Resolve the authenticated user's identity from their token. */
export async function getPlexAccount(userToken: string): Promise<PlexAccount> {
  const d = await fetchJson<Record<string, unknown>>(`${PLEX_TV}/api/v2/user`, {
    headers: plexHeaders({ 'X-Plex-Token': userToken }),
    label: 'Plex account',
  });
  return {
    id: String(d.id),
    uuid: String(d.uuid ?? ''),
    username: (d.username as string) ?? null,
    email: (d.email as string) ?? null,
    title: (d.title as string) ?? null,
    thumb: (d.thumb as string) ?? null,
  };
}

export interface PlexResource {
  name: string;
  clientIdentifier: string; // == server machineIdentifier
  provides: string;
  accessToken: string | null;
  owned: boolean;
  connections: ServerConnection[];
}

export interface ServerConnection {
  uri: string;
  local: boolean;
  relay: boolean;
}

/** Extract an IPv4 from a connection URI host. plex.direct encodes the IP with
 *  dashes ("172-18-0-1.<hash>.plex.direct"); it may also be a raw IP. */
function ipv4FromUri(uri: string): string | null {
  let host: string;
  try {
    host = new URL(uri).hostname;
  } catch {
    return null;
  }
  const first = host.split('.')[0];
  if (/^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/.test(first)) return first.replace(/-/g, '.');
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return host;
  return null;
}

/** Docker's default address pool (172.16.0.0/12). When Plex runs in Docker it
 *  advertises a "local" connection for every bridge network — none reachable
 *  from another container — so these are noise. */
function isDockerBridge(ip: string): boolean {
  const p = ip.split('.').map(Number);
  return p[0] === 172 && p[1] >= 16 && p[1] <= 31;
}

/** Best connection first: LAN-local, then remote (WAN), then relay last. */
function connRank(c: ServerConnection): number {
  if (c.relay) return 2;
  return c.local ? 0 : 1;
}

/**
 * Trim a server's advertised connections to the useful ones for the discovery
 * UI: drop Docker-bridge addresses and order LAN → WAN → relay. Never returns
 * empty — falls back to all connections if filtering would remove everything.
 */
export function usefulServerConnections(
  connections: ServerConnection[]
): ServerConnection[] {
  const useful = connections.filter((c) => {
    const ip = ipv4FromUri(c.uri);
    return !(ip && isDockerBridge(ip));
  });
  return (useful.length ? useful : connections)
    .slice()
    .sort((a, b) => connRank(a) - connRank(b));
}

/** List servers/resources available to a token (admin discovers their server). */
export async function getResources(userToken: string): Promise<PlexResource[]> {
  const arr = await fetchJson<Record<string, unknown>[]>(
    `${PLEX_TV}/api/v2/resources?includeHttps=1`,
    { headers: plexHeaders({ 'X-Plex-Token': userToken }), label: 'Plex getResources' }
  );
  return arr
    .filter((r) => String(r.provides ?? '').includes('server'))
    .map((r) => ({
      name: String(r.name ?? ''),
      clientIdentifier: String(r.clientIdentifier ?? ''),
      provides: String(r.provides ?? ''),
      accessToken: (r.accessToken as string) ?? null,
      owned: r.owned === true,
      connections: Array.isArray(r.connections)
        ? (r.connections as Record<string, unknown>[]).map((c) => ({
            uri: String(c.uri ?? ''),
            local: c.local === true,
            relay: c.relay === true,
          }))
        : [],
    }));
}

/**
 * Parse the XML from `GET /api/users` into a list of shared users, each with
 * the set of server machineIdentifiers they can access. Exported for testing.
 * The XML shape is:
 *   <MediaContainer><User id="123" ...><Server machineIdentifier="ABC"/></User>...
 */
export interface SharedUser {
  id: string;
  username: string | null;
  email: string | null;
  thumb: string | null;
  machineIds: string[];
}

export function parseSharedUsers(xml: string): SharedUser[] {
  const users: SharedUser[] = [];
  const attr = (attrs: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
    return m ? m[1] : null;
  };
  // Split into <User ...>...</User> blocks (and self-closing <User .../>).
  const userRe = /<User\b([^>]*)>([\s\S]*?)<\/User>|<User\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = userRe.exec(xml)) !== null) {
    const attrs = m[1] ?? m[3] ?? '';
    const body = m[2] ?? '';
    const idMatch = /\bid="(\d+)"/.exec(attrs);
    if (!idMatch) continue;
    const machineIds: string[] = [];
    const serverRe = /machineIdentifier="([^"]+)"/g;
    let s: RegExpExecArray | null;
    while ((s = serverRe.exec(body)) !== null) machineIds.push(s[1]);
    users.push({
      id: idMatch[1],
      username: attr(attrs, 'username') ?? attr(attrs, 'title'),
      email: attr(attrs, 'email'),
      thumb: attr(attrs, 'thumb'),
      machineIds,
    });
  }
  return users;
}

/** Fetch the owner's shared users who can access `machineId` (for importing). */
export async function getSharedUsers(
  adminToken: string,
  machineId: string
): Promise<SharedUser[]> {
  const res = await fetch(`${PLEX_TV}/api/users`, {
    headers: {
      'X-Plex-Token': adminToken,
      'X-Plex-Client-Identifier': getClientId(),
      'X-Plex-Product': PLEX_PRODUCT,
    },
  });
  if (!res.ok) throw new Error(`Plex getSharedUsers failed: ${res.status}`);
  const shared = parseSharedUsers(await res.text());
  return shared.filter((u) => u.machineIds.includes(machineId));
}

/**
 * Does `userPlexId` have access to the server identified by `machineId`?
 * The owner (adminPlexId) always has access. Shared users are looked up via the
 * admin token's friends list. `/api/users` returns XML, parsed by parseSharedUsers.
 */
export async function checkServerAccess(params: {
  adminToken: string;
  machineId: string;
  userPlexId: string;
  adminPlexId: string;
}): Promise<boolean> {
  if (params.userPlexId === params.adminPlexId) return true;
  const res = await fetch(`${PLEX_TV}/api/users`, {
    headers: {
      'X-Plex-Token': params.adminToken,
      'X-Plex-Client-Identifier': getClientId(),
      'X-Plex-Product': PLEX_PRODUCT,
    },
  });
  if (!res.ok) throw new Error(`Plex checkServerAccess failed: ${res.status}`);
  const xml = await res.text();
  const shared = parseSharedUsers(xml);
  const entry = shared.find((u) => u.id === params.userPlexId);
  return !!entry && entry.machineIds.includes(params.machineId);
}

// ---------------------------------------------------------------------------
// Plex Media Server (PMS) read API
// ---------------------------------------------------------------------------

function pmsUrl(baseUrl: string, path: string, token: string): string {
  const u = new URL(path, baseUrl.replace(/\/$/, '') + '/');
  u.searchParams.set('X-Plex-Token', token);
  return u.toString();
}

async function pmsGet<T = unknown>(
  baseUrl: string,
  path: string,
  token: string
): Promise<T> {
  // Plex serves its web-app HTML at `/` when the token is missing/invalid, so we
  // rely on fetchJson to reject non-JSON with a clear message rather than letting
  // JSON.parse throw a cryptic "Unexpected token '<'".
  return fetchJson<T>(pmsUrl(baseUrl, path, token), { label: `PMS ${path}` });
}

/**
 * Get the server's machineIdentifier (and friendly name). Tries `/` first (gives
 * the friendly name but needs a valid token); on failure falls back to the
 * unauthenticated `/identity` endpoint so a manual reachability test works before
 * a server token has been saved.
 */
export async function getServerIdentity(
  baseUrl: string,
  token: string
): Promise<{ machineIdentifier: string; friendlyName: string }> {
  try {
    const d = await pmsGet<{
      MediaContainer: { machineIdentifier: string; friendlyName?: string };
    }>(baseUrl, '/', token);
    return {
      machineIdentifier: d.MediaContainer.machineIdentifier,
      friendlyName: d.MediaContainer.friendlyName ?? 'Plex server',
    };
  } catch {
    const d = await pmsGet<{ MediaContainer: { machineIdentifier: string } }>(
      baseUrl,
      '/identity',
      token
    );
    return {
      machineIdentifier: d.MediaContainer.machineIdentifier,
      friendlyName: 'Plex server',
    };
  }
}

export interface PlexSection {
  key: string; // section id
  type: string; // 'movie' | 'show' | ...
  title: string;
  /** On-disk folder(s) backing this library (Plex server-side paths). */
  Location?: { id: number; path: string }[];
}

export async function getSections(
  baseUrl: string,
  token: string
): Promise<PlexSection[]> {
  const d = await pmsGet<{
    MediaContainer: { Directory?: PlexSection[] };
  }>(baseUrl, '/library/sections', token);
  return d.MediaContainer.Directory ?? [];
}

/** Raw Plex metadata node (loosely typed; we read only what we need). */
export interface PlexMetadata {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  addedAt?: number;
  type?: string;
  Guid?: { id: string }[];
  Media?: { Part?: { id?: number; file?: string; size?: number }[] }[];
}

/** Sum Part.size across all Media versions of one metadata node (bytes). */
export function sumPartSizes(node: PlexMetadata): number {
  let total = 0;
  for (const media of node.Media ?? []) {
    for (const part of media.Part ?? []) {
      total += part.size ?? 0;
    }
  }
  return total;
}

/**
 * Sum the on-disk size across episode/movie nodes (bytes), counting each
 * physical file ONCE. Plex reports the full file size on every episode that
 * shares a multi-episode file, so a naive per-leaf sum massively overcounts a
 * show packed several-episodes-per-file. We dedupe by Part.file (falling back to
 * Part.id); parts with neither are summed as-is (can't dedupe, don't drop).
 */
export function sumLeafSizes(nodes: PlexMetadata[]): number {
  const seenFiles = new Set<string | number>();
  let total = 0;
  for (const node of nodes) {
    for (const media of node.Media ?? []) {
      for (const part of media.Part ?? []) {
        const key = part.file ?? part.id;
        if (key != null) {
          if (seenFiles.has(key)) continue;
          seenFiles.add(key);
        }
        total += part.size ?? 0;
      }
    }
  }
  return total;
}

/** Extract tmdb/tvdb ids from a node's Guid[] (modern Plex agent). */
export function extractGuids(node: PlexMetadata): {
  tmdb: string | null;
  tvdb: string | null;
} {
  let tmdb: string | null = null;
  let tvdb: string | null = null;
  for (const g of node.Guid ?? []) {
    if (g.id?.startsWith('tmdb://')) tmdb = g.id.slice('tmdb://'.length);
    else if (g.id?.startsWith('tvdb://')) tvdb = g.id.slice('tvdb://'.length);
  }
  return { tmdb, tvdb };
}

/**
 * Page through all items in a section. type 1=movie, 2=show. Movies include
 * Media/Part inline; shows do not (use getAllLeaves for their size).
 */
export async function getSectionItems(
  baseUrl: string,
  token: string,
  sectionId: string,
  type: 1 | 2,
  pageSize = 200
): Promise<PlexMetadata[]> {
  const out: PlexMetadata[] = [];
  let start = 0;
  for (;;) {
    const path = `/library/sections/${sectionId}/all?type=${type}&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`;
    const d = await pmsGet<{
      MediaContainer: { totalSize?: number; size?: number; Metadata?: PlexMetadata[] };
    }>(baseUrl, path, token);
    const batch = d.MediaContainer.Metadata ?? [];
    out.push(...batch);
    const total = d.MediaContainer.totalSize ?? batch.length;
    start += batch.length;
    if (batch.length === 0 || start >= total) break;
  }
  return out;
}

/**
 * The most recently added items in a section (newest first), capped at `limit`.
 * Cheap alternative to a full scan — used by the Recently Added job to pick up
 * new titles between full scans. type 1=movie, 2=show.
 */
export async function getRecentlyAdded(
  baseUrl: string,
  token: string,
  sectionId: string,
  type: 1 | 2,
  limit = 50
): Promise<PlexMetadata[]> {
  const path = `/library/sections/${sectionId}/all?type=${type}&includeGuids=1&sort=addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`;
  const d = await pmsGet<{
    MediaContainer: { Metadata?: PlexMetadata[] };
  }>(baseUrl, path, token);
  return d.MediaContainer.Metadata ?? [];
}

/** All episodes of a show (every season), each with Media/Part for sizing. */
export async function getAllLeaves(
  baseUrl: string,
  token: string,
  showRatingKey: string
): Promise<PlexMetadata[]> {
  const d = await pmsGet<{
    MediaContainer: { Metadata?: PlexMetadata[] };
  }>(baseUrl, `/library/metadata/${showRatingKey}/allLeaves`, token);
  return d.MediaContainer.Metadata ?? [];
}
