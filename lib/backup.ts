import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from './config';
import { closeDbForSwap, getDb } from './db';
import { getBackupRetention } from './settings';
import type { JobResult } from './sync';

/**
 * SQLite backup & restore. Everything Keeparr persists (media, keeps, users,
 * settings - secrets stay encrypted) lives in keeparr.db, so a backup is one
 * file. Snapshots are taken with better-sqlite3's online backup API, which is
 * safe against a live WAL database (readers/writers keep working).
 *
 * The poster cache (DATA_DIR/cache) is deliberately NOT backed up - it's
 * rebuildable from the media server.
 */

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/** keeparr-20260706-193000.db (+ the pre-restore safety snapshots; an optional
 *  numeric suffix disambiguates same-second creates). */
const NAME_RE = /^keeparr(?:-pre-restore)?-\d{8}-\d{6}(?:-\d+)?\.db$/;

export interface BackupFile {
  name: string;
  sizeBytes: number;
  /** Unix seconds (file mtime). */
  createdAt: number;
}

/** Validate a user-supplied backup filename (no traversal, exact shape). */
export function isValidBackupName(name: string): boolean {
  return NAME_RE.test(name);
}

function timestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Snapshot the live database. Returns the created file name. */
export async function createBackup(prefix = 'keeparr'): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const base = `${prefix}-${timestamp()}`;
  let name = `${base}.db`;
  // Same-second creates get a numeric suffix instead of overwriting.
  for (let i = 1; fs.existsSync(path.join(BACKUP_DIR, name)); i++) {
    name = `${base}-${i}.db`;
  }
  await getDb().backup(path.join(BACKUP_DIR, name));
  return name;
}

/** All backups, newest first. */
export function listBackups(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => isValidBackupName(f))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return {
        name,
        sizeBytes: st.size,
        createdAt: Math.floor(st.mtimeMs / 1000),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function backupPath(name: string): string {
  if (!isValidBackupName(name)) throw new Error('Invalid backup name');
  return path.join(BACKUP_DIR, name);
}

export function deleteBackup(name: string): boolean {
  const p = backupPath(name);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  // Restoring FROM a WAL-mode backup can leave empty sidecars - sweep them.
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${p}${suffix}`, { force: true });
  return true;
}

/** Drop the oldest backups beyond `keep`. Returns how many were removed. */
export function pruneBackups(keep: number): number {
  const extra = listBackups().slice(Math.max(1, keep));
  for (const b of extra) deleteBackup(b.name);
  return extra.length;
}

/** The scheduled 'backup' job: snapshot + prune to the retention setting. */
export async function runBackup(): Promise<JobResult> {
  const name = await createBackup();
  const pruned = pruneBackups(getBackupRetention());
  return {
    result: 1,
    message: `Backed up to ${name}${pruned ? ` (pruned ${pruned} old)` : ''}.`,
  };
}

/**
 * Restore a backup over the live database.
 *
 * Sequence: snapshot the CURRENT db first (keeparr-pre-restore-..., the safety
 * net) -> online-backup the snapshot file INTO the live DB_PATH -> reopen the
 * singleton so applySchema()/migrate() upgrade an older backup right away.
 *
 * Restoring via SQLite's backup API (instead of deleting/copying the file)
 * matters: it takes proper locks, so it's safe even when OTHER connections
 * hold the file - on Windows an unlink of the -wal sidecar fails with EBUSY
 * while any handle is open (Next dev keeps a second module copy alive via the
 * instrumentation context). Existing connections simply see the new content.
 */
export async function restoreBackup(name: string): Promise<{ safetyNet: string }> {
  const srcPath = backupPath(name);
  if (!fs.existsSync(srcPath)) throw new Error(`Backup not found: ${name}`);

  const safetyNet = await createBackup('keeparr-pre-restore');
  const src = new Database(srcPath, { readonly: true, fileMustExist: true });
  try {
    await src.backup(DB_PATH);
  } finally {
    src.close();
  }
  // Reopen so an older backup's schema is migrated immediately.
  closeDbForSwap();
  getDb();
  return { safetyNet };
}
