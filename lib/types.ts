/** Shared data-transfer types across the queries layer, API routes, and UI. */

export type LibraryKind = 'movie' | 'show';

/** A row from media_items as stored. */
export interface MediaItem {
  rating_key: string;
  section_id: string;
  library_kind: LibraryKind;
  title: string;
  year: number | null;
  thumb: string | null;
  size_bytes: number;
  added_at: number | null;
  guid_tmdb: string | null;
  guid_tvdb: string | null;
  /** On-disk names/path captured from the media server (NULL until a library
   *  scan records them). Optional: older row casts predate the columns. */
  dir_name?: string | null;
  file_name?: string | null;
  dir_path?: string | null;
  last_synced: number;
  removed: number;
}

/** A media item enriched with per-request flags for the UI. */
export interface MediaCardData {
  ratingKey: string;
  sectionId: string;
  libraryKind: LibraryKind;
  title: string;
  year: number | null;
  /** Local proxy URL for the poster (never exposes the Plex token). */
  thumbUrl: string | null;
  sizeBytes: number;
  /** True when anyone keeps it (protected from reclaim). */
  kept: boolean;
  /** True when the current user keeps it (only their own keep is removable). */
  keptByMe?: boolean;
  /** True when the current user has marked this "don't care". */
  skipped?: boolean;
  /** True when the current user has watched it (any plays, from Tautulli). */
  watched?: boolean;
  // --- "OK to delete" (the original Seerr requester signing off) ---
  /** True when the current user requested this on Seerr (gates the control). */
  requestedByMe?: boolean;
  /** True when the current user marked this "OK to delete". */
  markedForDeleteByMe?: boolean;
  /** True when anyone marked it "OK to delete" — carries NO identity (Browse
   *  never reveals who, except via markedForDeleteByMe). */
  markedForDeleteAny?: boolean;
  // --- Sonarr/Radarr metadata (present only when the title is arr-matched) ---
  /** 'sonarr' | 'radarr'. */
  source?: string;
  instanceName?: string;
  monitored?: boolean;
  /** Raw arr status (continuing/ended/released…). */
  status?: string;
  /** Movie: actual file quality; series: quality profile name. */
  quality?: string;
  /** 'file' (movie, actual) | 'profile' (series, target). */
  qualityKind?: string;
  /** Resolved Sonarr/Radarr tag labels. */
  tags?: string[];
  /** arr-reported size on disk (for the Plex-vs-arr cross-check). */
  arrSizeBytes?: number;
  /** True when Plex size and arr size diverge materially (likely partial/broken). */
  sizeMismatch?: boolean;
}

export interface SessionUser {
  plexUserId: string;
  username: string | null;
  email: string | null;
  thumb: string | null;
  isAdmin: boolean;
  /** False = account is blocked from signing in. */
  enabled: boolean;
}

/** A user as the admin "Users" management screen sees them. */
export interface AdminUserRow {
  plexUserId: string;
  username: string | null;
  email: string | null;
  thumb: string | null;
  isAdmin: boolean;
  /** False = account is blocked from signing in. */
  enabled: boolean;
  /** True for the server Owner (plex_owner_id) — admin can never be revoked. */
  isOwner: boolean;
  lastLogin: number | null;
  createdAt: number;
}

export interface SyncStatus {
  lastRun: number | null;
  lastStatus: string | null;
  lastMessage: string | null;
  itemsSynced: number | null;
}

export type JobStatus = 'never' | 'running' | 'ok' | 'error';

/** One app-event log line (Settings → Logs). */
export interface LogRow {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

/** One historical job execution (for the admin activity log). */
export interface JobRun {
  id: number;
  jobId: string;
  startedAt: number;
  endedAt: number | null;
  status: string | null;
  message: string | null;
  durationMs: number | null;
  result: number | null;
}

/** Status of one scheduled refresh job. */
export interface JobState {
  jobId: string;
  lastRun: number | null;
  lastStatus: JobStatus;
  lastMessage: string | null;
  lastDurationMs: number | null;
  lastResult: number | null;
}

// --- Problems page (admin) ---

/** The problem categories the admin Problems page can show. */
export type ProblemType =
  | 'sizeMismatch' // Plex vs *arr size diverges >10% AND >1 GB
  | 'notInArr' // in the media server, matched by no Sonarr/Radarr instance
  | 'missingFromPlex' // downloaded in *arr but not in the media server (arr_unmatched)
  | 'duplicates' // two+ media items sharing an external id
  | 'arrConflicts' // two *arr instances claiming the same media item
  | 'zeroSize' // media server reports the title but no file bytes
  | 'removedButKept' // gone from the media server while someone still keeps it
  | 'missingIds' // no tvdb/tmdb/imdb id — can never match *arr
  | 'diskOrphans'; // reserved stub (disk-scan job not built yet) — never queryable

/** One pill on the Problems page.
 *  `bytes` semantics vary per category: sizeMismatch = summed |Plex−arr| delta;
 *  missingFromPlex/arrConflicts = summed *arr size on disk; duplicates = summed
 *  member bytes (and `titles` = GROUP count, not item count); zeroSize = always 0;
 *  removedButKept = summed last-known sizes; notInArr/missingIds = summed Plex sizes. */
export interface ProblemCategorySummary {
  type: ProblemType;
  /** False = category can't run (arr not configured / storage unmapped / never scanned). */
  available: boolean;
  /** Reserved for future not-yet-built categories — the UI shows a dimmed
   *  "Planned" pill. (No category sets it today; kept for API stability.) */
  planned?: boolean;
  /** Why an otherwise-buildable category is unavailable — the UI shows a dimmed
   *  pill with a fix-it tooltip instead of hiding it. */
  reason?: 'storage_not_configured' | 'not_scanned';
  titles: number;
  bytes: number;
}

/** A Plex library as the UI sees it. */
export interface LibrarySection {
  sectionId: string;
  title: string;
  /** Plex's own section type (movie/show). */
  kind: LibraryKind;
  itemCount: number;
  /** Total bytes this library occupies on disk (summed media sizes). */
  sizeBytes: number;
}
