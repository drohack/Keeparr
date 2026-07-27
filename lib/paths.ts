/**
 * Pure path-string helpers for on-disk name matching (Problems → disk scan).
 *
 * Media servers and Sonarr/Radarr report paths as THEY see them — a different
 * container, possibly a Windows host — so these are separator-agnostic string
 * ops. Never use node:path here: it would apply the LOCAL platform's rules to
 * a foreign path (e.g. treat "C:\Media\X" as a single segment on Linux).
 */

/** Split on / or \, dropping empty segments (handles trailing separators). */
export function pathSegments(p: string): string[] {
  return p.split(/[/\\]+/).filter(Boolean);
}

/** Last segment ("basename") of a foreign path, or null. */
export function lastSegment(p: string | null | undefined): string | null {
  if (!p) return null;
  const segs = pathSegments(p);
  return segs.length ? segs[segs.length - 1] : null;
}

/** Second-to-last segment (the containing folder's name), or null. */
export function parentSegment(p: string | null | undefined): string | null {
  if (!p) return null;
  const segs = pathSegments(p);
  return segs.length >= 2 ? segs[segs.length - 2] : null;
}

/** The path minus its last segment, preserving the original separators
 *  ('/data/tv/Scrubs/ep.mkv' → '/data/tv/Scrubs'). Single segment → null. */
export function parentPath(p: string | null | undefined): string | null {
  if (!p) return null;
  const trimmed = p.replace(/[/\\]+$/, '');
  const cut = trimmed.search(/[/\\]+[^/\\]+$/);
  if (cut <= 0) return null; // single segment (or leading-separator root child)
  return trimmed.slice(0, cut);
}

/** The last `n` segments joined with '/', prefixed with '…/' when segments
 *  were dropped — the compact display form of a long foreign path. */
export function pathTail(p: string, n = 2): string {
  const segs = pathSegments(p);
  if (segs.length <= n) return segs.join('/');
  return `…/${segs.slice(-n).join('/')}`;
}

/**
 * Normalize a folder/file name for cross-system comparison: unicode NFC
 * (macOS mounts hand back NFD) + case-fold (Windows/SMB are case-insensitive).
 */
export function normalizeName(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** Cut a path right after its first `n` segments, preserving separators
 *  ('/data/tv/Show/ep.mkv', 3 → '/data/tv/Show'). */
function cutAfterSegments(p: string, n: number): string {
  let idx = 0;
  let seen = 0;
  while (seen < n && idx < p.length) {
    while (idx < p.length && /[/\\]/.test(p[idx])) idx++;
    while (idx < p.length && !/[/\\]/.test(p[idx])) idx++;
    seen++;
  }
  return p.slice(0, idx);
}

/** Conventional intermediate folders between a show folder and its files. */
const SEASON_DIR_RE = /^(season([ ._-]|$)|specials$|staffel([ ._-]|$)|extras$)/i;

/**
 * Derive a show's folder from its EPISODE file paths — the fallback for media
 * servers that omit the show's own Location/Path from listings (episode paths
 * are always available; they're how show sizes are computed).
 *
 * Primary: the show folder is the first segment under a known library root
 * (compared segment-wise, case-folded). Fallback without a matching root: the
 * first file's parent, hopping over a conventional season/specials folder.
 */
export function deriveShowDirPath(
  files: string[],
  sectionRoots: string[]
): string | null {
  for (const file of files) {
    const normSegs = pathSegments(file).map(normalizeName);
    for (const root of sectionRoots) {
      const rootSegs = pathSegments(root).map(normalizeName);
      if (
        rootSegs.length > 0 &&
        normSegs.length > rootSegs.length + 1 && // root + show folder + file, at least
        rootSegs.every((s, i) => normSegs[i] === s)
      ) {
        return cutAfterSegments(file, rootSegs.length + 1);
      }
    }
  }
  const first = files[0];
  if (!first) return null;
  let dir = parentPath(first);
  const dirName = lastSegment(dir);
  if (dir && dirName && SEASON_DIR_RE.test(normalizeName(dirName))) {
    dir = parentPath(dir) ?? dir;
  }
  return dir;
}
