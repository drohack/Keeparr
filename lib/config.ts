import path from 'node:path';

/**
 * Resolved runtime configuration. In Docker, DATA_DIR is set to /data (a mounted
 * volume). Locally it defaults to ./data inside the project (gitignored).
 */
export const DATA_DIR =
  process.env.DATA_DIR && process.env.DATA_DIR.trim().length > 0
    ? process.env.DATA_DIR
    : path.join(process.cwd(), 'data');

export const DB_PATH = path.join(DATA_DIR, 'keeparr.db');

/**
 * Secret used to sign the session cookie AND to encrypt admin-entered service
 * tokens at rest (Plex/Tautulli/Seerr). MUST be overridden in production via the
 * SESSION_SECRET env var. The fallback is only for local development.
 */
export const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me';

/**
 * Optional public URL of this deployment, used to build the Plex auth
 * `forwardUrl`. If empty, the browser origin is used (popup flow).
 */
export const APP_URL = process.env.APP_URL ?? '';

/** How many cards the home keep-loop serves per batch. */
export const FEED_BATCH_SIZE = 12;

/**
 * A job runs either on a fixed interval or once daily at a local clock time.
 * `interval` minutes of 0 = manual-only.
 */
export type JobSchedule =
  | { type: 'interval'; minutes: number }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number };

/** Default schedule per job. Cheap scans run often; expensive ones run overnight. */
export const DEFAULT_JOB_SCHEDULES: Record<string, JobSchedule> = {
  recentlyAdded: { type: 'interval', minutes: 5 },
  library: { type: 'daily', hour: 3, minute: 0 },
  watch: { type: 'daily', hour: 4, minute: 0 },
  requests: { type: 'daily', hour: 5, minute: 0 },
  sizes: { type: 'daily', hour: 6, minute: 0 },
  // After 'library' (03:00) has populated guids that arr matches against.
  arr: { type: 'daily', hour: 7, minute: 0 },
  // After the overnight refresh cycle, snapshot the database.
  backup: { type: 'daily', hour: 8, minute: 0 },
  // Disk-orphan scan: walks orphan folders on the media mount, so weekly (after
  // Sunday's overnight cycle has refreshed the known-name sets it matches against).
  diskScan: { type: 'weekly', weekday: 0, hour: 9, minute: 0 },
};

/** How many backup files to keep (oldest pruned first). Overridable in Settings. */
export const DEFAULT_BACKUP_RETENTION = 14;

/** Mixed "all" feed: fraction of slots reserved for movies (rest favor big series). */
export const FEED_MOVIE_RESERVE_RATIO = 0.2;
/** Mixed "all" feed: always seed at least this many movies. */
export const FEED_MOVIE_RESERVE_MIN = 2;
