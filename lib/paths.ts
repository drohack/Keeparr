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

/**
 * Comparison key for near-matching a folder/file NAME to a library TITLE
 * ("The Avengers (2012)" ↔ "The Avengers"; "40 Year Old Virgin The (2005)" ↔
 * "The 40-Year-Old Virgin"): strip a file extension and bracketed groups,
 * treat ./_/- as spaces, case-fold, move a trailing ", The"-style article to
 * the front, and drop a trailing standalone year. Exact-key equality only —
 * no fuzzy scoring.
 */
export function titleKey(name: string): string {
  let s = name.normalize('NFC').toLowerCase();
  s = s.replace(/\.[a-z0-9]{2,4}$/, ''); // file extension
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' '); // (...) [...] {...} groups
  s = s.replace(/[._\-,]/g, ' ');
  s = s.replace(/[^\p{L}\p{N} ]/gu, ' '); // remaining punctuation
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s(19|20)\d\d$/, ''); // trailing standalone year
  const m = s.match(/^(.*)\s(the|a|an)$/); // "title the" → "the title"
  if (m) s = `${m[2]} ${m[1]}`;
  return s;
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

/** Derive ONE file's show folder: the first segment under a known library root
 *  (segment-wise, case-folded compare), else the file's parent hopping over a
 *  conventional season/specials folder. */
function deriveOneShowDir(file: string, sectionRoots: string[]): string | null {
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
  let dir = parentPath(file);
  const dirName = lastSegment(dir);
  if (dir && dirName && SEASON_DIR_RE.test(normalizeName(dirName))) {
    dir = parentPath(dir) ?? dir;
  }
  return dir;
}

/**
 * Derive a show's folder(s) from its EPISODE file paths — the fallback for
 * media servers that omit the show's own Location/Path from listings (episode
 * paths are always available; they're how show sizes are computed).
 *
 * Returns EVERY distinct folder, first-seen order/casing kept: a show whose
 * episodes span several root folders (the media server merges locations) has
 * all of them on disk, and each must count as "known" to the disk-orphan scan.
 */
export function deriveShowDirPaths(files: string[], sectionRoots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const dir = deriveOneShowDir(file, sectionRoots);
    if (!dir) continue;
    const key = normalizeName(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

/** The show's primary folder (first derived) — the display path. */
export function deriveShowDirPath(
  files: string[],
  sectionRoots: string[]
): string | null {
  return deriveShowDirPaths(files, sectionRoots)[0] ?? null;
}
