import { getDb } from './db';
import { FEED_MOVIE_RESERVE_MIN, FEED_MOVIE_RESERVE_RATIO } from './config';
import type {
  AdminUserRow,
  JobRun,
  JobState,
  LibraryKind,
  LogRow,
  MediaItem,
  SessionUser,
  SyncStatus,
} from './types';

const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Settings (key/value). Token values are encrypted by the caller before set.
// ---------------------------------------------------------------------------

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function countAdmins(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1')
    .get() as { n: number };
  return row.n;
}

export function countUsers(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM users')
    .get() as { n: number };
  return row.n;
}

export interface UpsertUserInput {
  plexUserId: string;
  username: string | null;
  email: string | null;
  thumb: string | null;
  isAdmin: boolean;
  /** Initial enabled state on first insert (default true); preserved on update. */
  enabled?: boolean;
}

/**
 * Insert or update a user, recording the login time. Preserves is_admin once set
 * and never changes `enabled` on update (set it explicitly via setUserEnabled).
 */
export function upsertUser(input: UpsertUserInput): void {
  getDb()
    .prepare(
      `INSERT INTO users (plex_user_id, username, email, thumb, is_admin, enabled, created_at, last_login)
       VALUES (@plexUserId, @username, @email, @thumb, @isAdmin, @enabled, @ts, @ts)
       ON CONFLICT(plex_user_id) DO UPDATE SET
         username   = excluded.username,
         email      = excluded.email,
         thumb      = excluded.thumb,
         is_admin   = MAX(users.is_admin, excluded.is_admin),
         last_login = excluded.last_login`
    )
    .run({
      plexUserId: input.plexUserId,
      username: input.username,
      email: input.email,
      thumb: input.thumb,
      isAdmin: input.isAdmin ? 1 : 0,
      enabled: input.enabled === false ? 0 : 1,
      ts: now(),
    });
}

export function getUser(plexUserId: string): SessionUser | null {
  const row = getDb()
    .prepare(
      'SELECT plex_user_id, username, email, thumb, is_admin, enabled FROM users WHERE plex_user_id = ?'
    )
    .get(plexUserId) as
    | {
        plex_user_id: string;
        username: string | null;
        email: string | null;
        thumb: string | null;
        is_admin: number;
        enabled: number;
      }
    | undefined;
  if (!row) return null;
  return {
    plexUserId: row.plex_user_id,
    username: row.username,
    email: row.email,
    thumb: row.thumb,
    isAdmin: row.is_admin === 1,
    enabled: row.enabled === 1,
  };
}

/**
 * List every user who has logged in, admins first then most-recently-seen.
 * `isOwner` is not stored here — the caller annotates it via getOwnerId().
 */
export function listUsers(): Omit<AdminUserRow, 'isOwner'>[] {
  const rows = getDb()
    .prepare(
      `SELECT plex_user_id, username, email, thumb, is_admin, enabled, last_login, created_at
       FROM users
       ORDER BY is_admin DESC, last_login DESC`
    )
    .all() as {
    plex_user_id: string;
    username: string | null;
    email: string | null;
    thumb: string | null;
    is_admin: number;
    enabled: number;
    last_login: number | null;
    created_at: number;
  }[];
  return rows.map((r) => ({
    plexUserId: r.plex_user_id,
    username: r.username,
    email: r.email,
    thumb: r.thumb,
    isAdmin: r.is_admin === 1,
    enabled: r.enabled === 1,
    lastLogin: r.last_login,
    createdAt: r.created_at,
  }));
}

/**
 * Explicitly set or clear a user's admin flag. The deliberate counterpart to
 * upsertUser, whose MAX(is_admin, …) clause can only ever raise the flag.
 */
export function setUserAdmin(plexUserId: string, isAdmin: boolean): void {
  getDb()
    .prepare('UPDATE users SET is_admin = ? WHERE plex_user_id = ?')
    .run(isAdmin ? 1 : 0, plexUserId);
}

/** Enable or block a user from signing in. */
export function setUserEnabled(plexUserId: string, enabled: boolean): void {
  getDb()
    .prepare('UPDATE users SET enabled = ? WHERE plex_user_id = ?')
    .run(enabled ? 1 : 0, plexUserId);
}

// ---------------------------------------------------------------------------
// Media items (sync writes these)
// ---------------------------------------------------------------------------

export interface UpsertMediaInput {
  ratingKey: string;
  sectionId: string;
  libraryKind: LibraryKind;
  title: string;
  year: number | null;
  thumb: string | null;
  sizeBytes: number;
  addedAt: number | null;
  guidTmdb: string | null;
  guidTvdb: string | null;
}

