# CLAUDE.md - Keeparr contributor guide

Keep this file and README.md in sync when you change behavior, schema, routes,
or settings keys.

## What Keeparr is

Plex-login web app for deciding what media to **keep** and reporting what can be
deleted. Tag + report only - **never deletes**. Keep is **per-user** but
protective: an item is kept (safe) if **anyone** keeps it, and you can only
remove **your own** keep. Per user the states are **mutually exclusive**:
none / keep / "don't care" / **"OK to delete"** - the last is the original Seerr
requester signing off ("I'm done with it"), offered **only on items that user
requested** and **only when Seerr is connected**. "OK to delete" does NOT override
anyone else's keep (a marked item stays protected while someone keeps it); it's
surfaced on Big Picture (with who marked it) and filterable on Browse (by you / by
anyone - the by-anyone view never reveals who). "Don't care" ("skip the rest") is
per-user. See README.md for the feature overview.

## Canonical rules

- **Categories are the user's actual Plex libraries - never hardcode "Movies /
  TV / Anime".** Everyone's library setup differs; the feed filters and library
  sidebar are driven by `getPlexSections()` (section ids). `library_kind`
  (movie/show) is Plex's own section type and may be used internally (e.g. to seed
  some movies into the mixed feed), but it is not a user-facing taxonomy.
- All SQL lives in `lib/queries.ts`. Don't write SQL elsewhere.
- All external HTTP lives in `lib/plex.ts`, `lib/jellyfin.ts`, `lib/tautulli.ts`,
  `lib/seerr.ts`, `lib/arr.ts`, `lib/version.ts` (mostly via `lib/http.ts` `fetchJson`;
  the plex.tv `/api/users` XML read in `getSharedUsers` and the
  Jellyfin/Emby `authenticateByName` POST use raw `fetch`). One deliberate exception
  outside these files: the poster proxy (`app/api/image/route.ts`) streams the
  upstream image bytes itself (fetchJson is JSON-only).
- All settings access goes through `lib/settings.ts` (typed getters; secrets are
  encrypted via `lib/crypto.ts`). Never read raw setting keys in routes.
- Route handlers are thin: auth-guard -> call lib -> return JSON. Use
  `requireUser` / `requireAdmin` from `lib/auth.ts` and `errorResponse` from
  `lib/route-helpers.ts`.
- Every route handler that touches SQLite/native code sets
  `export const runtime = 'nodejs'`.
- `lib/session.ts` must stay Edge-safe (Web Crypto only) - it's used by
  `middleware.ts`. No `node:` imports there.
- Tests use a real in-memory SQLite (`__setTestDbToMemory()`), never mocks for
  storage. Route tests mock only `next/headers` (the cookie jar) plus, where a
  test would otherwise hit the network or the real data dir, the
  network-facing lib clients (plex/jellyfin) or path config - never storage.
- The size unit on cards is `x.xx GB` via `formatGB` in `lib/format.ts`. Library/
  storage aggregates (sidebar sizes, the storage header) use `formatSize`, which
  auto-switches GB<->TB at 2 decimals.

## Architecture

```
middleware.ts        gate all routes behind a valid Plex session (Edge runtime)
instrumentation.ts   start the job scheduler on boot (Node runtime only)
lib/
  config.ts          env-derived config (DATA_DIR, SESSION_SECRET, APP_URL)
  db.ts              better-sqlite3 singleton + schema + test helpers
                     (+ closeDbForSwap() so backup restore can swap the db file)
  queries.ts         ALL SQL
  types.ts           shared DTOs
  format.ts          formatGB / formatSize
  crypto.ts          AES-GCM encrypt/decrypt for stored tokens
  session.ts         signed cookie (Edge-safe, Web Crypto)
  auth.ts            session read/write + requireUser/requireAdmin (Node)
  settings.ts        typed settings accessors (+ secret encryption)
  login.ts           pure access-control decision (decideAccess) - unit tested
  plex.ts            plex.tv OAuth + PMS read API + size summation helpers
  jellyfin.ts        Jellyfin/Emby client (MediaBrowser API): auth + server info +
                     users + library/item/series-size/watch reads
  tautulli.ts        watch-history client (an EXTRA source; the server's own
                     play history is read by the backend adapters)
  seerr.ts           requests client
  arr.ts             Sonarr/Radarr v3 client (shared) + pure normalize fns (fetchSonarr/fetchRadarr/testArr)
  quality.ts         pure resolutionBucket()/RES_ORDER (shared by Browse + Big Picture quality grouping)
  tour.ts            pure Keep-page tour steps (buildTourSteps, admin lines gated) +
                     availableSteps() (drops steps whose data-tour target is absent)
  paths.ts           pure separator-agnostic path-string helpers (lastSegment/
                     parentSegment/normalizeName) - foreign server-side paths may be
                     Windows-style, so never node:path
  diskscan.ts        the diskScan job - the REALITY-CHECK pass: (1) per mapped
                     library root, readdir top-level entries and flag names no
                     media item or *arr title claims (orphans get a recursive
                     size walk - known entries are never descended into);
                     (2) verifyArrUnmatchedOnDisk(): does each unmatched *arr
                     title's folder actually exist, and how big is it really
                     (arr_unmatched.on_disk/disk_size_bytes - also called after
                     every syncArr); (3) measure the real on-disk size of every
                     size-mismatched title (media_items.disk_size_bytes - the
                     Plex-vs-arr tiebreaker). Safety guard (skip mostly-unnamed
                     sections), wrong-mapping circuit breaker (record names,
                     skip sizing), mtime size cache, junk skip-list (JUNK_NAMES)
  version.ts         update check vs GitHub Releases (compareSemver + getVersionInfo,
                     in-memory ~6h cache, never throws - /api/about + health check)
  health.ts          healthIssues(): standing admin warnings derived from job_state/
                     settings/version cache (no live probes); each has a docSlug ->
                     README anchor
  backup.ts          SQLite backup/restore: createBackup (online db.backup), list/
                     delete/prune (retention), restoreBackup (pre-restore snapshot ->
                     online db.backup into DB_PATH -> closeDbForSwap -> reopen+migrate);
                     files in DATA_DIR/backups
  mediaserver/       backend read seam: types.ts (MediaBackend interface + BackendSection/
                     BackendItem), plex.ts (adapter over lib/plex), jellyfin.ts (adapter over
                     lib/jellyfin; serves Jellyfin AND Emby), index.ts getBackend() factory
                     (by media_server_type). The sync engine reads through this, never a
                     backend directly.
  sync.ts            job runners (backend-agnostic via getBackend()): syncRecentlyAdded /
                     syncLibrary / syncSizes / syncWatchHistory / syncSeerrRequests / syncArr
                     (+ syncSeerrRequestsForUser: warm one user's request cache on first login).
                     syncLibrary aborts on zero sections + skips tombstoning
                     empty-but-200 sections; syncArr keeps a failed instance's cache
                     + records claim collisions (cross- or same-instance) into arr_conflicts
                     (first record to claim a rating_key wins arr_items; later
                     claimants are recorded, not silently dropped) + reality-checks
                     the fresh unmatched rows on disk (verifyArrUnmatchedOnDisk,
                     non-fatal)
  jobs.ts            job registry + runJob/runWithState (single-flight) + isDue/dueJobs
  scheduler.ts       per-job scheduler (interval, daily or weekly; see isDue); fires due jobs each
                     minute; resets stale 'running' job rows at boot (resetInterruptedJobs)
  cards.ts           MediaItem -> MediaCardData (+ proxied poster URL)
  storage.ts         fs.statfs free/total per filesystem (Node-only); dedupes mounts
  cache.ts           on-disk poster cache (read/write/clear/stats) - Node-only
  route-helpers.ts   errorResponse
app/
  login/             Plex PIN login (popup + poll)
  page.tsx           home: AppShell -> KeepView (no-scroll single-screen)
  library/           AppShell -> LibraryBrowser (Browse; Grid/List view toggle, library
                     selection via rail, + Sonarr/Radarr quality/tag/monitored filters)
  search/            AppShell -> SearchResults
  stats/             AppShell -> StatsView (full-width dashboard)
  problems/          AppShell -> ProblemsView (admin-only problem-file dashboard:
                     category pills + per-category tables; non-admins -> /)
  api-docs/          interactive API reference (Scalar over /api/openapi.json;
                     session-gated server component + client dynamic import)
  settings/<tab>/    admin Settings sub-tabs: general, users, connections,
                     jobs, logs, about (+ /settings -> general). admin/* -> redirects.
  api/...            route handlers (see below)
components/          AppShell (rail + top bar + user menu), MediaCard (grid), MediaRow
                     (Browse List view), MultiSelect (grouped checkbox-dropdown filter),
                     useKeepState (shared keep/skip hook), KeepView,
                     LibraryBrowser, StatsView, ProblemsView (admin Problems page),
                     UsersManager, SearchBox, SearchResults, Tour (Keep-page guided
                     tour overlay: dims the page, rings `data-tour` targets, blocks
                     clicks underneath);
                     breakdown.tsx (shared keep/reclaim visual language: StackedBar,
                       Donut, LegendRow + the TONE palette - used by KeepView's totals
                       column and the StatsView dashboard);
                     settings/ (SettingsLayout in ui.tsx + General/Connections/JobsCache/Logs/About panels;
                       managed libraries + storage + Sonarr/Radarr instances + MatchHealthCard live
                       inside the Connections panel)
```

