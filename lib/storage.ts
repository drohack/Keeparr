import { promises as fsp } from 'node:fs';

/**
 * Disk usage for the media filesystem(s). Plex's API does not report free space,
 * so the media share is mounted into the container (read-only) and measured with
 * statfs. Libraries that live on the same filesystem are grouped (deduped by the
 * device id) so a shared mount reports one free/total figure.
 *
 * Node-only (uses node:fs). Import from route handlers with runtime 'nodejs'.
 */

export interface StorageMapping {
  sectionId: string;
  path: string;
}

export interface FilesystemUsage {
  ok: true;
  /** Representative path(s) for this filesystem. */
  path: string;
  totalBytes: number;
  freeBytes: number;
  /** Bytes free for an unprivileged user (statfs bavail). */
  availableBytes: number;
  usedBytes: number;
  /** Section ids living on this filesystem. */
  sectionIds: string[];
  /** Bytes of synced Plex media attributed to those sections. */
  plexUsedBytes: number;
}

export interface FilesystemError {
  ok: false;
  path: string;
  sectionIds: string[];
  error: string;
}

export type FilesystemResult = FilesystemUsage | FilesystemError;

export interface StorageReport {
  /** True once at least one library has a storage path configured. */
  configured: boolean;
  filesystems: FilesystemResult[];
  totals: { totalBytes: number; freeBytes: number; usedBytes: number } | null;
}

function errCode(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === 'ENOENT') return 'not_found';
  if (code === 'EACCES' || code === 'EPERM') return 'no_access';
  return code ?? String(e);
}

/** statfs a path, never throwing — returns sizes or a coarse error code. */
export async function statfsSafe(
  path: string
): Promise<
  | { ok: true; totalBytes: number; freeBytes: number; availableBytes: number }
  | { ok: false; error: string }
> {
  try {
    const s = await fsp.statfs(path);
    const bsize = Number(s.bsize);
    return {
      ok: true,
      totalBytes: bsize * Number(s.blocks),
      freeBytes: bsize * Number(s.bfree),
      availableBytes: bsize * Number(s.bavail),
    };
  } catch (e) {
    return { ok: false, error: errCode(e) };
  }
}

/**
 * Build the storage report from the configured section→path mappings and the
 * per-section used bytes (from media_items). Paths are grouped by filesystem so
 * shared mounts aren't double-counted.
 */
export async function buildStorageReport(
  mappings: StorageMapping[],
  usedBySectionId: Map<string, number>,
  opts: { fakeTotalBytes?: number } = {}
): Promise<StorageReport> {
  const present = mappings.filter((m) => m.path && m.path.trim());
  if (present.length === 0) {
    return { configured: false, filesystems: [], totals: null };
  }

  // Demo mode: report a single synthetic filesystem with a fixed capacity, so
  // the header shows a sensible "X% full" without a real media mount. Only the
  // local dev seed sets this; real deployments use statfs below.
  if (opts.fakeTotalBytes && opts.fakeTotalBytes > 0) {
    const sectionIds = present.map((m) => m.sectionId);
    const used = sectionIds.reduce((a, id) => a + (usedBySectionId.get(id) ?? 0), 0);
    const total = opts.fakeTotalBytes;
    const free = Math.max(0, total - used);
    const fs: FilesystemUsage = {
      ok: true,
      path: '(demo) /media',
      totalBytes: total,
      freeBytes: free,
      availableBytes: free,
      usedBytes: used,
      sectionIds,
      plexUsedBytes: used,
    };
    return {
      configured: true,
      filesystems: [fs],
      totals: { totalBytes: total, freeBytes: free, usedBytes: used },
    };
  }

  // Group mappings by filesystem device id; unreadable paths become errors.
  const groups = new Map<string, { paths: string[]; sectionIds: string[] }>();
  const errors: FilesystemError[] = [];
  for (const m of present) {
    let dev: string;
    try {
      const st = await fsp.stat(m.path);
      dev = String(st.dev);
    } catch (e) {
      errors.push({
        ok: false,
        path: m.path,
        sectionIds: [m.sectionId],
        error: errCode(e),
      });
      continue;
    }
    const g = groups.get(dev) ?? { paths: [], sectionIds: [] };
    if (!g.paths.includes(m.path)) g.paths.push(m.path);
    g.sectionIds.push(m.sectionId);
    groups.set(dev, g);
  }

  const usable: FilesystemUsage[] = [];
  for (const g of groups.values()) {
    const res = await statfsSafe(g.paths[0]);
    const plexUsedBytes = g.sectionIds.reduce(
      (a, id) => a + (usedBySectionId.get(id) ?? 0),
      0
    );
    if (!res.ok) {
      errors.push({
        ok: false,
        path: g.paths.join(', '),
        sectionIds: g.sectionIds,
        error: res.error,
      });
      continue;
    }
    usable.push({
      ok: true,
      path: g.paths.join(', '),
      totalBytes: res.totalBytes,
      freeBytes: res.freeBytes,
      availableBytes: res.availableBytes,
      usedBytes: res.totalBytes - res.freeBytes,
      sectionIds: g.sectionIds,
      plexUsedBytes,
    });
  }

  const totals = usable.length
    ? {
        totalBytes: usable.reduce((a, f) => a + f.totalBytes, 0),
        freeBytes: usable.reduce((a, f) => a + f.freeBytes, 0),
        usedBytes: usable.reduce((a, f) => a + f.usedBytes, 0),
      }
    : null;

  return { configured: true, filesystems: [...usable, ...errors], totals };
}