const upsertMediaStmt = () =>
  getDb().prepare(
    `INSERT INTO media_items
       (rating_key, section_id, library_kind, title, year, thumb, size_bytes,
        added_at, guid_tmdb, guid_tvdb, last_synced, removed)
     VALUES
       (@ratingKey, @sectionId, @libraryKind, @title, @year, @thumb, @sizeBytes,
        @addedAt, @guidTmdb, @guidTvdb, @ts, 0)
     ON CONFLICT(rating_key) DO UPDATE SET
       section_id   = excluded.section_id,
       library_kind = excluded.library_kind,
       title        = excluded.title,
       year         = excluded.year,
       thumb        = excluded.thumb,
       size_bytes   = excluded.size_bytes,
       added_at     = excluded.added_at,
       guid_tmdb    = excluded.guid_tmdb,
       guid_tvdb    = excluded.guid_tvdb,
       last_synced  = excluded.last_synced,
       removed      = 0`
  );

/**
 * Upsert a batch of media items in a single transaction. Returns count.
 *
 * Pass a single `syncedAt` for the whole sync so every touched item shares one
 * last_synced value; then call tombstoneStale(syncedAt) afterwards to remove
 * anything not re-touched. Defaults to now() for ad-hoc writes.
 */
export function upsertMediaBatch(
  items: UpsertMediaInput[],
  syncedAt: number = now()
): number {
  const db = getDb();
  const stmt = upsertMediaStmt();
  const run = db.transaction((rows: UpsertMediaInput[]) => {
    for (const r of rows) {
      stmt.run({ ...r, ts: syncedAt });
    }
  });
  run(items);
  return items.length;
}

/**
 * Tombstone any non-removed item whose last_synced is older than `before`.
 * Called at the end of a full sync (with that sync's timestamp) so items
 * deleted in Plex disappear here. Returns the number of items tombstoned.
 */
export function tombstoneStale(before: number): number {
  const info = getDb()
    .prepare(
      'UPDATE media_items SET removed = 1 WHERE removed = 0 AND last_synced < ?'
    )
    .run(before);
  return info.changes;
}

export function getMediaItem(ratingKey: string): MediaItem | null {
  return (
    (getDb()
      .prepare('SELECT * FROM media_items WHERE rating_key = ?')
      .get(ratingKey) as MediaItem | undefined) ?? null
  );
}

// ---------------------------------------------------------------------------
// Keeps (per-user; an item is "protected" if ANYONE keeps it)
// ---------------------------------------------------------------------------

/** Whether anyone keeps this item (= protected from reclaim). */
export function isKept(ratingKey: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM keeps WHERE rating_key = ?')
    .get(ratingKey);
  return !!row;
}

/** Whether THIS user keeps this item. */
export function isKeptByUser(plexUserId: string, ratingKey: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM keeps WHERE plex_user_id = ? AND rating_key = ?')
    .get(plexUserId, ratingKey);
  return !!row;
}

/** Add this user's keep. No-op if they already keep it. True if newly kept. */
export function addKeep(plexUserId: string, ratingKey: string): boolean {
  const info = getDb()
    .prepare(
      `INSERT INTO keeps (plex_user_id, rating_key, kept_at) VALUES (?, ?, ?)
       ON CONFLICT(plex_user_id, rating_key) DO NOTHING`
    )
    .run(plexUserId, ratingKey, now());
  return info.changes > 0;
}

