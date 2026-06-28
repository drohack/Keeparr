import Database from 'better-sqlite3';
import fs from 'node:fs';
import { DB_PATH, DATA_DIR } from './config';

let db: Database.Database | null = null;

/** Create the schema on a freshly opened database. */
function applySchema(database: Database.Database): void {
  database.pragma('foreign_keys = ON');
  database.exec(`
    -- One row per series (show) or movie. Episodes are NOT stored individually;
    -- a series' size_bytes is the summed total across all episodes/parts/versions.
    CREATE TABLE IF NOT EXISTS media_items (
      rating_key    TEXT PRIMARY KEY,          -- Plex ratingKey (shared id across systems)
      section_id    TEXT NOT NULL,             -- Plex library section id
      library_kind  TEXT NOT NULL,             -- 'movie' | 'show'
      title         TEXT NOT NULL,
      year          INTEGER,
      thumb         TEXT,                       -- relative Plex thumb path
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      added_at      INTEGER,
      guid_tmdb     TEXT,                       -- for Seerr/Tautulli fallback joins
      guid_tvdb     TEXT,
      last_synced   INTEGER NOT NULL,
      removed       INTEGER NOT NULL DEFAULT 0  -- tombstone if gone from Plex
    );
    CREATE INDEX IF NOT EXISTS idx_media_section ON media_items(section_id);
    CREATE INDEX IF NOT EXISTS idx_media_size ON media_items(size_bytes DESC);
    CREATE INDEX IF NOT EXISTS idx_media_removed ON media_items(removed);

    -- Per-user keeps. An item is "kept" (protected) if ANYONE keeps it; each user
    -- manages their own keep and can't remove another user's.
    CREATE TABLE IF NOT EXISTS keeps (
      plex_user_id TEXT NOT NULL,
      rating_key   TEXT NOT NULL REFERENCES media_items(rating_key) ON DELETE CASCADE,
      kept_at      INTEGER NOT NULL,
      PRIMARY KEY (plex_user_id, rating_key)
    );
    CREATE INDEX IF NOT EXISTS idx_keeps_item ON keeps(rating_key);

    -- Per-user "don't care" — hides an item from THAT user's random rolls only.
    CREATE TABLE IF NOT EXISTS user_skips (
      plex_user_id TEXT NOT NULL,
      rating_key   TEXT NOT NULL REFERENCES media_items(rating_key) ON DELETE CASCADE,
      skipped_at   INTEGER NOT NULL,
      PRIMARY KEY (plex_user_id, rating_key)
    );
    CREATE INDEX IF NOT EXISTS idx_skips_user ON user_skips(plex_user_id);

    CREATE TABLE IF NOT EXISTS users (
      plex_user_id TEXT PRIMARY KEY,           -- numeric Plex account id
      username     TEXT,
      email        TEXT,
      thumb        TEXT,
      is_admin     INTEGER NOT NULL DEFAULT 0,
      enabled      INTEGER NOT NULL DEFAULT 1,  -- can this account sign in?
      created_at   INTEGER NOT NULL,
      last_login   INTEGER
    );

    -- Per-user watch data cached from Tautulli (for "your top watched").
    CREATE TABLE IF NOT EXISTS watch_history (
      plex_user_id TEXT NOT NULL,
      rating_key   TEXT NOT NULL,              -- grandparent (series) or movie rating_key
      plays        INTEGER NOT NULL DEFAULT 0,
      last_watched INTEGER,
      PRIMARY KEY (plex_user_id, rating_key)
    );
    CREATE INDEX IF NOT EXISTS idx_watch_user ON watch_history(plex_user_id);

    -- Admin-configured connections + app settings. Token values are encrypted
    -- at rest (see lib/crypto.ts) before being stored here.
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Single-row sync status (id is pinned to 1). Legacy; superseded by job_state.
    CREATE TABLE IF NOT EXISTS sync_state (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      last_run      INTEGER,
      last_status   TEXT,                       -- 'ok' | 'error' | 'running'
      last_message  TEXT,
      items_synced  INTEGER
    );
    INSERT OR IGNORE INTO sync_state (id, last_status) VALUES (1, 'never');

    -- Per-job status for the scheduled refresh jobs (one row per job id).
    CREATE TABLE IF NOT EXISTS job_state (
      job_id           TEXT PRIMARY KEY,
      last_run         INTEGER,
      last_status      TEXT,                    -- 'never' | 'running' | 'ok' | 'error'
      last_message     TEXT,
      last_duration_ms INTEGER,
      last_result      INTEGER
    );

    -- Seerr requests cached per user (refreshed by the 'requests' job).
    CREATE TABLE IF NOT EXISTS seerr_requests (
      plex_user_id TEXT NOT NULL,
      rating_key   TEXT NOT NULL,
      PRIMARY KEY (plex_user_id, rating_key)
    );
    CREATE INDEX IF NOT EXISTS idx_seerr_user ON seerr_requests(plex_user_id);

    -- Append-only history of scheduled-job runs (for the admin activity log).
    CREATE TABLE IF NOT EXISTS job_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      TEXT NOT NULL,
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      status      TEXT,                          -- 'ok' | 'error'
      message     TEXT,
      duration_ms INTEGER,
      result      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_job_runs_time ON job_runs(started_at DESC);

    -- App event log (shown on the Settings → Logs page).
    CREATE TABLE IF NOT EXISTS logs (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      INTEGER NOT NULL,
      level   TEXT NOT NULL,                     -- 'info' | 'warn' | 'error'
      source  TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);
  `);

  migrate(database);
}

/** Idempotent column migrations for databases created before a column existed. */
function migrate(database: Database.Database): void {
  const cols = database
    .prepare(`PRAGMA table_info(users)`)
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === 'enabled')) {
    database.exec(
      `ALTER TABLE users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`
    );
  }

  // Migrate the legacy global keeps table (rating_key PK, kept_by) to per-user
  // (plex_user_id, rating_key). The new applySchema CREATE only runs on a fresh
  // DB; existing DBs still have the old shape until rebuilt here.
  const keepCols = database
    .prepare(`PRAGMA table_info(keeps)`)
    .all() as { name: string }[];
  if (keepCols.length > 0 && !keepCols.some((c) => c.name === 'plex_user_id')) {
    database.exec(`
      CREATE TABLE keeps_new (
        plex_user_id TEXT NOT NULL,
        rating_key   TEXT NOT NULL REFERENCES media_items(rating_key) ON DELETE CASCADE,
        kept_at      INTEGER NOT NULL,
        PRIMARY KEY (plex_user_id, rating_key)
      );
      INSERT OR IGNORE INTO keeps_new (plex_user_id, rating_key, kept_at)
        SELECT kept_by, rating_key, kept_at FROM keeps;
      DROP TABLE keeps;
      ALTER TABLE keeps_new RENAME TO keeps;
      CREATE INDEX IF NOT EXISTS idx_keeps_item ON keeps(rating_key);
    `);
  }
}

function init(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  applySchema(database);
  return database;
}

export function getDb(): Database.Database {
  if (!db) {
    db = init();
  }
  return db;
}

/**
 * Test helper: replace the singleton with a fresh in-memory database so tests
 * run against a real SQLite instance (no mocks) in full isolation. Call in
 * beforeEach. Never used by the app at runtime.
 */
export function __setTestDbToMemory(): Database.Database {
  if (db) db.close();
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  applySchema(db);
  return db;
}

/** Test helper: close and clear the singleton. Call in afterAll. */
export function __closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
