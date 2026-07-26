/**
 * Sonarr / Radarr API client (v3; base /api/v3, auth header X-Api-Key). The two
 * apps share a near-identical shape, so one module serves both. Read-only today:
 * test a connection and pull per-title quality / tags / status to surface in the
 * Quality view. The pure `normalize*` functions are split from the HTTP calls so
 * they can be unit-tested without a network.
 */
import { fetchJson } from './http';
import type { ArrInstance } from './settings';

export type ArrSource = 'sonarr' | 'radarr';

/** A title pulled from an *arr instance, normalized for matching + display. */
export interface ArrRecord {
  source: ArrSource;
  instanceId: string;
  instanceName: string;
  arrId: number;
  /** Primary external id to match a Plex item: tvdbId (Sonarr) / tmdbId (Radarr). */
  matchId: string;
  /** Secondary match axis: the imdb id ("tt…"), if the *arr instance has one. */
  imdbId: string | null;
  title: string;
  monitored: boolean;
  status: string | null;
  quality: string | null;
  qualityKind: 'file' | 'profile';
  rootFolder: string | null;
  /** The title's own folder as the *arr sees it (series/movie path) — its
   *  basename feeds the disk-orphan scan's known-name set. */
  path: string | null;
  sizeOnDisk: number;
  tags: string[];
}

// --- Raw payload shapes (only the fields we read) ---
interface SonarrSeries {
  id: number;
  title: string;
  tvdbId?: number;
  imdbId?: string;
  monitored?: boolean;
  status?: string;
  qualityProfileId?: number;
  rootFolderPath?: string;
  path?: string;
  statistics?: { sizeOnDisk?: number };
  tags?: number[];
}
interface RadarrMovie {
  id: number;
  title: string;
  tmdbId?: number;
  imdbId?: string;
  monitored?: boolean;
  status?: string;
  rootFolderPath?: string;
  path?: string;
  sizeOnDisk?: number;
  movieFile?: { quality?: { quality?: { name?: string } } };
  tags?: number[];
}
interface ArrTag {
  id: number;
  label: string;
}
interface ArrQualityProfile {
  id: number;
  name: string;
}

function labelsFor(ids: number[] | undefined, tagMap: Map<number, string>): string[] {
  return (ids ?? [])
    .map((id) => tagMap.get(id))
    .filter((l): l is string => !!l);
}

/** Sonarr series → ArrRecord. Series quality = the profile name (target). */
export function normalizeSonarr(
  s: SonarrSeries,
  inst: ArrInstance,
  tagMap: Map<number, string>,
  profileMap: Map<number, string>
): ArrRecord | null {
  if (s.tvdbId == null) return null; // no stable id → can't match a Plex item
  return {
    source: 'sonarr',
    instanceId: inst.id,
    instanceName: inst.name || inst.url,
    arrId: s.id,
    matchId: String(s.tvdbId),
    imdbId: s.imdbId || null,
    title: s.title,
    monitored: !!s.monitored,
    status: s.status ?? null,
    quality: (s.qualityProfileId != null && profileMap.get(s.qualityProfileId)) || null,
    qualityKind: 'profile',
    rootFolder: s.rootFolderPath ?? null,
    path: s.path ?? null,
    sizeOnDisk: s.statistics?.sizeOnDisk ?? 0,
    tags: labelsFor(s.tags, tagMap),
  };
}

/** Radarr movie → ArrRecord. Movie quality = the actual downloaded file quality. */
export function normalizeRadarr(
  m: RadarrMovie,
  inst: ArrInstance,
  tagMap: Map<number, string>
): ArrRecord | null {
  if (m.tmdbId == null) return null;
  return {
    source: 'radarr',
    instanceId: inst.id,
    instanceName: inst.name || inst.url,
    arrId: m.id,
    matchId: String(m.tmdbId),
    imdbId: m.imdbId || null,
    title: m.title,
    monitored: !!m.monitored,
    status: m.status ?? null,
    quality: m.movieFile?.quality?.quality?.name ?? null,
    qualityKind: 'file',
    rootFolder: m.rootFolderPath ?? null,
    path: m.path ?? null,
    sizeOnDisk: m.sizeOnDisk ?? 0,
    tags: labelsFor(m.tags, tagMap),
  };
}

async function arrGet<T>(inst: ArrInstance, path: string): Promise<T> {
  const url = inst.url.replace(/\/$/, '') + '/api/v3' + path;
  return fetchJson<T>(url, {
    headers: { 'X-Api-Key': inst.apiKey },
    label: `${inst.name || inst.url} ${path}`,
  });
}

/** Verify a connection (used by the Settings Test button). Never throws. */
export async function testArr(
  url: string,
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const status = await arrGet<{ version?: string; appName?: string }>(
      { id: '', name: '', url, apiKey },
      '/system/status'
    );
    const app = status?.appName ? `${status.appName} ` : '';
    return {
      ok: true,
      message: status?.version ? `Connected (${app}v${status.version})` : 'Connected',
    };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

async function tagMap(inst: ArrInstance): Promise<Map<number, string>> {
  const tags = await arrGet<ArrTag[]>(inst, '/tag');
  return new Map(tags.map((t) => [t.id, t.label]));
}

/** All series from a Sonarr instance, normalized (tags + profile resolved). */
export async function fetchSonarr(inst: ArrInstance): Promise<ArrRecord[]> {
  const [series, tags, profiles] = await Promise.all([
    arrGet<SonarrSeries[]>(inst, '/series'),
    tagMap(inst),
    arrGet<ArrQualityProfile[]>(inst, '/qualityprofile'),
  ]);
  const profileMap = new Map(profiles.map((p) => [p.id, p.name]));
  return series
    .map((s) => normalizeSonarr(s, inst, tags, profileMap))
    .filter((r): r is ArrRecord => r !== null);
}

/** All movies from a Radarr instance, normalized (tags resolved). */
export async function fetchRadarr(inst: ArrInstance): Promise<ArrRecord[]> {
  const [movies, tags] = await Promise.all([
    arrGet<RadarrMovie[]>(inst, '/movie'),
    tagMap(inst),
  ]);
  return movies
    .map((m) => normalizeRadarr(m, inst, tags))
    .filter((r): r is ArrRecord => r !== null);
}