The chrome is a Sonarr/Radarr-style left rail (logo -> Keep; Keep / Browse[expand
-> libraries] / Big Picture / Problems[admin] / Settings[admin]) + a top bar
(search + user menu). `AppShell` (client) wraps every page; the Keep page renders
inside it with no page scroll.

## Database schema (`lib/db.ts`)

- `media_items` - one row per **series or movie** (no episodes). `size_bytes` is
  the summed total. `dir_name`/`file_name` are the item's on-disk names as the
  media server reports them (movie: Part.file / item Path; show: Location /
  series Path) - the disk-orphan scan's known-name set; `dir_path` is the FULL
  server-side folder path (the Problems page's clickable Location cells). All
  NULL until a library scan captures them. **Some PMS versions omit `Location`
  from show listings entirely** - shows then get dir_path/dir_name DERIVED from
  episode file paths (`deriveShowDirPaths` in lib/paths.ts: first segment under a
  known section root, else parent-of-file hopping season folders) via
  `backend.showSize()`, which returns `{sizeBytes, dirPath, dirNames}`: new
  shows fill at scan time, existing shows are backfilled by the `sizes` job.
  A show's `dir_name` is **newline-joined** when its episodes span several root
  folders (the server merges multi-folder shows; every folder must count as
  known to the disk scan - split on '\n' when consuming).
  `disk_size_bytes`/`disk_checked_at` = the MEASURED size (diskScan walks
  size-mismatched titles' folders - the tiebreaker column). `file_count` =
  movies only: distinct video files merged into the item (>1 = a multi-part/
  multi-version item, so its Plex-vs-arr size mismatch is BY DESIGN - the
  Problems page badges those "likely fine" instead of "rescan"); NULL for
  shows and until a library scan captures it. ALL disk-name
  writes are COALESCE-style (upsertMediaBatch + updateItemSize): an incoming
  NULL keeps the stored value - scans that don't recompute a show (known size ->
  no showSize call) must not wipe the sizes-job backfill (recentlyAdded runs
  every 5 min and would wipe it). Tombstoned with `removed=1` when
  gone from Plex. The full
  Library sweep aborts if the backend reports zero sections, and skips the
  removal check for scanned sections that returned zero items - an empty-but-200
  hiccup (e.g. PMS mid-restart) must not tombstone a whole library.
- `keeps` - per-user keeps. PK `(plex_user_id, rating_key)`; index on
  `rating_key`. An item is protected if **any** row exists for it; each user
  manages only their own keep. (Was a single global row per item; `migrate()`
  rebuilds the legacy table, carrying `kept_by` -> `plex_user_id` - inside one
  transaction, so a crash rolls back to the intact legacy table; an orphaned
  `keeps_new` from an older crash is dropped and the rebuild redone.)
- `user_skips` - `(plex_user_id, rating_key)`; per-user "don't care". Mutually
  exclusive with that user's keep + "OK to delete" (the keep/skip/mark-delete routes
  clear the others).
- `user_deletes` - `(plex_user_id, rating_key)` + `marked_at`; per-user "OK to
  delete" (the requester signing off). Only settable on an item that user requested
  (`isRequestedByUser` gate, from `seerr_requests`). Mutually exclusive with that
  user's keep/skip. Indexed by user (`idx_deletes_user`) and item (`idx_deletes_item`,
  for the by-anyone view + the attribution join to `users`). Excluded from that
  user's feed (`FEED_ELIGIBILITY`).
- `users` - media-server accounts (`plex_user_id` is the internal id - historically
  Plex, now the Plex/Jellyfin/Emby account id); `is_admin` (first login / server owner),
  `enabled` (admin can block an account; Owner is exempt), `session_epoch` (bumped to
  invalidate that user's outstanding tokens - admin-disable bumps it; session tokens
  carry the epoch at mint time and `getSessionUser` rejects a mismatch, so re-enabling
  never revives an old token), `tutorial_done_at` (NULL until the user finishes or skips
  the Keep-page tour; NULL on pre-existing rows on purpose, so existing users see it
  once). Migrated via guarded `ALTER TABLE`.
- `watch_history` - `(plex_user_id, rating_key)` `plays` + `last_watched`. Written by
  `syncWatchHistory`, which **MERGES every configured source** rather than picking one:
  the backend's own history (`getBackend().getWatchData()` - Plex's play history via
  `plexWatchHistory`, Jellyfin/Emby's `UserData`) **plus** Tautulli when connected. They
  see different things and BOTH matter: the server's history reaches back to when the
  server was built but only records a play once it scrobbles (~90% watched), while
  Tautulli's window starts at install but logs partial plays and remembers media the
  server has pruned. Measured on the live server: Plex's own history went back 4.4 years
  vs Tautulli's 13 months and flipped **1,717 titles** out of "never watched"; Tautulli
  exclusively held 294 in-library partial plays. Merge rule (`mergeWatchRows` in
  `lib/sync.ts`): one row per (user, item), `plays` = **max** (the sources count the same
  viewing differently, so summing double-counts), `last_watched` = later, `null`
  preserved rather than coerced to 0. One source failing keeps the other's rows; ALL
  configured sources failing throws, so the job goes red instead of reporting a green
  "0 rows". Powers the Browse **Watched** filter + the per-card watched badge (by you) and
  the Big Picture **never watched by anyone** metric. Indexed by user (`idx_watch_user`)
  and by item (`idx_watch_item`, for the by-anyone lookup). Never pruned - it is the union
  of every source that has ever run, which is why `clearWatchHistory()` is lossy while a
  source is down. UI watch surfaces gate on `isWatchAvailable()` (any source configured)
  **and** `watchHistoryExists()` - an empty table can't distinguish "nobody watched
  anything" from "not synced yet", and without the second check a freshly connected
  server reports its whole library as never-watched.
- `seerr_requests` - `(plex_user_id, rating_key)`; cached Seerr requests (refreshed
  by the `requests` job; badges/filters read this, not live Seerr). Also warmed
  for a single user on their **first login** via `syncSeerrRequestsForUser`, so
  "Requested by me" works without waiting for the daily job.
