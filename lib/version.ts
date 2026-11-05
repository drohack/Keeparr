import { fetchJson } from './http';
import pkg from '../package.json';

/**
 * Update check against GitHub Releases (published on every push to main by
 * .github/workflows/release.yml). This module compares the running version to
 * the latest published release.
 *
 * Design constraints: never throw, never block a page on GitHub being slow or
 * rate-limited, and don't hammer the API - results are cached in-memory for
 * ~6 hours and the last good answer is served on fetch failure.
 */

export interface VersionInfo {
  current: string;
  /** Latest released version (no `v` prefix), or null if unknown/no releases. */
  latest: string | null;
  updateAvailable: boolean;
  /** Release-notes URL for the latest release (when known). */
  releaseUrl: string | null;
}

const RELEASES_LATEST_URL =
  'https://api.github.com/repos/drohack/Keeparr/releases/latest';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Compare two dotted-numeric versions (e.g. "0.2.0" vs "0.10.1").
 * Returns <0 if a<b, 0 if equal, >0 if a>b. Non-numeric segments compare as 0,
 * so odd tags degrade to "not newer" instead of a false update banner.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

let cached: VersionInfo | null = null;
let cachedAt = 0;

/** Test helper: reset the in-memory cache. */
export function __clearVersionCache(): void {
  cached = null;
  cachedAt = 0;
}

/**
 * Current vs latest-release version. Cached ~6h; on failure (no releases yet,
 * rate limit, offline) returns the last good answer or a "latest unknown" row -
 * never throws.
 */
export async function getVersionInfo(
  fetchLatest: () => Promise<{ tag_name?: string; html_url?: string }> = () =>
    fetchJson(RELEASES_LATEST_URL, { label: 'GitHub releases' })
): Promise<VersionInfo> {
  const current = pkg.version;
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  try {
    const rel = await fetchLatest();
    const latest = (rel.tag_name ?? '').replace(/^v/i, '') || null;
    cached = {
      current,
      latest,
      updateAvailable: latest != null && compareSemver(latest, current) > 0,
      releaseUrl: rel.html_url ?? null,
    };
    cachedAt = Date.now();
  } catch {
    // No releases yet (404), rate-limited, or offline - keep last good answer.
    if (!cached) {
      cached = { current, latest: null, updateAvailable: false, releaseUrl: null };
      cachedAt = Date.now();
    }
  }
  return cached;
}
