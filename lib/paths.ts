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

/**
 * Normalize a folder/file name for cross-system comparison: unicode NFC
 * (macOS mounts hand back NFD) + case-fold (Windows/SMB are case-insensitive).
 */
export function normalizeName(name: string): string {
  return name.normalize('NFC').toLowerCase();
}