/** Remove only THIS user's keep (never another user's). True if a row was removed. */
export function removeKeep(plexUserId: string, ratingKey: string): boolean {
  const info = getDb()
    .prepare('DELETE FROM keeps WHERE plex_user_id = ? AND rating_key = ?')
    .run(plexUserId, ratingKey);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Per-user skips ("don't care about the rest")
// ---------------------------------------------------------------------------

/** Record that a user doesn't care about these items. Returns count inserted. */
export function addSkips(plexUserId: string, ratingKeys: string[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO user_skips (plex_user_id, rating_key, skipped_at) VALUES (?, ?, ?)
     ON CONFLICT(plex_user_id, rating_key) DO NOTHING`
  );
  const ts = now();
  const run = db.transaction((keys: string[]) => {
    for (const k of keys) stmt.run(plexUserId, k, ts);
  });
  run(ratingKeys);
  return ratingKeys.length;
}

/** Mark a single item "don't care" for this user. True if newly inserted. */
export function addSkip(plexUserId: string, ratingKey: string): boolean {
  const info = getDb()
    .prepare(
      `INSERT INTO user_skips (plex_user_id, rating_key, skipped_at) VALUES (?, ?, ?)
       ON CONFLICT(plex_user_id, rating_key) DO NOTHING`
    )
    .run(plexUserId, ratingKey, now());
  return info.changes > 0;
}

/** Clear a single "don't care" for this user. True if a row was removed. */
export function removeSkip(plexUserId: string, ratingKey: string): boolean {
  const info = getDb()
    .prepare(
      'DELETE FROM user_skips WHERE plex_user_id = ? AND rating_key = ?'
    )
    .run(plexUserId, ratingKey);
  return info.changes > 0;
}

/** Whether this user has marked an item "don't care". */
export function isSkipped(plexUserId: string, ratingKey: string): boolean {
  const row = getDb()
    .prepare(
      'SELECT 1 AS n FROM user_skips WHERE plex_user_id = ? AND rating_key = ?'
    )
    .get(plexUserId, ratingKey) as { n: number } | undefined;
  return !!row;
}

// ---------------------------------------------------------------------------
// Feed (the home keep-loop)
// ---------------------------------------------------------------------------

export interface FeedOptions {
  preferWatched?: boolean;
  /**
   * Limit the feed to a single Plex library (section id). Omitted → a mix across
   * all libraries, weighted toward large series with a few movies guaranteed.
   * Libraries are whatever Plex reports — nothing is hardcoded by category.
   */
  sectionId?: string;
  /** Override the reserved movie count for the mixed (all-libraries) feed. */
  reserveMovies?: number;
}

/** Base eligibility: present, not globally kept, not skipped by this user. */
const FEED_ELIGIBILITY = `m.removed = 0
  AND m.rating_key NOT IN (SELECT rating_key FROM keeps)
  AND m.rating_key NOT IN (
    SELECT rating_key FROM user_skips WHERE plex_user_id = @uid
  )`;

/** A SQLite expression mapping random() (int64) to a (0,1) uniform. */
const RAND_UNIT =
  '((random() + 9223372036854775808.0) / 18446744073709551615.0)';

/**
 * Feed for the home keep-loop. With a `sectionId` it returns a size-weighted
 * batch from that one Plex library; otherwise a screen-fill mix across all
 * libraries, weighted toward large series but with a guaranteed few movies.
 * ("Largest overall" is served by the route via largestItems.)
 */
export function getFeed(
  plexUserId: string,
  limit: number,
  opts: FeedOptions = {}
): MediaItem[] {
  if (opts.sectionId) {
    return weightedPull(plexUserId, { sectionId: opts.sectionId }, limit, []);
  }
  return getFeedAll(plexUserId, limit, opts);
}

/**
 * Pull eligible items size-weighted (Efraimidis–Spirakis), restricted either to
 * a library_kind (used to guarantee some movies in the mix) or to one Plex
 * section. library_kind is Plex's own section type, not an invented category.
 */
function weightedPull(
  plexUserId: string,
  filter: { libraryKind?: LibraryKind; sectionId?: string },
  limit: number,
  excludeKeys: string[]
): MediaItem[] {
  if (limit <= 0) return [];
  const params: Record<string, unknown> = { uid: plexUserId, limit };
  const clauses: string[] = [];
  if (filter.libraryKind) {
    clauses.push('m.library_kind = @libraryKind');
    params.libraryKind = filter.libraryKind;
  }
  if (filter.sectionId) {
    clauses.push('m.section_id = @sectionId');
    params.sectionId = filter.sectionId;
  }
  excludeKeys.forEach((k, i) => (params[`ex${i}`] = k));
  if (excludeKeys.length) {
    clauses.push(
      `m.rating_key NOT IN (${excludeKeys.map((_, i) => `@ex${i}`).join(', ')})`
    );
  }
  const extra = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(
      `WITH elig AS (
         SELECT m.* FROM media_items m
         WHERE ${FEED_ELIGIBILITY} ${extra}
       ),
       stats AS (SELECT AVG(size_bytes) AS avg_size FROM elig)
       SELECT e.* FROM elig e, stats s
       ORDER BY pow(
         ${RAND_UNIT},
         1.0 / MAX(CAST(e.size_bytes AS REAL) / NULLIF(s.avg_size, 0), 0.01)
       ) DESC
       LIMIT @limit`
    )
    .all(params) as MediaItem[];
}

/** Mixed feed: a few movies guaranteed, the rest big-series-weighted shows. */
function getFeedAll(
  plexUserId: string,
  limit: number,
  opts: FeedOptions
): MediaItem[] {
  const reserveMovies =
    opts.reserveMovies ??
    Math.max(FEED_MOVIE_RESERVE_MIN, Math.ceil(limit * FEED_MOVIE_RESERVE_RATIO));

  const movies = weightedPull(
    plexUserId,
    { libraryKind: 'movie' },
    Math.min(reserveMovies, limit),
    []
  );
  const shows = weightedPull(
    plexUserId,
    { libraryKind: 'show' },
    limit - movies.length,
    []
  );

  let combined = [...movies, ...shows];
  if (combined.length < limit) {
    // Shows ran short — backfill with more movies we haven't used.
    const used = combined.map((m) => m.rating_key);
    combined = combined.concat(
      weightedPull(plexUserId, { libraryKind: 'movie' }, limit - combined.length, used)
    );
  }

  // Shuffle so the reserved movies aren't always first. Fisher–Yates.
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined.slice(0, limit);
}

/** How many items remain for this user to triage (not kept, not skipped). */
export function countFeedRemaining(
  plexUserId: string,
  opts: { sectionId?: string } = {}
): number {
  const params: Record<string, unknown> = { uid: plexUserId };
  let sectionSql = '';
  if (opts.sectionId) {
    sectionSql = ' AND m.section_id = @sectionId';
    params.sectionId = opts.sectionId;
  }
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM media_items m
       WHERE ${FEED_ELIGIBILITY}${sectionSql}`
    )
    .get(params) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// Library browse / search
// ---------------------------------------------------------------------------

export type LibrarySort = 'size' | 'title' | 'added' | 'year';
export type SortDir = 'asc' | 'desc';
export type KeptFilter = 'all' | 'kept' | 'unkept';
export type SkipFilter = 'all' | 'skipped' | 'unskipped';

export interface LibraryQuery {
  plexUserId: string; // required for the per-user "don't care" flag + filter
  /** Restrict to these Plex libraries (section ids). Empty/omitted = all. */
  sectionIds?: string[];
  search?: string;
  sort?: LibrarySort;
  dir?: SortDir;
  /** Legacy convenience: same as keptFilter='unkept'. */
  hideKept?: boolean;
  keptFilter?: KeptFilter;
  skipFilter?: SkipFilter;
  /**
   * Restrict to these rating keys (e.g. Seerr "requested by me"). `null`/omitted
   * = no restriction; an empty array = match nothing.
   */
  requestedKeys?: string[] | null;
  limit: number;
  offset: number;
}

const sortColumn: Record<LibrarySort, string> = {
  size: 'm.size_bytes',
  title: 'm.title COLLATE NOCASE',
  added: 'm.added_at',
  year: 'm.year',
};

/** A media row joined with its kept status. */
export interface MediaWithKeep extends MediaItem {
  kept: number; // anyone keeps it (protected)
  kept_by_me: number; // this user keeps it
}

/** A library row: kept status + this user's "don't care" state. */
export interface LibraryRow extends MediaWithKeep {
  skipped: number;
}

export function queryLibrary(q: LibraryQuery): LibraryRow[] {
  const where: string[] = ['m.removed = 0'];
  const params: Record<string, unknown> = {
    uid: q.plexUserId,
    limit: q.limit,
    offset: q.offset,
  };
  if (q.sectionIds && q.sectionIds.length > 0) {
    const named = q.sectionIds.map((_, i) => `@sec${i}`);
    q.sectionIds.forEach((id, i) => (params[`sec${i}`] = id));
    where.push(`m.section_id IN (${named.join(', ')})`);
  }
  if (q.search && q.search.trim()) {
    where.push('m.title LIKE @search COLLATE NOCASE');
    params.search = `%${q.search.trim()}%`;
  }

  const keptExists =
    'EXISTS (SELECT 1 FROM keeps k WHERE k.rating_key = m.rating_key)';
  const keptFilter: KeptFilter = q.hideKept ? 'unkept' : q.keptFilter ?? 'all';
  if (keptFilter === 'kept') where.push(keptExists);
  else if (keptFilter === 'unkept') where.push(`NOT ${keptExists}`);

  const skipFilter: SkipFilter = q.skipFilter ?? 'all';
  if (skipFilter === 'skipped') where.push('s.rating_key IS NOT NULL');
  else if (skipFilter === 'unskipped') where.push('s.rating_key IS NULL');

  if (q.requestedKeys != null) {
    if (q.requestedKeys.length === 0) {
      where.push('1 = 0'); // requested-by-me with nothing requested → no rows
    } else {
      const named = q.requestedKeys.map((_, i) => `@req${i}`);
      q.requestedKeys.forEach((k, i) => (params[`req${i}`] = k));
      where.push(`m.rating_key IN (${named.join(', ')})`);
    }
  }

  const col = sortColumn[q.sort ?? 'size'];
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  // NULLs last regardless of direction; stable title tiebreak.
  const order = `${col} ${dir} NULLS LAST, m.title COLLATE NOCASE ASC`;

  return getDb()
    .prepare(
      `SELECT m.*, ${keptExists} AS kept,
              (km.rating_key IS NOT NULL) AS kept_by_me,
              (s.rating_key IS NOT NULL) AS skipped
       FROM media_items m
       LEFT JOIN keeps km
         ON km.rating_key = m.rating_key AND km.plex_user_id = @uid
       LEFT JOIN user_skips s
         ON s.rating_key = m.rating_key AND s.plex_user_id = @uid
       WHERE ${where.join(' AND ')}
       ORDER BY ${order}
       LIMIT @limit OFFSET @offset`
    )
    .all(params) as LibraryRow[];
}

// ---------------------------------------------------------------------------
// Search (typeahead + results page)
// ---------------------------------------------------------------------------

export interface SearchRow extends MediaItem {
  kept: number;
  kept_by_me: number;
  skipped: number;
  score: number;
}

/**
 * Relevance search over titles, approximating the "partial match, best first,
 * live as you type" feel of Plex/Seerr (local index, no spell-check). Tiered
 * scoring: exact > prefix > word-start > substring, plus a per-token bonus.
 * Every whitespace token must appear (AND), so "lego batman" excludes a plain
 * "Batman". Returns kept + this user's "don't care" state for the UI.
 */
export function searchMedia(params: {
  query: string;
  plexUserId: string;
  limit: number;
  offset: number;
}): SearchRow[] {
  const q = params.query.trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const sqlParams: Record<string, unknown> = {
    uid: params.plexUserId,
    limit: params.limit,
    offset: params.offset,
    qExact: q,
    qPrefix: `${q}%`,
    qWord: `% ${q}%`,
    qSub: `%${q}%`,
  };

  const tokenWhere: string[] = [];
  const tokenScore: string[] = [];
  tokens.forEach((t, i) => {
    sqlParams[`tok${i}`] = `%${t}%`;
    tokenWhere.push(`m.title LIKE @tok${i} COLLATE NOCASE`);
    tokenScore.push(
      `CASE WHEN m.title LIKE @tok${i} COLLATE NOCASE THEN 10 ELSE 0 END`
    );
  });

  const score = `(
      CASE WHEN m.title = @qExact COLLATE NOCASE THEN 1000 ELSE 0 END
    + CASE WHEN m.title LIKE @qPrefix COLLATE NOCASE THEN 200 ELSE 0 END
    + CASE WHEN (' ' || m.title) LIKE @qWord COLLATE NOCASE THEN 80 ELSE 0 END
    + CASE WHEN m.title LIKE @qSub COLLATE NOCASE THEN 30 ELSE 0 END
    + ${tokenScore.join(' + ')}
  )`;

  return getDb()
    .prepare(
      `SELECT m.*,
              EXISTS (SELECT 1 FROM keeps k WHERE k.rating_key = m.rating_key) AS kept,
              (km.rating_key IS NOT NULL) AS kept_by_me,
              (s.rating_key IS NOT NULL) AS skipped,
              ${score} AS score
       FROM media_items m
       LEFT JOIN keeps km
         ON km.rating_key = m.rating_key AND km.plex_user_id = @uid
       LEFT JOIN user_skips s
         ON s.rating_key = m.rating_key AND s.plex_user_id = @uid
       WHERE m.removed = 0 AND ${tokenWhere.join(' AND ')}
       ORDER BY score DESC, m.size_bytes DESC, m.title COLLATE NOCASE ASC
       LIMIT @limit OFFSET @offset`
    )
    .all(sqlParams) as SearchRow[];
}

// ---------------------------------------------------------------------------
// Big-picture stats
// ---------------------------------------------------------------------------

/** Largest items overall (kept or not), with kept flags for this user. */
export function largestItems(
  limit: number,
  offset: number,
  plexUserId: string
): MediaWithKeep[] {
  return getDb()
    .prepare(
      `SELECT m.*,
              EXISTS (SELECT 1 FROM keeps k WHERE k.rating_key = m.rating_key) AS kept,
              (km.rating_key IS NOT NULL) AS kept_by_me
       FROM media_items m
       LEFT JOIN keeps km
         ON km.rating_key = m.rating_key AND km.plex_user_id = @uid
       WHERE m.removed = 0
       ORDER BY m.size_bytes DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ uid: plexUserId, limit, offset }) as MediaWithKeep[];
}

/** Reclaimable items: NOT kept by anyone, largest first. */
export function reclaimableItems(limit: number, offset: number): MediaItem[] {
  return getDb()
    .prepare(
      `SELECT m.* FROM media_items m
       WHERE m.removed = 0
         AND m.rating_key NOT IN (SELECT rating_key FROM keeps)
       ORDER BY m.size_bytes DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as MediaItem[];
}

/** Total bytes that could be freed (everything not kept). */
export function reclaimableTotalBytes(): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM media_items
       WHERE removed = 0 AND rating_key NOT IN (SELECT rating_key FROM keeps)`
    )
    .get() as { total: number };
  return row.total;
}

export interface LibraryStats {
  totalItems: number;
  totalBytes: number;
  keptItems: number;
  keptBytes: number;
  reclaimableBytes: number;
}

export function libraryStats(): LibraryStats {
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS items, COALESCE(SUM(size_bytes), 0) AS bytes
       FROM media_items WHERE removed = 0`
    )
    .get() as { items: number; bytes: number };
  const kept = db
    .prepare(
      `SELECT COUNT(*) AS items, COALESCE(SUM(m.size_bytes), 0) AS bytes
       FROM media_items m
       WHERE m.removed = 0
         AND EXISTS (SELECT 1 FROM keeps k WHERE k.rating_key = m.rating_key)`
    )
    .get() as { items: number; bytes: number };
  return {
    totalItems: totals.items,
    totalBytes: totals.bytes,
    keptItems: kept.items,
    keptBytes: kept.bytes,
    reclaimableBytes: totals.bytes - kept.bytes,
  };
}

/** Distinct sections present in the synced data, with counts. */
export function sectionsWithCounts(): {
  section_id: string;
  library_kind: LibraryKind;
  n: number;
}[] {
  return getDb()
    .prepare(
      `SELECT section_id, library_kind, COUNT(*) AS n
       FROM media_items WHERE removed = 0
       GROUP BY section_id, library_kind`
    )
    .all() as { section_id: string; library_kind: LibraryKind; n: number }[];
}

/** Per-section item count + total bytes (for the library sidebar + storage). */
export function sectionSizeSummary(): {
  section_id: string;
  library_kind: LibraryKind;
  n: number;
  bytes: number;
}[] {
  return getDb()
    .prepare(
      `SELECT section_id, library_kind, COUNT(*) AS n,
              COALESCE(SUM(size_bytes), 0) AS bytes
       FROM media_items WHERE removed = 0
       GROUP BY section_id, library_kind`
    )
    .all() as {
    section_id: string;
    library_kind: LibraryKind;
    n: number;
    bytes: number;
  }[];
}

/**
 * Per-library breakdown for a given user. Every non-removed title falls into
 * exactly one of three buckets so the byte/item counts partition the total:
 *   - kept     = protected (ANYONE keeps it; safe from reclaim)
 *   - dontcare = not protected AND this user marked "don't care"
 *   - undecided= not protected AND this user hasn't decided (their triage queue)
 * `kept_by_me_*` is a sub-count of `kept_*` (how much of the protected set is
 * the caller's own keep). Reclaimable = dontcare + undecided = bytes - kept.
 */
export interface LibrarySummaryRow {
  section_id: string;
  items: number;
  bytes: number;
  kept_items: number;
  kept_bytes: number;
  kept_by_me_items: number;
  kept_by_me_bytes: number;
  dontcare_items: number;
  dontcare_bytes: number;
  undecided_items: number;
  undecided_bytes: number;
}

export function librarySummary(plexUserId: string): LibrarySummaryRow[] {
  const protectedExpr =
    'EXISTS (SELECT 1 FROM keeps k WHERE k.rating_key = m.rating_key)';
  return getDb()
    .prepare(
      `SELECT m.section_id,
              COUNT(*) AS items,
              COALESCE(SUM(m.size_bytes), 0) AS bytes,
              COALESCE(SUM(CASE WHEN ${protectedExpr} THEN 1 ELSE 0 END), 0) AS kept_items,
              COALESCE(SUM(CASE WHEN ${protectedExpr} THEN m.size_bytes ELSE 0 END), 0) AS kept_bytes,
              COALESCE(SUM(CASE WHEN km.rating_key IS NOT NULL THEN 1 ELSE 0 END), 0) AS kept_by_me_items,
              COALESCE(SUM(CASE WHEN km.rating_key IS NOT NULL THEN m.size_bytes ELSE 0 END), 0) AS kept_by_me_bytes,
              COALESCE(SUM(CASE WHEN NOT ${protectedExpr} AND s.rating_key IS NOT NULL THEN 1 ELSE 0 END), 0) AS dontcare_items,
              COALESCE(SUM(CASE WHEN NOT ${protectedExpr} AND s.rating_key IS NOT NULL THEN m.size_bytes ELSE 0 END), 0) AS dontcare_bytes,
              COALESCE(SUM(CASE WHEN NOT ${protectedExpr} AND s.rating_key IS NULL THEN 1 ELSE 0 END), 0) AS undecided_items,
              COALESCE(SUM(CASE WHEN NOT ${protectedExpr} AND s.rating_key IS NULL THEN m.size_bytes ELSE 0 END), 0) AS undecided_bytes
       FROM media_items m
       LEFT JOIN keeps km ON km.rating_key = m.rating_key AND km.plex_user_id = @uid
       LEFT JOIN user_skips s ON s.rating_key = m.rating_key AND s.plex_user_id = @uid
       WHERE m.removed = 0
       GROUP BY m.section_id`
    )
    .all({ uid: plexUserId }) as LibrarySummaryRow[];
}

/** Total used bytes per section id (used by the storage report). */
export function usedBytesBySection(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT section_id, COALESCE(SUM(size_bytes), 0) AS bytes
       FROM media_items WHERE removed = 0
       GROUP BY section_id`
    )
    .all() as { section_id: string; bytes: number }[];
  return new Map(rows.map((r) => [r.section_id, r.bytes]));
}

// ---------------------------------------------------------------------------
// Watch history (Tautulli sync writes these)
// ---------------------------------------------------------------------------

export function upsertWatchBatch(
  rows: {
    plexUserId: string;
    ratingKey: string;
    plays: number;
    lastWatched: number | null;
  }[]
): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO watch_history (plex_user_id, rating_key, plays, last_watched)
     VALUES (@plexUserId, @ratingKey, @plays, @lastWatched)
     ON CONFLICT(plex_user_id, rating_key) DO UPDATE SET
       plays = excluded.plays,
       last_watched = excluded.last_watched`
  );
  const run = db.transaction((rs: typeof rows) => {
    for (const r of rs) stmt.run(r);
  });
  run(rows);
  return rows.length;
}