- `arr_items` - one row per matched media item with its Sonarr/Radarr metadata
  (`source`, `instance_id/name`, `arr_id`, `monitored`, `status`, `quality` +
  `quality_kind` file|profile, `root_folder`, `arr_size_bytes`, `tags` JSON,
  `folder_name` - the title's own *arr folder basename, part of the disk-orphan
  known-name set). Keyed
  by `rating_key`; replaced per-instance by the `arr` job - instances that failed
  a run keep their cached rows; instances removed from settings drop out next
  run. LEFT-JOINed by `queryLibrary`
  to power Browse's List view + quality/tag/monitored/status/size-mismatch filters.
- `arr_unmatched` - Sonarr/Radarr titles that matched no Plex item. ALL of them
  are recorded with a `downloaded` flag (`sizeOnDisk > 0`): downloaded ones are
  media on disk Plex can't see (the "In *arr, not in <server>" category +
  Match health count - `getArrUnmatched()` defaults to downloaded-only);
  fileless ones only feed the identityMismatch folder-name join.
  `on_disk`/`disk_size_bytes` are the disk reality check (NULL = not verified;
  written by verifyArrUnmatchedOnDisk after each arr sync + diskScan) - the
  "In *arr, not in <server>" table's On-disk column ("not found"/"empty" =
  stale *arr record). Replaced
  per-instance by the `arr` job (like
  `arr_items`); full list on the Problems page ("In *arr, not in <server>",
  largest-first with sizes); Settings -> Match health shows only summary counts +
  a link there. (`mediaMissingExternalIds()` reports the inverse:
  Plex items with no id of their kind AND no `guid_imdb`, which can never match.) Matched via
  `media_items.guid_tvdb`/`guid_tmdb` (indexed). `size_bytes` + `instance_id`
  (scopes the per-instance replace) + `folder_name` (disk-orphan known-name set -
  an *arr title invisible to the media server still occupies disk) + `path`
  (the full *arr-side folder path, shown as the category's Location cell) added
  via guarded `ALTER`s.
- `arr_conflicts` - *arr claim collisions: during the `arr` job the
  first record to claim a rating_key wins `arr_items`; each later claimant is
  recorded here (winner `first_*` cols + loser `source/instance_*` cols + the
  loser's `size_on_disk`). TWO flavors, distinguished by `getArrConflicts()`'s
  computed `sameInstance` flag: cross-instance (two instances manage one title -
  remove it from one) and SAME-instance (two titles of one instance resolve
  to one media item - usually a merged multi-part entry in Plex carrying both
  ids, e.g. a two-part film; the fix is splitting the item apart in Plex, and
  the UI badges it that way). Replaced per-instance like `arr_unmatched` (rows are
  scoped to the LOSER's `instance_id`; failed instances keep their rows). Only
  observable in a run where both claimants were fetched - transient, self-healing.
  Surfaced on the admin Problems page.
- `disk_orphans` - the `diskScan` job's results: top-level entries under mapped
  library paths that neither the media server nor Sonarr/Radarr account for
  (matched by NAME per root - absolute paths differ across containers). Rebuilt
  per-section per run; sections the scan skips (safety guard: mostly-unnamed
  items; unreadable root) keep their prior rows. `mtime` keys the size cache
  (unchanged orphans aren't re-walked); `size_skipped=1` marks circuit-breaker
  rows (most of a root looked orphaned -> suspect mapping -> sizing skipped).
  Surfaced as the Problems page "On disk, in neither" category.
- `settings` - key/value; secret values encrypted.
- `job_state` - one row per scheduled job (`recentlyAdded`/`library`/`sizes`/`watch`/
  `requests`/`arr`/`diskScan`/`backup`): last run/status/message/duration/result. Rows stuck at
  `running` (process killed mid-job) are flipped to `error` at boot by
  `startScheduler()` -> `resetInterruptedJobs()` - the persisted flag would
  otherwise gate that job out of the scheduler AND manual runs forever.
- `job_runs` - append-only run history (last ~100) for the admin activity log.
- `logs` - app-event log (`ts,level,source,message`, pruned to ~1000) for Settings -> Logs.
- `sync_state` - legacy single row (id=1); superseded by `job_state`, no longer read.

The shared id across Plex/Tautulli/Seerr is the Plex **ratingKey** (mutable
across Plex library rebuilds - treat as best-effort). Sonarr/Radarr instead match
on the **stable** external ids `guid_tvdb` (shows) / `guid_tmdb` (movies) / `guid_imdb`
(both - the extra axis), which Plex sync populates. Matching tries the primary id
(tvdb/tmdb) then falls back to **imdb** (`ArrRecord.imdbId`; both Sonarr & Radarr expose
`imdbId`) - so an item Plex only matched to IMDb still resolves. **A Plex item can carry
MULTIPLE ids of a kind** (e.g. a show merged across two TheTVDB entries), so
`extractGuids` keeps ALL of them as a CSV (`"376459,407505"`) and `ratingKeysByGuid`
splits it so an arr id matching ANY of them resolves. (`ratingKeysByGuid('imdb')` spans
both kinds; `tvdb`/`tmdb` stay kind-scoped.) Keeping only one would match
the wrong id and show the item as unmatched even though the right id is present. `extractGuids` also falls back to the legacy single-`guid` string
(`com.plexapp.agents.thetvdb://...`, `...imdb://tt...`) when the modern `Guid[]` array is absent.
`mediaMissingExternalIds` (the "can never match" count) treats an item as id-less only
when it has no tvdb/tmdb **and** no imdb.

## API routes

- **Auth is backend-aware** (`media_server_type`): Plex uses PIN OAuth; Jellyfin/Emby
  use username+password. `POST /api/auth/plex/pin` -> `{id, authUrl}`; `GET
  /api/auth/plex/check?id=` -> `{status: pending|authorized|denied, needsSetup, isAdmin}`
  (Plex; a denial carries `reason: setup_unfinished|no_server_access|not_enabled` from
  `denyReason`, and a failed plex.tv lookup is a 502 `plex_check_failed`, never a denial).
  `POST /api/auth/setup {type, url?}` - first-run only (403 once an admin exists):
  records the chosen server type, and for Jellyfin/Emby tests+stores the server URL.
  `POST /api/auth/login {username, password}` - Jellyfin/Emby credential login (a
  successful auth IS server access; first user bootstraps owner and their access token
  becomes the server read token). `POST /api/auth/logout` (clear this device's
  cookie; there is no sign-out-everywhere - an admin disabling the account is the
  revoke-all path); `GET /api/auth/me` (the user includes `tutorialDone`; the Keep page itself reads it
  server-side in `app/page.tsx`).
  `POST /api/tutorial` - mark this user's Keep-page tour finished/skipped (stops it
  auto-starting on every device; replay from the user menu never calls it). The Plex PIN create/poll endpoints
  (`/api/auth/plex/pin`, `/api/auth/plex/check`) and the credential
  `/api/auth/login` are per-IP rate-limited (`lib/rate-limit.ts`); login also
  buckets per-username + globally so `X-Forwarded-For` rotation can't bypass it.
- `GET /api/feed/random?limit=&section=&largest=1` -> home batch. Default (no
  params) = screen-fill mix across **all Plex libraries**, weighted toward big
  series with a guaranteed few movies. `section=<id>` limits to one Plex library;
  `largest=1` = biggest titles regardless of library/keep-eligibility
  (`remaining` is null). Categories are real Plex libraries - never hardcoded.
- `POST/DELETE /api/keep` `{ratingKey}` - toggle **this user's** keep. POST also
  clears their "don't care" + "OK to delete" (one transaction - the keep/skip/
  mark-delete POSTs each use an atomic `apply*` query, and all three 404 on an
  unknown OR tombstoned item via `getActiveMediaItem`); DELETE removes only
  their own keep (others' keeps stay, item remains protected).
- `POST/DELETE /api/skip` `{ratingKey}` - per-user single-item "don't care"
  toggle. POST also clears this user's keep + "OK to delete" (mutually exclusive).
- `POST/DELETE /api/mark-delete` `{ratingKey}` - per-user "OK to delete" toggle.
  POST is **gated** by `isRequestedByUser` (403 `not_requested` otherwise) and clears
  this user's keep + "don't care". Does not touch others' keeps.
- `POST /api/skip-batch` `{ratingKeys[]}` - per-user skip + fresh batch (keep-loop).
  Enforces the same exclusivity server-side (`applySkipBatch` clears the user's
  keep/OK-to-delete on the batch, drops unknown/tombstoned keys); non-array ->
  400 `bad_request`, >500 keys -> 400 `too_many_items`.
- `GET /api/library?sections=<id,id,...>&q=&sort=size|title|added|year|library|quality|tags|status|watched&dir=asc|desc&state=keptByMe,keptOther,dontcare,okDeleteMine,okDeleteAny,undecided&kept=all|kept|unkept&keptByMe=1&skip=all|skipped|unskipped&deleted=all|deletedByMe|deletedAny&watch=all|watched|unwatched|unwatchedAny|recent30|recent60|recent90|stale90&source=sonarr|radarr&instance=&tag=&quality=&monitored=monitored,unmonitored&requestedByMe=1&hideKept=&offset=` -
  browse/search; `sections` is a comma list of Plex library ids (omit = all,
  multi-select in the sidebar). Returns `kept` (anyone), per-user `keptByMe`,
  per-user `skipped`, per-user `watched`, per-user `requestedByMe` +
  `markedForDeleteByMe`, server-wide `markedForDeleteAny` (no identity),
  **and Sonarr/Radarr metadata** (`source`,
  `instanceName`, `monitored`, `status`, `quality`, `qualityKind`, `tags[]` - null
  when the title isn't arr-matched; powers Browse's List view + quality badge). The
  Browse UI exposes a **Status** filter as a **combinable checkbox dropdown** ->
  the `state=` param: a comma list of per-user decision buckets OR'd together
  (**empty = All**). Buckets: `keptByMe` (you keep it), `keptOther` (kept by
  someone else, not you), `dontcare` (your "don't care"), `undecided` (kept by
  nobody, and not your "don't care" or "OK to delete"; someone else's "OK to
  delete" does not exclude it), and - only when
  Seerr is connected - `okDeleteMine` / `okDeleteAny` (your / anyone's "OK to
  delete", the by-anyone view stays identity-free). Defaults to `state=undecided`
  (hides kept items and ones you've decided on). (The legacy single-select `kept`/`keptByMe`/
  `skip`/`deleted` params are still honored for back-compat but the Browse UI now
  drives `state`.) Also a **Grid/List** view toggle (remembered in
  `localStorage`; List adds
  click-to-sort column headers - all columns, sort persisted - and a poster column),
  - **only when watch data is available** (`isWatchAvailable() &&
  watchHistoryExists()`) - a **Watched** filter (`watch=`):
  watched/not-watched **by you**, **not watched by anyone** (`unwatchedAny`,
  server-wide), recency windows, `stale90`; - **only when Sonarr/Radarr is
  connected** - **multi-select** `source`/`instance`/`tag`/`quality`/`status`/
  `monitored` filters (each a comma-separated "any of"; empty = no filter; the
  quality dropdown groups values by resolution bucket with select-all), a **`match`**
  filter (`matched`/`unmatched` - In vs Not in Sonarr / Radarr), and a `sizeMismatch=1`
  toggle (Plex vs arr size diverges >10% AND >1 GB); and `requestedByMe` (Seerr).
  Items also carry `arrSizeBytes` + a computed `sizeMismatch` flag. (The arr
  multi-value filters restrict to arr-matched titles; `match`/`sizeMismatch` don't.)
- `GET /api/library/facets` -> `{instances,tags,qualities,statuses}` for the Browse
  arr filter dropdowns (from `arrFacets()`).
- `GET /api/search?q=&offset=` -> ranked results (exact>prefix>word>substring,
  multi-token AND), with kept + per-user skipped/watched/requestedByMe +
  markedForDeleteByMe/markedForDeleteAny flags (so search cards show the "OK to
  delete" control too). `GET /api/search/suggest?q=` -> top-8 typeahead.
- `GET /api/sections` -> managed libraries `[{id,title,kind,itemCount,sizeBytes}]`
  (nav rail Browse, Keep filters, Library, Big Picture).
- `GET /api/storage` -> per-filesystem free/total (`fs.statfs`) + per-library used
  size; `configured:false` until libraries are mapped to disk paths.
- `GET /api/overview` -> per-library, per-user keep breakdown + disk capacity, in
  one call (powers the Keep totals column and the Big Picture dashboard). Each
  library partitions its bytes/items into `kept` (protected - anyone keeps it),
  `dontcare` (not protected + this user skipped), and `undecided` (the rest);
  `keptByMe*` is a sub-count of kept. Also returns `unwatched*` (items NOBODY on the
  server has watched - the Big Picture "never watched" reclaim metric) plus
  `unwatchedKeptBytes`/`unwatchedKeptByMeBytes`/`unwatchedDontcareBytes`/
  `unwatchedUndecidedBytes` (the never-watched bytes split by keep bucket, so the
  metric can be drawn as a subset of the composition bar - surfacing e.g. kept
  titles nobody has watched), `storage` totals, `mediaUsedBytes`, summed `totals`,
  `watchAvailable` (bool - whether watch surfaces should render; a source is
  configured AND has synced rows), and - when Sonarr/Radarr
  is connected - `arr: true` + `qualityBreakdown` (`{byQuality[], notInArr}` -> the
  Big Picture "By quality" table; its `reclaimableBytes` field shows in the UI as
  "Not kept"); and - when Seerr is connected - `seerr: true` + `markedForDelete:
  {titles, bytes}` (the Big Picture "OK to delete" KPI). Backed by `librarySummary` +
  `arrQualitySummary`/`unmatchedMediaSummary` + `markedForDeleteSummary`.
- `GET /api/about` -> `{name, version, latest, updateAvailable, releaseUrl}` for the
  About panel (latest = newest GitHub release via `lib/version.ts`, cached ~6h;
  null when unknown/offline - never an error).
- `GET /api/openapi.json` - the OpenAPI spec (authored at repo-root
  `openapi.json`; keep it in sync when routes change). Rendered at `/api-docs`.
- `GET /api/stats?view=largest|reclaimable|unwatched|markedForDelete&offset=` - big
  picture + summary. `unwatched` = largest titles nobody has watched
  (`neverWatchedItems`; the "Never watched" drill-down, shown only when watch data
  is available - `watchAvailable` from /api/overview).
  `markedForDelete` = titles anyone marked "OK to delete", largest first,
  each with its marker name(s) + a `keptByAnyone` flag (`markedForDeleteItems`; the
  drill-down shown only when Seerr is connected - the one place marker identity is
  shown). Accepts a session user **or** the API key (`X-Api-Key`).
- `GET /api/requests` - current user's Seerr rating keys for badges, read from the
  `seerr_requests` cache (refreshed by the `requests` job, not live).
- `GET /api/image?path=&w=&h=` - proxies posters (token stays server-side); backend-aware
  (`path` = Plex relative thumb, or a Jellyfin/Emby item id -> `/Items/{id}/Images/Primary`).
- `GET /api/health` - public liveness probe (used by the Docker healthcheck).
- Admin (require `is_admin`): `GET/PUT /api/admin/settings` (PUT accepts
  `storageMappings`, `managedSectionIds`, `appTitle`, `appUrl`, `apiKey`, `plexBaseUrl`,
  `plexOwnerToken` (blank clears it; GET returns only `plex.ownerTokenSet`, never the value),
  and a changed `plexBaseUrl` is REFUSED with 400 `different_server` when probing
  `/identity` proves it is a different machine than `plex_machine_id` - the manual
  path only writes the URL, so the per-server `plex_server_token`/`plex_machine_id`
  would be left behind and wrong; switching servers must go through Discover &
  connect (which writes all three). Unreachable targets still save, since fixing
  the URL of a server that is down is legitimate,
  `jobSchedules`, `plexServer`, `tautulli`, `seerr`, `sonarrInstances`,
  `radarrInstances`, `backupRetention` - GET returns instances as `[{id,name,url,hasKey}]`, never their
  apiKeys; the automation `apiKey` IS returned so the UI can show a masked
  copy-able field, Servarr-style),
  `GET /api/admin/plex-servers`, `GET /api/admin/plex-scope` (whether the history
  token sees every account: `{applicable, configured, status, allUsers, message, usingOwnerToken}`),
  `POST /api/admin/plex-auth` (start a PIN) + `GET /api/admin/plex-auth?id=` (poll;
  on success replaces `plex_admin_token` and returns the account's `username`) -
  re-authenticate the STORED Plex token from Settings WITHOUT touching the session.
  The admin token otherwise comes from the Owner's (installer's) Plex sign-in and is
  refreshed each time they sign in; if that person doesn't own the Plex server, Discover lists nothing they
  own and only the owner can read all users' watch history, with no in-app fix. `POST /api/admin/test-connection` (services
  `plex`/`plexOwner`/`jellyfin`/`emby`/`tautulli`/`seerr`/`sonarr`/`radarr` -
  `plexOwner` runs `plexHistoryScope()`, which reports how many ACCOUNTS the
  token can see rather than mere reachability),
  `POST /api/admin/sync-libraries` (discover sections only, fast - backend-agnostic
  via `getBackend().listSections()`),
  `GET /api/admin/storage-check?path=`, `GET /api/admin/jobs` (status + recent runs)
  + `POST /api/admin/jobs {job}` (trigger one/`all`) - both also accept `X-Api-Key`,
  `GET /api/admin/logs?level=&q=&limit=` (keyword search over message+source;
  limit <= 1000 for the .txt export) + `DELETE /api/admin/logs`,
  `GET /api/admin/cache` + `POST /api/admin/cache {target:images|requests|watch|arr}`
  (`arr` clears both `arr_items` + `arr_unmatched`),
  `GET /api/admin/health` (`{issues: HealthIssue[]}` - standing warnings from
  `lib/health.ts`; AppShell's warning chip + the Jobs-tab Health card; each issue's
  `docSlug` -> a README "Health checks" anchor),
  `GET /api/admin/backups` (list) + `POST {action:'create'|'restore', name?}` +
  `DELETE {name}` + `GET /api/admin/backups/download?name=` (backup names are
  strictly validated - `keeparr[-pre-restore]-YYYYMMDD-HHmmss[-n].db` only),
  `GET /api/admin/arr-health` (`{matched, unmatched[], missing, arrJob}` - Match
  health panel; `unmatched[]` = titles DOWNLOADED in *arr but not in Plex, with
  `sizeBytes`, largest-first),
  `GET /api/admin/problems/summary` (`{arrConfigured, serverType, categories[]}` -
  `serverType` lets the UI name the connected media server in labels; the Problems
  page pill strip: per-category `{type, available, reason?, titles, bytes}` in
  display order; arr-gated categories are `available:false` zeroed without
  Sonarr/Radarr, `notInArr` also waits for `arrMatchedCount() > 0`, and
  `diskOrphans` needs storage mappings + a completed diskScan run - until then
  `available:false` with `reason: storage_not_configured|not_scanned`, which the
  UI renders as a dimmed pill with a fix-it tooltip) +
  `GET /api/admin/problems?type=&offset=&includeMissingIds=&sort=&dir=&sections=&kind=`
  (paged list for one category - `notInArr` hides titles with no external id by
  DEFAULT (they can never match *arr and have their own missingIds category; the
  pill count matches via `unmatchedMediaSummary(true)`), `includeMissingIds=1`
  opts back in; `sort`/`dir` per-category allow-lists (unknown -> default order;
  SQL categories via `problemOrder`, JS-sliced via route comparators),
  `sections` (comma library ids) + `kind` (movie|show) filter where rows are
  media items (duplicates keep groups with ANY matching member; missingFromPlex
  filters kind via extKind; diskOrphans sections only; arrConflicts none);
  categories:
  `sizeMismatch|notInArr|missingFromPlex|identityMismatch|duplicates|arrConflicts|`
  `zeroSize|removedButKept|missingIds|diskOrphans`; NO default view:
  missing/unknown type
  -> 400 `unknown_type`, arr-gated type without arr -> 400 `arr_not_configured`,
  `diskOrphans` without mappings -> 400 `storage_not_configured`; returns
  `{type, items, hasMore, nextOffset}`, item shape varies per category -
  `duplicates` items are groups, `identityMismatch` items pair `{media, arr}`
  claims on one folder, `diskOrphans` items are filesystem entries
  `{name, sectionId, path, isDir, sizeBytes, sizeSkipped, likely}` (`likely` =
  the library title the orphan looks like - usually a leftover copy);
  diagnosis fields: `sizeMismatch` rows carry `diskSizeBytes/diskCheckedAt`
  (measured tiebreaker) + `fileCount` (movies; >1 = merged multi-part item, the
  mismatch is by design -> badge "likely fine"), `missingFromPlex` rows carry
  `onDisk/diskSizeBytes`
  (reality check) + `claimedByTitle`, `notInArr` rows carry `identityArrTitle`
  (both = "this row is half of an identity-mismatch pair - fix the match
  there"), `identityMismatch` rows carry the media side's own
  `guidTmdb/guidTvdb/guidImdb` (rendered beside the *arr's id so the
  disagreement is visible), `arrConflicts` rows carry `sameInstance` (+
  `instanceId` on winner/loser; true = two titles of ONE instance resolve to
  one item - merged multi-part entry -> badge "split apart in Plex"),
  `zeroSize` rows carry `arrBytes/instanceName` (*arr context: the
  server sees no files but the *arr has N GB). Every table's last column is a
  **"What to do" ActionBadge** (client-derived from these fields; amber = fix
  needed, slate = informational/judgment). Zero-size items are EXCLUDED from
  sizeMismatch (SIZE_MISMATCH_EXPR requires size_bytes > 0 - affects the
  Browse filter identically, by design); they carry their diagnosis in
  zeroSize instead. Categories are ordered/grouped into three families
  (server<->*arr / within-server / on-disk; PILL_GROUPS in ProblemsView renders
  labeled clusters); media-item rows
  carry `dirPath` (full server-side folder path; `path` on missingFromPlex) ->
  the UI's Location cells: tail display, full path on hover, click-to-copy,
  and duplicates dim the group's common prefix so the differing folder pops),
  `GET/PUT /api/admin/users` (list + grant/revoke admin + enable/disable + the
  `openSignin` toggle; Owner can't be demoted or disabled),
  `POST /api/admin/users/import` (import the Plex shared-user list).

## Settings keys (all via `lib/settings.ts`)

`media_server_type` (`'plex'|'jellyfin'|'emby'`; **defaults to `'plex'`** when unset, so
existing installs are unchanged - chosen once at first-run setup), `media_device_id`
(stable id for the Jellyfin/Emby MediaBrowser auth header). Per-backend connection keys
resolve through type-aware accessors (`getServerBaseUrl/Token/Name/Id`, `getOwnerId`,
`getAdminToken`, `isServerConfigured`): Plex keeps its historical names -
`plex_client_id`, `plex_owner_id`, `plex_admin_token`*, `plex_machine_id`,
`plex_base_url`, `plex_server_token`*, `plex_server_name`, `plex_owner_token`*
(OPTIONAL server-owner token; see below); Jellyfin/Emby use a uniform
scheme - `<type>_url`, `<type>_token`*, `<type>_admin_token`*, `<type>_server_id`,
`<type>_server_name`, `<type>_owner_id` (`<type>` = `jellyfin`|`emby`). `plex_sections` (json;
includes each section's `paths[]`; reused for all backends), `tautulli_url`, `tautulli_api_key`*,
`seerr_url`, `seerr_api_key`*, `sonarr_instances`*, `radarr_instances`* (json
arrays of `{id,name,url,apiKey}` - N instances each; the whole blob is encrypted),
`job_schedules` (json per job: `{type:'interval',minutes}`,
`{type:'daily',hour,minute}`, or `{type:'weekly',weekday,hour,minute}`; replaced
the legacy single `sync_interval_minutes`, which is no longer read),
`storage_mappings` (json `{sectionId,path}[]` - container paths for free-space
measurement), `managed_section_ids` (json; which libraries Keeparr tracks, empty =
all), `open_signin` (`'true'`/`'false'`), `api_key`* (automation), `app_title`,
`app_url` (Plex sign-in forwardUrl; overrides the `APP_URL` env var),
`backup_retention` (how many backup files to keep; default 14),
`dev_storage_total` (demo-only synthetic capacity, set by the seed). `*` = encrypted
at rest.

**Three local modes.** Pick by what you need to exercise; the first two are fake and
the third is real, and mixing them up is why connection bugs used to reach production.

1. **Fake demo** - `npm run seed` (`lib/dev-seed.ts` + `scripts/seed.mts`) fills
   `./data` with fake libraries; `KEEPARR_DEV_LOGIN=1` makes `middleware.ts` auto-mint
   a dev session (no Plex/login). Best for UI work. NOTHING that talks to a server
   works here: the seeded token is fake, so the Plex "Test" button fails with an
   HTML-not-JSON error and Discover finds nothing. That is expected, not a bug.
2. **Seeded demo wired to a REAL Plex** - keeps the fake media so pages are populated,
   but points the connection at your server so Discover, the Test buttons, the owner
   token and the watch job all do real work:
   ```
   DATA_DIR=./data-realseed    KEEPARR_DEV_PLEX_URL=http://<ip>:32400    KEEPARR_DEV_PLEX_TOKEN=<X-Plex-Token> npm run seed
   DATA_DIR=./data-realseed KEEPARR_DEV_LOGIN=1 npx next dev -p 3112
   ```
   Writes the token to `plex_server_token`, `plex_admin_token` (so Discover works -
   it is a plex.tv call) and `plex_owner_token`. Use the SERVER OWNER's token or
   watch history silently covers one account. A real library scan replaces the fake
   media.
3. **True first-run** - `npm run dev:real` (`scripts/dev-real.mts`). Separate
   `DATA_DIR` (default `./data-real`), no seed, and deliberately NO
   `KEEPARR_DEV_LOGIN`, so `/` redirects to `/login` and you get the genuine
   setup -> Plex PIN OAuth -> Discover & connect -> run jobs path. This is the only
   way to test **login** without deploying. `KEEPARR_DEV_SERVER=jellyfin|emby npm run seed` configures
the demo as that backend (fake connection) instead of Plex, so the setup/login branch +
backend-aware UI are clickable offline (default = Plex). All inert/absent in production.

## Auth / access control

- **Backend is selectable** (`media_server_type`, default `'plex'`). The login page
  (`app/login/page.tsx` server component -> `LoginClient`) reads the type and renders the
  right flow; a server-type chooser appears only on a brand-new install (no type chosen +
  no admin). `decideAccess` (`lib/login.ts`) is backend-agnostic - it only takes booleans.
- **Plex** - PIN OAuth: create pin -> user authorizes at app.plex.tv -> poll -> token ->
  identity (`/api/v2/user`) -> `decideAccess`. Other users have access when the server's
  `plex_machine_id` is among THEIR OWN `/api/v2/resources` (`getResources` +
  `hasServerResource`, called with the signing-in user's token). Never decide this from
  the admin token's `plex.tv/api/users`: that lists only the token holder's own shares, so
  when Keeparr was set up by a shared user rather than the server owner, every other user
  is missing from it.
- **Jellyfin/Emby** - credential login (`/api/auth/login` -> `authenticateByName`): a
  successful auth IS server access (no shared-user list). The first-run flow collects the
  server URL via `/api/auth/setup` (bootstrap-only) before login; the bootstrap admin's
  access token becomes the server read token.
- First-ever login = **bootstrap_admin** (claims admin, stores owner id + token; for Plex
  must then connect a server). Owner is always allowed.
- Admin is **binary** (`users.is_admin`). Shared users log in with `is_admin=0`;
  any admin can promote/revoke others from the Users screen via `setUserAdmin`
  (the explicit counterpart to `upsertUser`, whose `MAX(is_admin, ...)` only raises).
  The Owner (`plex_owner_id`) can never be demoted. There are **no local accounts**:
  media-server login only, no self-registration.
- **Sign-in gate**: `open_signin` (default on) lets any shared-server user in. When
  off, `decideAccess` admits non-owners only if they're `userKnown && userEnabled`
  (use **Import users from Plex** to pre-create accounts, then toggle Enabled; import
  reads `plex.tv/api/users`, which only the server owner's token answers fully, so it
  prefers `plex_owner_token` and falls back to `plex_admin_token`).
  `getSessionUser` returns null for a disabled non-owner, so blocking takes effect
  immediately. The Owner is always allowed/enabled.
- **Security posture** (audited July 2026, hardened for CA listing): all SQL is
  parameterized (`lib/queries.ts`), every `/api/admin/*` route calls `requireAdmin`,
  secrets are AES-GCM encrypted at rest (`lib/crypto.ts` `SECRET_KEYS`). Hardening in
  place: the image proxy **requires auth** (`requireUserOrApiKey` - middleware's
  `X-Api-Key` passthrough only DEFERS validation, so every `/api/` route must guard
  itself) and validates `path` against an SSRF allowlist (`lib/image-path.ts
  isSafeImagePath` - Plex must be `/library/...`, no `://`/`..`; JF/Emby an opaque id),
  clamps `w`/`h`, and only serves `image/*`; `/api/auth/login` (Jellyfin/Emby creds) is
  rate-limited per IP **and per-username + globally** so `X-Forwarded-For` rotation
  can't bypass it (`lib/rate-limit.ts`), and the Plex PIN create/poll endpoints are
  per-IP capped; `/api/auth/setup` rejects non-http(s) URLs before its pre-auth probe;
  session tokens carry a per-user `session_epoch` so admin-disable revokes
  outstanding tokens; all outbound `fetch`es have a 15s timeout;
  the API-key and session-signature compares are constant-time (`safeEqual`);
  `errorResponse` 500 bodies are bare `{error:'internal_error'}` (the raw
  exception text is logged, never sent - it can leak paths/hosts) and a
  malformed JSON body returns 400 `invalid_json`, not a 500;
  `instrumentation.ts` **fails closed** (throws) on a production boot with a missing/
  default `SESSION_SECRET` and warns on a short one. The Docker image runs the app as a
  non-root `PUID:PGID` (root only chowns `/data`, then drops via `su-exec`), strips
  npm/yarn/corepack from the runtime stage, pins the base image by digest, and `npm
  audit` is clean (postcss pinned via an `overrides` entry). CI/release pin every
  GitHub Action to a commit SHA (Dependabot keeps them fresh). Baseline response headers
  set in `next.config.js` (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, CSP `frame-ancestors 'self'`) - deliberately NO strict
  script/style CSP (would break the inline theme script + Scalar). Backup filenames
  are regex-validated (`isValidBackupName`); the image cache key is SHA-1-hashed before
  becoming a path. `KEEPARR_DEV_LOGIN` is the only auth bypass and is env-gated +
  `NODE_ENV`-guarded + inert in production (never set it in the image).
- **API key** (`api_key`): `requireAdminOrApiKey`/`requireUserOrApiKey` (`lib/auth.ts`)
  accept an `X-Api-Key` header as an alternative to a session (for `/api/admin/jobs`
  + `/api/stats`). `middleware.ts` lets `/api/` requests carrying that header past the
  edge session gate; the Node route validates the key.
- `plex_admin_token` (from the Owner's sign-in or a Settings re-auth, whichever
  came last) is used for server discovery (and the user import when no owner token is
  set). PMS reads use `plex_server_token`; play history and the user import prefer
  `plex_owner_token` when set.

## External API notes (verified against Overseerr / python-plexapi / Tautulli)

- **Plex size on disk**: `MediaContainer.Metadata[].Media[].Part[].size` (bytes).
  Movies inline; series via `GET /library/metadata/{ratingKey}/allLeaves` summed
  over all episodes. Helpers: `sumPartSizes`, `sumLeafSizes`. `sumLeafSizes`
  dedupes by `Part.file`/`Part.id` so a **multi-episode file** (one file shared by
  several episode leaves - Plex reports the full size on each) is counted once,
  not once per episode.
- **Plex PIN**: `POST plex.tv/api/v2/pins?strong=true`, auth at
  `app.plex.tv/auth#?clientID=&code=&context[device][product]=`, poll
  `GET plex.tv/api/v2/pins/{id}` until `authToken`. Reuse a stable
  `X-Plex-Client-Identifier` (persisted as `plex_client_id`).
- **Jellyfin / Emby** (MediaBrowser API, verified against Seerr's `jellyfin.ts`): auth
  `POST /Users/AuthenticateByName {Username,Pw}` with the `MediaBrowser Client=...,
  Device=..., DeviceId=..., Version=...[, Token=...]` header (sent on both `Authorization` and
  `X-Emby-Authorization`; device id persisted as `media_device_id`) -> `{AccessToken,
  User:{Id,Name,Policy.IsAdministrator}}`. Libraries `GET /Library/MediaFolders`
  (CollectionType movies->movie, tvshows->show). Items `GET /Items?Recursive=true&
  IncludeItemTypes=Movie|Series&ParentId=&fields=ProviderIds,MediaSources,DateCreated`
  (paged via StartIndex/Limit + TotalRecordCount). Series size = `GET
  /Items?ParentId={id}&Recursive=true&IncludeItemTypes=Episode&fields=MediaSources`,
  summing `MediaSources[].Size` deduped by `Path` (multi-episode files). ALL
  /Items reads page (watch history + episode reads too, via `fetchAllPages`) -
  a flat `Limit` silently truncates large sets. Size on disk =
  `MediaSources[].Size`; ids = `ProviderIds.{Tmdb,Tvdb}` -> `guid_tmdb/guid_tvdb`; added =
  `DateCreated`; poster = `GET /Items/{id}/Images/Primary?fillWidth=&fillHeight=&api_key=`.
  Emby is the same API (the client sends identical requests to both). Unverified against a
  live server - built to the documented API + Seerr's client.
- **Plex play history** (the deep watch source, `metadata_item_views` over HTTP):
  `GET /status/sessions/history/all` with the server OWNER's token returns every account's
  history - on the live server over 100k rows across ~90 accounts back to 2022-03-26,
  a full pull in under 10s. Three traps, all verified against a live PMS:
  (1) **paging needs BOTH `X-Plex-Container-Start` and `X-Plex-Container-Size`** -
  Size alone is silently ignored and the whole history comes back in one response;
  (2) **there is no `grandparentRatingKey`** - an episode's series id must be parsed
  out of `grandparentKey` (`/library/metadata/24186`), and rows for deleted media
  lose `ratingKey`/`grandparentKey` entirely (a few percent - skip them);
  (3) **the owner is `accountID: 1`**, PMS's local account id, while shared users
  appear under their plex.tv id. Resolve that person with `plexOwnerLogin()`
  (`/myplex/account`, returns their EMAIL) + `findUserIdByLogin()` - do NOT use
  `getOwnerId()`, which names whoever set Keeparr up and is often a DIFFERENT
  person; using it files the server owner's viewing under the wrong user.
  Unresolvable => don't remap (under-attribution beats mis-attribution).
  `viewedAt>=<ts>` filtering works (`viewedAt>` is a 400) but is unused: a full
  pull is cheap.
  **THE BIG ONE - history is scoped to the token holder.** Plex returns every
  account's history ONLY to the server owner's token; for anyone else it returns
  just their own rows, **silently** - HTTP 200, and an `accountID=` filter for
  another user is IGNORED rather than refused (`/accounts` 403s though). A
  shared-user token therefore yields a plausible-looking but tiny result. Measured
  on a live server: the owner token sees all ~90 accounts (over 100k rows), a
  shared-user token sees 1 account (its own ~16k rows). Hence the optional `plex_owner_token` setting, which
  `plexBackend.getWatchData()` prefers over `plex_server_token` for history only
  (ordinary PMS reads still use the server token, so a bad/absent owner token
  cannot regress anything). `plexHistoryScope()` is the Settings "Test" for it -
  it counts distinct accounts, because reachability alone cannot detect this.
- **Tautulli**: `GET {url}/api/v2?apikey=&cmd=&out_type=json`; envelope
  `response.{result,message,data}`. `get_history` rows are at
  `response.data.data[]` (object); aggregate by `grandparent_rating_key`
  (episodes) / `rating_key` (movies).
- **Seerr**: base `/api/v1`, header `X-Api-Key`. Match the user to a Seerr user by
  email / plex / jellyfin username, then read `/user/{id}/requests`. Both `/user`
  and `/user/{id}/requests` are paged via `take`/`skip` (`seerrGetPaged`) - a
  single `take=200` drops users/requests past the first page. On Plex,
  `media.ratingKey` IS the rating key (direct join); on Jellyfin/Emby that isn't our
  item id, so we match the request's `media.tmdbId` (movies) / `tvdbId` (tv) to
  `media_items.guid_tmdb`/`guid_tvdb` via `ratingKeysByGuid`.
- **Sonarr/Radarr** (v3): base `{url}/api/v3`, header `X-Api-Key`. `GET /series`
  (`tvdbId`, `imdbId`, `monitored`, `status`, `qualityProfileId`, `statistics.sizeOnDisk`,
  `tags:number[]`) / `GET /movie` (`tmdbId`, `imdbId`, `monitored`, `status`, `sizeOnDisk`,
  `movieFile.quality.quality.name`, `tags:number[]`); resolve `tags`/profiles via
  `GET /tag` + `GET /qualityprofile`; `GET /system/status` for the Test button.
  Match `tvdbId->guid_tvdb` (shows) / `tmdbId->guid_tmdb` (movies), falling back to
  `imdbId->guid_imdb`. Series quality is the profile name (target); movie quality is the
  actual file quality.

A fuller source-verified reference is in the planning doc
`~/.claude/plans/alright-this-is-a-mighty-brooks-agent-*.md`.

## Conventions

- **Theming is CSS-variable-driven**: every used color family (slate ladder,
  brand, app/rail/panel surfaces, status hues) resolves through `--c-*`
  variables (`tailwind.config.ts` -> `rgb(var(--c-...) / <alpha-value>)`), with
  the palettes in `app/globals.css` - `:root`/`[data-theme='dark']` (canonical,
  stock Tailwind values), `[data-theme='light']` (inverted slate ladder), and
  `[data-cim='1']` (color-impaired remap of rose/emerald/red only). A new
  color+shade needs a variable in every theme block. `data-theme`/`data-cim`
  are stamped on `<html>` pre-paint by the inline script in `app/layout.tsx`
  (localStorage `keeparr.theme` = auto|light|dark, `keeparr.colorImpaired`);
  `components/ThemeMenu.tsx` (in the AppShell user menu) edits them live.
  Two NON-themed constants: `ink` (dark text on brand-amber buttons/badges)
  and `paper` (true white on saturated badges over posters) - use these, not
  `text-slate-900`/`text-white`, when the surface doesn't change with theme.
- Plex-amber accent (`brand` in `tailwind.config.ts`).
- **Toasts**: `components/Toaster.tsx` - `ToastProvider` mounts once in
  AppShell; `useToast()(msg, 'info'|'success'|'error')` anywhere below it
  (no-op fallback without a provider, so hooks stay test-safe). Used for
  silent-failure paths (keep/skip/delete revert, feed/library/search/stats load
  errors + a failed Keep batch, job/backup actions); settings panels keep their
  inline `msg` text (success shown only after `res.ok`).
- **Dates in lists**: `formatRelative(unixSec)` from `lib/format.ts` as the
  visible text with the absolute `toLocaleString()` in `title` (hover).
- `lib/clipboard.ts copyText()` for all copy-to-clipboard (has the
  plain-HTTP fallback).
- **PWA**: `app/manifest.ts` (dynamic, uses `getAppTitle()`); icons in
  `public/icons/` are generated from `app/icon.svg` by
  `npx tsx scripts/gen-icons.mts` (rerun only when the logo changes). The
  manifest + `/icons/` are public in `middleware.ts` (credential-less fetch).
- **Keyboard**: global keys live in AppShell (`?` overlay, `/` focuses
  `#global-search`); add new shortcuts there + list them in
  `components/ShortcutsOverlay.tsx`. The Tour captures keys while open so
  these don't fire under it.
- **Guided tour**: a new Keep-screen element worth explaining gets a
  `data-tour="..."` attribute plus a step in `lib/tour.ts`. The tour auto-runs
  once per account (`users.tutorial_done_at`), and `/?tour=1` replays it (the user
  menu's "Show the tour"). A step whose target isn't rendered is skipped, so
  conditional UI (no Seerr -> no "OK to delete", totals hidden below `lg`) needs
  no special handling. When the tour starts, KeepView reorders the loaded batch
  (`arrangeForTour`: a watched title first, an "OK to delete" title second) and
  renders it BEFORE opening the Tour, which picks its steps from the DOM at open.
  The popup shows a real `WatchedBadge` (exported from MediaCard) so people
  know the eye even when nothing on screen is watched. A step with a
  `fallback` (the OK-to-delete step) hands its hint to another step when it
  can't run, so people with no requests still see a copy of that button
  (`DELETE_BTN_IDLE_CLASS` keeps the copy styled like the real one). Popup text must use
  themed shades: slate 200-950 only (`slate-100`/`50` have no light-theme value
  and vanish on the white popup).
- Server components guard admin pages and pass to client components that fetch
  their own data.
- Optimistic UI for keep toggles (revert on failure; any in-flight
  keep/skip/delete blocks the other two - the states are mutually exclusive, so
  interleaved requests would desync UI from server).
- **List fetchers guard against stale responses** with a per-component `useRef`
  sequence counter: capture `++seq` at fetch start; once superseded, drop the
  response (including its toast and `setLoading(false)`). See LibraryBrowser /
  SearchResults / StatsView / KeepView / SearchBox - new fetchers follow suit.
- Refresh work is split into scheduled jobs (`lib/jobs.ts`): `recentlyAdded` (cheap,
  newest items only), `library` (full inventory + movie sizes + new-show sizing),
  `sizes` (expensive per-series `getAllLeaves` recompute; also backfills show
  `dir_path` derived from episode paths), `watch` (server history + Tautulli, merged),
  `requests` (Seerr cache), `arr` (Sonarr/Radarr quality+tags cache), `diskScan`
  (disk-orphan scan over the mapped library paths, `lib/diskscan.ts` - gated in
  `lib/health.ts jobRelevant` on storage mappings existing), `backup`
  (db snapshot + retention prune, `lib/backup.ts`). Each is
  single-flight per `job_state`, fire-and-forget from `/api/admin/jobs`, auto-run by
  `lib/scheduler.ts` on its `job_schedules` entry (`isDue`: every N minutes/hours, daily
  at a local HH:MM, or weekly on a local weekday at HH:MM). Defaults in `config.ts` (`DEFAULT_JOB_SCHEDULES`): recentlyAdded
  5 min; library 03:00; watch 04:00; requests 05:00; sizes 06:00; arr 07:00;
  backup 08:00; diskScan weekly Sunday 09:00.
- **Releases + images (continuous delivery)**: every push to `main` ships one
  release via `.github/workflows/release.yml`: test (tsc + vitest + `next
  build`) -> **version** -> build (native amd64 + arm64, no QEMU) -> publish
  `ghcr.io/drohack/keeparr:{latest,X.Y.Z,X.Y}` + a GitHub release. The
  **version** job auto-increments the PATCH unless you bumped `package.json`
  yourself: if `v<package.json version>` is already a tag it bumps (patch by
  default; minor/major via the `workflow_dispatch` `bump` input), else it uses
  your version as-is (manual override). Any bump is written back to main as a
  `[skip ci]` commit; GITHUB_TOKEN commits don't retrigger, so no loop. So: to
  cut a normal release just push to main; for a minor/major, bump
  `package.json` in your commit (or run the workflow manually with a bump
  level). `ci.yml` only validates PRs now (no image). The update check compares
  `package.json` to the newest GitHub Release. Tests are NOT in
  the Dockerfile (hoisted to CI); the Dockerfile must copy `public/`
  explicitly (standalone output omits it). `docker-entrypoint.sh`
  auto-generates SESSION_SECRET into `$DATA_DIR/.session-secret` when the env
  var is unset (env wins; it runs BEFORE node so the Edge middleware sees the
  same process.env - never move this into app code, Edge can't read files).
  The entrypoint runs as **root** (no `USER` line in the Dockerfile) solely to
  `chown -R $PUID:$PGID $DATA_DIR` (default `1001:1001`, Unraid `99:100`) - fixing
  a fresh root-owned bind mount - then drops privileges via `su-exec` before
  exec'ing node; the chown happens AFTER secret generation so `.session-secret`
  is re-owned and stays readable post-drop. Shell scripts are forced LF via
  .gitattributes (CRLF breaks alpine sh).
  Unraid users install via the
  Community Applications template (github.com/drohack/unraid-templates,
  `keeparr.xml`) - keep its port/paths/vars in sync with the Dockerfile when
  they change.
- ROADMAP.md tracks the researched platform-feature tiers: Tiers 1 (health/
  update/backups/API docs, v0.2.0) and 2 (themes/toasts/logs/PWA/shortcuts,
  v0.3.0) are done; Tier 3 is deliberately parked - don't build those without
  the user asking.
