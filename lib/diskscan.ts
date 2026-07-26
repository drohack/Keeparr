import { promises as fsp, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { getStorageMappings } from './settings';
import { normalizeName } from './paths';
import {
  arrFolderNames,
  diskOrphansForSection,
  replaceDiskOrphansForSection,
  sectionDiskNameStats,
  type DiskOrphanInput,
} from './queries';
import { formatSize } from './format';
import type { JobResult } from './sync';

/**
 * Disk-orphan scan (the 'diskScan' job): find top-level entries under each
 * mapped library path that neither the media server nor Sonarr/Radarr account
 * for. Never compares absolute paths (Plex/*arr/Keeparr each see the same
 * folder under a different mount) — matches by NAME per library root, so the
 * whole scan is one readdir per root and only ORPHANS get a recursive size
 * walk. Node-only (node:fs); local paths, so node:path is fine here (unlike
 * lib/paths.ts, which handles foreign server-side paths).
 */

/** Well-known junk that must never be flagged (NAS/system/Plex artifacts).
 *  Compared case-insensitively; dotfiles are skipped wholesale. */
export const JUNK_NAMES = new Set([
  '@eadir',
  '#recycle',
  '$recycle.bin',
  'system volume information',
  'lost+found',
  'plex versions',
  'optimized for tv',
]);

export function isJunkName(name: string): boolean {
  return name.startsWith('.') || JUNK_NAMES.has(name.toLowerCase());
}

/** If the majority of a root looks orphaned, the mapping is almost certainly
 *  wrong (points above/beside the library) — record names, skip sizing, so a
 *  misconfigured path can never trigger a full-share walk. */
const BREAKER_MIN_CANDIDATES = 20;

/** Coverage the safety guard requires before trusting a section's name set. */
const GUARD_MIN_NAMED_RATIO = 0.5;

const MAX_WALK_DEPTH = 12;

/** Recursive size of a directory tree: lstat-based, symlinks not followed,
 *  per-entry errors counted as 0 (never throws), depth-capped. */
export async function sizeOfDir(absPath: string, depth = 0): Promise<number> {
  if (depth > MAX_WALK_DEPTH) return 0;
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(absPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of entries) {
    const child = join(absPath, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        total += await sizeOfDir(child, depth + 1);
      } else {
        total += (await fsp.lstat(child)).size;
      }
    } catch {
      /* unreadable child → count as 0 */
    }
  }
  return total;
}

/** The 'diskScan' job body. */
export async function runDiskScan(): Promise<JobResult> {
  const mappings = getStorageMappings().filter((m) => m.path && m.path.trim());
  if (mappings.length === 0) {
    return { result: 0, message: 'No storage mappings configured.' };
  }

  // Global known set: every *arr folder (matched + unmatched) — arr instances
  // aren't section-scoped, so their names dismiss entries under any root.
  const arrNames = arrFolderNames().map(normalizeName);

  let orphans = 0;
  let bytes = 0;
  let scannedRoots = 0;
  const notes: string[] = [];

  for (const m of mappings) {
    // Safety guard: an un-captured name snapshot (fresh upgrade, no library
    // scan yet) must not mass-flag a whole library as orphaned.
    const stats = sectionDiskNameStats(m.sectionId);
    if (stats.total === 0 || stats.named / stats.total < GUARD_MIN_NAMED_RATIO) {
      notes.push(
        `${m.path}: skipped — item folder names not captured yet (run a Full library scan first)`
      );
      continue; // prior rows kept
    }

    let entries: Dirent[];
    try {
      entries = await fsp.readdir(m.path, { withFileTypes: true });
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'error';
      notes.push(`${m.path}: unreadable (${code})`);
      continue; // prior rows kept
    }
    scannedRoots++;

    const known = new Set([...stats.names.map(normalizeName), ...arrNames]);
    const candidates = entries.filter(
      (e) => !isJunkName(e.name) && !known.has(normalizeName(e.name))
    );

    const breaker =
      candidates.length > BREAKER_MIN_CANDIDATES &&
      candidates.length > entries.length / 2;
    if (breaker) {
      notes.push(
        `${m.path}: ${candidates.length} of ${entries.length} entries look orphaned — check this library's storage mapping (sizing skipped)`
      );
    }

    // mtime size cache: an orphan whose mtime hasn't changed since the last
    // scan keeps its computed size instead of being re-walked.
    const cache = new Map(
      diskOrphansForSection(m.sectionId).map((r) => [r.path, r])
    );

    const rows: DiskOrphanInput[] = [];
    for (const e of candidates) {
      const abs = join(m.path, e.name);
      const isDir = e.isDirectory();
      let mtime: number | null = null;
      let size = 0;
      try {
        const st = await fsp.lstat(abs);
        mtime = Math.floor(st.mtimeMs / 1000);
        if (breaker || st.isSymbolicLink()) {
          size = 0;
        } else if (isDir) {
          const prior = cache.get(abs);
          size =
            prior && !prior.sizeSkipped && prior.mtime != null && prior.mtime === mtime
              ? prior.sizeBytes
              : await sizeOfDir(abs);
        } else {
          size = st.size;
        }
      } catch {
        /* entry vanished mid-scan / unreadable → record with size 0 */
      }
      rows.push({
        name: e.name,
        path: abs,
        isDir,
        sizeBytes: size,
        sizeSkipped: breaker,
        mtime,
      });
      orphans++;
      bytes += size;
    }
    replaceDiskOrphansForSection(m.sectionId, rows);
  }

  const noteSuffix = notes.length ? ` — ${notes.join('; ')}` : '';
  return {
    result: orphans,
    message: `Found ${orphans} orphaned item(s) (${formatSize(bytes)}) across ${scannedRoots} mapped root(s)${noteSuffix}.`,
  };
}