/** Rating keys the given user has watched (for the "you watched" badge). */
export function watchedRatingKeys(plexUserId: string): Set<string> {
  const rows = getDb()
    .prepare('SELECT rating_key FROM watch_history WHERE plex_user_id = ?')
    .all(plexUserId) as { rating_key: string }[];
  return new Set(rows.map((r) => r.rating_key));
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export function getSyncStatus(): SyncStatus {
  const row = getDb()
    .prepare('SELECT * FROM sync_state WHERE id = 1')
    .get() as {
    last_run: number | null;
    last_status: string | null;
    last_message: string | null;
    items_synced: number | null;
  };
  return {
    lastRun: row.last_run,
    lastStatus: row.last_status,
    lastMessage: row.last_message,
    itemsSynced: row.items_synced,
  };
}

export function setSyncStatus(s: Partial<SyncStatus>): void {
  const cur = getSyncStatus();
  const next = { ...cur, ...s };
  getDb()
    .prepare(
      `UPDATE sync_state SET
         last_run = @lastRun,
         last_status = @lastStatus,
         last_message = @lastMessage,
         items_synced = @itemsSynced
       WHERE id = 1`
    )
    .run(next);
}

// ---------------------------------------------------------------------------
// Per-job state (scheduled refresh jobs)
// ---------------------------------------------------------------------------

const DEFAULT_JOB_STATE: Omit<JobState, 'jobId'> = {
  lastRun: null,
  lastStatus: 'never',
  lastMessage: null,
  lastDurationMs: null,
  lastResult: null,
};

function rowToJobState(jobId: string, row: {
  last_run: number | null;
  last_status: string | null;
  last_message: string | null;
  last_duration_ms: number | null;
  last_result: number | null;
} | undefined): JobState {
  if (!row) return { jobId, ...DEFAULT_JOB_STATE };
  return {
    jobId,
    lastRun: row.last_run,
    lastStatus: (row.last_status as JobState['lastStatus']) ?? 'never',
    lastMessage: row.last_message,
    lastDurationMs: row.last_duration_ms,
    lastResult: row.last_result,
  };
}

export function getJobState(jobId: string): JobState {
  const row = getDb()
    .prepare('SELECT * FROM job_state WHERE job_id = ?')
    .get(jobId) as Parameters<typeof rowToJobState>[1];
  return rowToJobState(jobId, row);
}

export function getAllJobState(): JobState[] {
  const rows = getDb().prepare('SELECT * FROM job_state').all() as {
    job_id: string;
    last_run: number | null;
    last_status: string | null;
    last_message: string | null;
    last_duration_ms: number | null;
    last_result: number | null;
  }[];
  return rows.map((r) => rowToJobState(r.job_id, r));
}

export function setJobState(jobId: string, s: Partial<Omit<JobState, 'jobId'>>): void {
  const cur = getJobState(jobId);
  const next = { ...cur, ...s, jobId };
  getDb()
    .prepare(
      `INSERT INTO job_state
         (job_id, last_run, last_status, last_message, last_duration_ms, last_result)
       VALUES (@jobId, @lastRun, @lastStatus, @lastMessage, @lastDurationMs, @lastResult)
       ON CONFLICT(job_id) DO UPDATE SET
         last_run = excluded.last_run,
         last_status = excluded.last_status,
         last_message = excluded.last_message,
         last_duration_ms = excluded.last_duration_ms,
         last_result = excluded.last_result`
    )
    .run(next);
}

export function isJobRunning(jobId: string): boolean {
  return getJobState(jobId).lastStatus === 'running';
}

/** Append a finished run to the activity log, pruning to the most recent 100. */
export function recordJobRun(run: {
  jobId: string;
  startedAt: number;
  endedAt: number;
  status: string;
  message: string | null;
  durationMs: number;
  result: number | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO job_runs (job_id, started_at, ended_at, status, message, duration_ms, result)
     VALUES (@jobId, @startedAt, @endedAt, @status, @message, @durationMs, @result)`
  ).run(run);
  db.prepare(
    `DELETE FROM job_runs WHERE id NOT IN (
       SELECT id FROM job_runs ORDER BY started_at DESC LIMIT 100
     )`
  ).run();
}

// ---------------------------------------------------------------------------
// App event log
// ---------------------------------------------------------------------------

/** Append a log line, pruning to the most recent 1000. */
export function logEvent(
  level: 'info' | 'warn' | 'error',
  source: string,
  message: string
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO logs (ts, level, source, message) VALUES (?, ?, ?, ?)'
  ).run(now(), level, source, message);
  db.prepare(
    `DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY ts DESC LIMIT 1000)`
  ).run();
}

/** Recent log lines, newest first, optionally filtered by level. */
export function recentLogs(opts: { level?: string; limit?: number } = {}): LogRow[] {
  const limit = opts.limit ?? 200;
  const rows = (
    opts.level && opts.level !== 'all'
      ? getDb()
          .prepare('SELECT * FROM logs WHERE level = ? ORDER BY ts DESC LIMIT ?')
          .all(opts.level, limit)
      : getDb().prepare('SELECT * FROM logs ORDER BY ts DESC LIMIT ?').all(limit)
  ) as LogRow[];
  return rows;
}

export function clearLogs(): void {
  getDb().prepare('DELETE FROM logs').run();
}

/** Clear cached Seerr requests for everyone (rebuilt by the requests job). */
export function clearSeerrRequests(): number {
  return getDb().prepare('DELETE FROM seerr_requests').run().changes;
}

/** Clear cached watch history (rebuilt by the Tautulli job). */
export function clearWatchHistory(): number {
  return getDb().prepare('DELETE FROM watch_history').run().changes;
}

/** Most recent job runs across all jobs (for the admin activity log). */
export function recentJobRuns(limit: number): JobRun[] {
  const rows = getDb()
    .prepare(
      `SELECT id, job_id, started_at, ended_at, status, message, duration_ms, result
       FROM job_runs ORDER BY started_at DESC LIMIT ?`
    )
    .all(limit) as {
    id: number;
    job_id: string;
    started_at: number;
    ended_at: number | null;
    status: string | null;
    message: string | null;
    duration_ms: number | null;
    result: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    status: r.status,
    message: r.message,
    durationMs: r.duration_ms,
    result: r.result,
  }));
}

// ---------------------------------------------------------------------------
// Seerr request cache (refreshed by the 'requests' job)
// ---------------------------------------------------------------------------

/** Replace this user's cached Seerr request keys atomically. */
export function replaceSeerrRequests(
  plexUserId: string,
  ratingKeys: string[]
): void {
  const db = getDb();
  const del = db.prepare('DELETE FROM seerr_requests WHERE plex_user_id = ?');
  const ins = db.prepare(
    `INSERT INTO seerr_requests (plex_user_id, rating_key) VALUES (?, ?)
     ON CONFLICT(plex_user_id, rating_key) DO NOTHING`
  );
  db.transaction(() => {
    del.run(plexUserId);
    for (const rk of ratingKeys) ins.run(plexUserId, rk);
  })();
}

/** Cached Seerr request rating keys for a user. */
export function seerrRequestKeys(plexUserId: string): string[] {
  const rows = getDb()
    .prepare('SELECT rating_key FROM seerr_requests WHERE plex_user_id = ?')
    .all(plexUserId) as { rating_key: string }[];
  return rows.map((r) => r.rating_key);
}

/** Map of existing (non-removed) show rating_key → current size_bytes. */
export function existingShowSizes(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT rating_key, size_bytes FROM media_items
       WHERE removed = 0 AND library_kind = 'show'`
    )
    .all() as { rating_key: string; size_bytes: number }[];
  return new Map(rows.map((r) => [r.rating_key, r.size_bytes]));
}

/** Rating keys of all non-removed shows (for the size-recompute job). */
export function showRatingKeys(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT rating_key FROM media_items WHERE removed = 0 AND library_kind = 'show'`
    )
    .all() as { rating_key: string }[];
  return rows.map((r) => r.rating_key);
}

/** Update a single item's size on disk (used by the size-recompute job). */
export function updateItemSize(ratingKey: string, sizeBytes: number): void {
  getDb()
    .prepare('UPDATE media_items SET size_bytes = ? WHERE rating_key = ?')
    .run(sizeBytes, ratingKey);
}
