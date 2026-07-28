import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applySchema } from './db';

/**
 * Migration tests build their own raw databases (NOT __setTestDbToMemory,
 * which always starts from the current schema) so the pre-migration shape is
 * under test control, then run the real applySchema()/migrate() against them.
 */

let d: Database.Database;
afterEach(() => {
  d?.close();
});

/** A database as the pre-per-user-keeps versions created it. */
function legacyKeepsDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE media_items (
      rating_key   TEXT PRIMARY KEY,
      section_id   TEXT NOT NULL,
      library_kind TEXT NOT NULL,
      title        TEXT NOT NULL,
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      guid_tmdb    TEXT,
      guid_tvdb    TEXT,
      last_synced  INTEGER NOT NULL,
      removed      INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO media_items (rating_key, section_id, library_kind, title, last_synced)
      VALUES ('1', '10', 'movie', 'Alpha', 1000), ('2', '10', 'show', 'Beta', 1000);
    CREATE TABLE keeps (
      rating_key TEXT PRIMARY KEY REFERENCES media_items(rating_key) ON DELETE CASCADE,
      kept_by    TEXT,
      kept_at    INTEGER NOT NULL
    );
    INSERT INTO keeps (rating_key, kept_by, kept_at)
      VALUES ('1', 'u1', 100), ('2', 'u2', 200);
  `);
  return db;
}

function keepsCols(db: Database.Database): string[] {
  return (db.prepare('PRAGMA table_info(keeps)').all() as { name: string }[]).map(
    (c) => c.name
  );
}

function keepsRows(db: Database.Database) {
  return db
    .prepare('SELECT plex_user_id, rating_key, kept_at FROM keeps ORDER BY rating_key')
    .all();
}

describe('migrate: legacy keeps → per-user keeps', () => {
  it('rebuilds the legacy table carrying every keep', () => {
    d = legacyKeepsDb();
    applySchema(d);
    expect(keepsCols(d)).toContain('plex_user_id');
    expect(keepsRows(d)).toEqual([
      { plex_user_id: 'u1', rating_key: '1', kept_at: 100 },
      { plex_user_id: 'u2', rating_key: '2', kept_at: 200 },
    ]);
  });

  it('is idempotent on a second boot', () => {
    d = legacyKeepsDb();
    applySchema(d);
    applySchema(d);
    expect(keepsRows(d)).toHaveLength(2);
  });

  it('recovers from a crash that left an orphaned keeps_new behind', () => {
    d = legacyKeepsDb();
    // Simulate the old non-transactional rebuild dying after its CREATE TABLE:
    // a partial keeps_new exists while keeps is still legacy-shape. This used
    // to throw "table keeps_new already exists" on every subsequent boot.
    d.exec(`
      CREATE TABLE keeps_new (
        plex_user_id TEXT NOT NULL,
        rating_key   TEXT NOT NULL,
        kept_at      INTEGER NOT NULL,
        PRIMARY KEY (plex_user_id, rating_key)
      );
      INSERT INTO keeps_new VALUES ('u1', '1', 100);
    `);
    expect(() => applySchema(d)).not.toThrow();
    expect(keepsCols(d)).toContain('plex_user_id');
    expect(keepsRows(d)).toHaveLength(2);
    const leftover = d
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='keeps_new'`)
      .get();
    expect(leftover).toBeUndefined();
  });
});

describe('migrate: arr_unmatched gained columns', () => {
  it('adds size_bytes and instance_id to an old-shape table', () => {
    d = new Database(':memory:');
    d.exec(`
      CREATE TABLE arr_unmatched (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        source        TEXT NOT NULL,
        instance_name TEXT NOT NULL,
        title         TEXT NOT NULL,
        ext_kind      TEXT NOT NULL,
        ext_id        TEXT NOT NULL,
        last_synced   INTEGER NOT NULL
      );
      INSERT INTO arr_unmatched (source, instance_name, title, ext_kind, ext_id, last_synced)
        VALUES ('sonarr', 'Main', 'Gamma', 'tvdb', '42', 1000);
    `);
    applySchema(d);
    const cols = (
      d.prepare('PRAGMA table_info(arr_unmatched)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('size_bytes');
    expect(cols).toContain('instance_id');
    // Old rows default to '' — never in a preserve list, so the next
    // successful arr run replaces them.
    const row = d
      .prepare('SELECT instance_id, size_bytes FROM arr_unmatched')
      .get() as { instance_id: string; size_bytes: number };
    expect(row).toEqual({ instance_id: '', size_bytes: 0 });
    // folder_name (disk-orphan matching) also lands, NULL on old rows.
    expect(cols).toContain('folder_name');
    expect(
      (d.prepare('SELECT folder_name FROM arr_unmatched').get() as { folder_name: string | null })
        .folder_name
    ).toBeNull();
    // downloaded lands with default 1 — every pre-existing row WAS downloaded
    // (the old sync skipped fileless titles entirely).
    expect(cols).toContain('downloaded');
    expect(
      (d.prepare('SELECT downloaded FROM arr_unmatched').get() as { downloaded: number })
        .downloaded
    ).toBe(1);
  });
});

describe('migrate: disk-name columns land on old-shape tables', () => {
  it('media_items gains dir_name/file_name (NULL until the next library scan)', () => {
    d = new Database(':memory:');
    d.exec(`
      CREATE TABLE media_items (
        rating_key   TEXT PRIMARY KEY,
        section_id   TEXT NOT NULL,
        library_kind TEXT NOT NULL,
        title        TEXT NOT NULL,
        year         INTEGER,
        thumb        TEXT,
        size_bytes   INTEGER NOT NULL DEFAULT 0,
        added_at     INTEGER,
        guid_tmdb    TEXT,
        guid_tvdb    TEXT,
        last_synced  INTEGER NOT NULL,
        removed      INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO media_items (rating_key, section_id, library_kind, title, last_synced)
        VALUES ('1', '1', 'movie', 'Old Row', 1000);
    `);
    applySchema(d);
    const cols = (
      d.prepare('PRAGMA table_info(media_items)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('dir_name');
    expect(cols).toContain('file_name');
    const row = d
      .prepare('SELECT dir_name, file_name FROM media_items')
      .get() as { dir_name: string | null; file_name: string | null };
    expect(row).toEqual({ dir_name: null, file_name: null });
  });

  it('arr_items gains folder_name', () => {
    d = new Database(':memory:');
    d.exec(`
      CREATE TABLE arr_items (
        rating_key     TEXT PRIMARY KEY,
        source         TEXT NOT NULL,
        instance_id    TEXT NOT NULL,
        instance_name  TEXT NOT NULL,
        arr_id         INTEGER,
        monitored      INTEGER NOT NULL DEFAULT 0,
        status         TEXT,
        quality        TEXT,
        quality_kind   TEXT,
        root_folder    TEXT,
        arr_size_bytes INTEGER,
        tags           TEXT,
        last_synced    INTEGER NOT NULL
      );
    `);
    applySchema(d);
    const cols = (
      d.prepare('PRAGMA table_info(arr_items)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('folder_name');
  });
});
