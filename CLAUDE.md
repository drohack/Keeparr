# CLAUDE.md — Keeparr contributor guide

Keep this file and README.md in sync when you change behavior, schema, routes,
or settings keys.

## What Keeparr is

Plex-login web app for deciding what media to **keep** and reporting what can be
deleted. Tag + report only — **never deletes**. Keep is **per-user** but
protective: an item is kept (safe) if **anyone** keeps it, and you can only
remove **your own** keep. Per user the states are **mutually exclusive**:
none / keep / "don't care" / **"OK to delete"** — the last is the original Seerr
requester signing off ("I'm done with it"), offered **only on items that user
requested** and **only when Seerr is connected**. "OK to delete" does NOT override
anyone else's keep (a marked item stays protected while someone keeps it); it's
surfaced on Big Picture (with who marked it) and filterable on Browse (by you / by
anyone — the by-anyone view never reveals who). "Don't care" ("skip the rest") is
per-user. See README.md for the feature overview.

## Canonical rules

- **Categories are the user's actual Plex libraries — never hardcode "Movies /
  TV / Anime".** Everyone's library setup differs; the feed filters and library
  sidebar are driven by `getPlexSections()` (section ids). `library_kind`
  (movie/show) is Plex's own section type and may be used internally (e.g. to seed
  some movies into the mixed feed), but it is not a user-facing taxonomy.
- All SQL lives in `lib/queries.ts`. Don't write SQL elsewhere.
- All external HTTP lives in `lib/plex.ts`, `lib/tautulli.ts`, `lib/seerr.ts`,
  `lib/arr.ts` (all built on `lib/http.ts` `fetchJson`).
- All settings access goes through `lib/settings.ts` (typed getters; secrets are
  encrypted via `lib/crypto.ts`). Never read raw setting keys in routes.
- Route handlers are thin: auth-guard → call lib → return JSON. Use
  `requireUser` / `requireAdmin` from `lib/auth.ts` and `errorResponse` from
  `lib/route-helpers.ts`.
- Every route handler that touches SQLite/native code sets
  `export const runtime = 'nodejs'`.
- `lib/session.ts` must stay Edge-safe (Web Crypto only) — it's used by
  `middleware.ts`. No `node:` imports there.
- Tests use a real in-memory SQLite (`__setTestDbToMemory()`), never mocks for
  storage. Route tests mock only `next/headers` (the cookie jar).
- The size unit on cards is `x.xx GB` via `formatGB` in `lib/format.ts`. Library/
  storage aggregates (sidebar sizes, the storage header) use `formatSize`, which
  auto-switches GB↔TB at 2 decimals.

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
  login.ts           pure access-control decision (decideAccess) — unit tested
  plex.ts            plex.tv OAuth + PMS read API + size summation helpers
  jellyfin.ts        Jellyfin/Emby client (MediaBrowser API): auth + server info +
                     users (+ library/item/watch reads added in later phases)
  tautulli.ts        watch-history client
  seerr.ts           requests client
  arr.ts             Sonarr/Radarr v3 client (shared) + pure normalize fns (fetchSonarr/fetchRadarr/testArr)
  quality.ts         pure resolutionBucket()/RES_ORDER (shared by Browse + Big Picture quality grouping)
  version.ts         update check vs GitHub Releases (compareSemver + getVersionInfo,
                     in-memory ~6h cache, never throws — /api/about + health check)
  health.ts          healthIssues(): standing admin warnings derived from job_state/
                     settings/version cache (no live probes); each has a docSlug →
                     README anchor
  backup.ts          SQLite backup/restore: createBackup (online db.backup), list/
                     delete/prune (retention), restoreBackup (pre-restore snapshot →
                     closeDbForSwap → copy → reopen+migrate); files in DATA_DIR/backups
  mediaserver/       backend read seam: types.ts (MediaBackend interface + BackendSection/
                     BackendItem), plex.ts (adapter over lib/plex), jellyfin.ts (adapter over
                     lib/jellyfin; serves Jellyfin AND Emby), index.ts getBackend() factory
                     (by media_server_type). The sync engine reads through this, never a
                     backend directly.
  sync.ts            job runners (backend-agnostic via getBackend()): syncRecentlyAdded /
                     syncLibrary / syncSizes / syncWatchHistory / syncSeerrRequests / syncArr
                     (+ syncSeerrRequestsForUser: warm one user's request cache on first login)
  jobs.ts            job registry + runJob/runWithState (single-flight) + isDue/dueJobs
  scheduler.ts       per-job scheduler (interval or daily HH:MM); fires due jobs each minute
  cards.ts           MediaItem → MediaCardData (+ proxied poster URL)
  storage.ts         fs.statfs free/total per filesystem (Node-only); dedupes mounts
  cache.ts           on-disk poster cache (read/write/clear/stats) — Node-only
  route-helpers.ts   errorResponse
app/
  login/             Plex PIN login (popup + poll)
  page.tsx           home: AppShell → KeepView (no-scroll single-screen)
  library/           AppShell → LibraryBrowser (Browse; Grid/List view toggle, library
                     selection via rail, + Sonarr/Radarr quality/tag/monitored filters)
  search/            AppShell → SearchResults
  stats/             AppShell → StatsView (full-width dashboard)
  api-docs/          interactive API reference (Scalar over /api/openapi.json;
                     session-gated server component + client dynamic import)
  settings/<tab>/    admin Settings sub-tabs: general, users, connections, libraries,
                     jobs, logs, about (+ /settings → general). admin/* → redirects.
  api/...            route handlers (see below)
components/          AppShell (rail + top bar + user menu), MediaCard (grid), MediaRow
                     (Browse List view), MultiSelect (grouped checkbox-dropdown filter),
                     useKeepState (shared keep/skip hook), KeepView,
                     LibraryBrowser, StatsView, UsersManager, SearchBox, SearchResults;
                     breakdown.tsx (shared keep/reclaim visual language: StackedBar,
                       Donut, LegendRow + the TONE palette — used by KeepView's totals
                       column and the StatsView dashboard);
                     settings/ (SettingsLayout + General/Users/Connections/JobsCache/Logs/About panels;
                       managed libraries + storage + Sonarr/Radarr instances + MatchHealthCard live
                       inside the Connections panel)
```

The chrome is a Sonarr/Radarr-style left rail (logo → Keep; Keep / Browse[expand
→ libraries] / Big Picture / Settings) + a top bar (search + user menu). `AppShell`
(client) wraps every page; the Keep page renders inside it with no page scroll.

## Database schema (`lib/db.ts`)

- `media_items` — one row per **series or movie** (no episodes). `size_bytes` is
  the summed total. Tombstoned with `removed=1` when gone from Plex.
- `keeps` — per-user keeps. PK `(plex_user_id, rating_key)`; index on
  `rating_key`. An item is protected if **any** row exists for it; each user
  manages only their own keep. (Was a single global row per item; `migrate()`
  rebuilds the legacy table, carrying `kept_by` → `plex_user_id`.)
- `user_skips` — `(plex_user_id, rating_key)`; per-user "don't care". Mutually
  exclusive with that user's keep + "OK to delete" (the keep/skip/mark-delete routes
  clear the others).
- `user_deletes` — `(plex_user_id, rating_key)` + `marked_at`; per-user "OK to
  delete" (the requester signing off). Only settable on an item that user requested
  (`isRequestedByUser` gate, from `seerr_requests`). Mutually exclusive with that
  user's keep/skip. Indexed by user (`idx_deletes_user`) and item (`idx_deletes_item`,
  for the by-anyone view + the attribution join to `users`). Excluded from that
  user's feed (`FEED_ELIGIBILITY`).
- `users` — media-server accounts (`plex_user_id` is the internal id — historically
  Plex, now the Plex/Jellyfin/Emby account id); `is_admin` (first login / server owner),
  `enabled` (admin can block an account; Owner is exempt). Migrated via guarded `ALTER TABLE`.
- `watch_history` — `(plex_user_id, rating_key)` `plays` + `last_watched`, from
  **Tautulli (Plex)** or **native `UserData` (Jellyfin/Emby)** — `syncWatchHistory` uses
  `getBackend().getWatchData()` (native) and falls back to Tautulli when the backend has
  none. Powers the Browse **Watched** filter + the per-card watched badge (by you) and the
  Big Picture **never watched by anyone** metric. Indexed by user (`idx_watch_user`) and by
  item (`idx_watch_item`, for the by-anyone lookup). UI watch surfaces gate on
  `isWatchAvailable()` (Tautulli for Plex, native otherwise).
- `seerr_requests` — `(plex_user_id, rating_key)`; cached Seerr requests (refreshed
  by the `requests` job; badges/filters read this, not live Seerr). Also warmed
  for a single user on their **first login** via `syncSeerrRequestsForUser`, so
  "Requested by me" works without waiting for the daily job.
- `arr_items` — one row per matched media item with its Sonarr/Radarr metadata
  (`source`, `instance_id/name`, `arr_id`, `monitored`, `status`, `quality` +
  `quality_kind` file|profile, `root_folder`, `arr_size_bytes`, `tags` JSON). Keyed
  by `rating_key`; replaced wholesale by the `arr` job. LEFT-JOINed by `queryLibrary`
  to power Browse's List view + quality/tag/monitored/status/size-mismatch filters.
- `arr_unmatched` — Sonarr/Radarr titles that matched no Plex item. Only
  **downloaded** ones (`sizeOnDisk > 0`, stored as `size_bytes`) are recorded — they're
  media on disk Plex can't see (actionable); wanted-but-not-downloaded titles are skipped
  (just missing media). Replaced by the `arr` job; surfaced in Settings → Match health
  largest-first with sizes + a total. (`mediaMissingExternalIds()` reports the inverse:
  Plex items with a null `guid_tvdb`/`guid_tmdb` that can never match.) Matched via
  `media_items.guid_tvdb`/`guid_tmdb` (indexed). `size_bytes` added via guarded `ALTER`.
- `settings` — key/value; secret values encrypted.
- `job_state` — one row per scheduled job (`recentlyAdded`/`library`/`sizes`/`watch`/
  `requests`/`arr`): last run/status/message/duration/result.
- `job_runs` — append-only run history (last ~100) for the admin activity log.
- `logs` — app-event log (`ts,level,source,message`, pruned to ~1000) for Settings → Logs.
- `sync_state` — legacy single row (id=1); superseded by `job_state`, no longer read.

The shared id across Plex/Tautulli/Seerr is the Plex **ratingKey** (mutable
across Plex library rebuilds — treat as best-effort). Sonarr/Radarr instead match
on the **stable** external ids `guid_tvdb` (shows) / `guid_tmdb` (movies) / `guid_imdb`
(both — the extra axis), which Plex sync populates. Matching tries the primary id
(tvdb/tmdb) then falls back to **imdb** (`ArrRecord.imdbId`; both Sonarr & Radarr expose
`imdbId`) — so an item Plex only matched to IMDb still resolves. **A Plex item can carry
MULTIPLE ids of a kind** (e.g. a show merged across two TheTVDB entries), so
`extractGuids` keeps ALL of them as a CSV (`"376459,407505"`) and `ratingKeysByGuid`
splits it so an arr id matching ANY of them resolves. (`ratingKeysByGuid('imdb')` spans
both kinds; `tvdb`/`tmdb` stay kind-scoped.) Keeping only one — the old behavior took the
last — meant items matched the wrong id and showed as unmatched even though the right id
was present. `extractGuids` also falls back to the legacy single-`guid` string
(`com.plexapp.agents.thetvdb://…`, `…imdb://tt…`) when the modern `Guid[]` array is absent.
`mediaMissingExternalIds` (the "can never match" count) treats an item as id-less only
when it has no tvdb/tmdb **and** no imdb.

## API routes

- **Auth is backend-aware** (`media_server_type`): Plex uses PIN OAuth; Jellyfin/Emby
  use username+password. `POST /api/auth/plex/pin` → `{id, authUrl}`; `GET
  /api/auth/plex/check?id=` → `{status: pending|authorized|denied, needsSetup, isAdmin}`
  (Plex). `POST /api/auth/setup {type, url?}` — first-run only (403 once an admin exists):
  records the chosen server type, and for Jellyfin/Emby tests+stores the server URL.
  `POST /api/auth/login {username, password}` — Jellyfin/Emby credential login (a
  successful auth IS server access; first user bootstraps owner and their access token
  becomes the server read token). `POST /api/auth/logout`; `GET /api/auth/me`.
- `GET /api/feed/random?limit=&section=&largest=1` → home batch. Default (no
  params) = screen-fill mix across **all Plex libraries**, weighted toward big
  series with a guaranteed few movies. `section=<id>` limits to one Plex library;
  `largest=1` = biggest titles regardless of library/keep-eligibility
  (`remaining` is null). Categories are real Plex libraries — never hardcoded.
- `POST/DELETE /api/keep` `{ratingKey}` — toggle **this user's** keep. POST also
  clears their "don't care" + "OK to delete"; DELETE removes only their own keep
  (others' keeps stay, item remains protected).
- `POST/DELETE /api/skip` `{ratingKey}` — per-user single-item "don't care"
  toggle. POST also clears this user's keep + "OK to delete" (mutually exclusive).
- `POST/DELETE /api/mark-delete` `{ratingKey}` — per-user "OK to delete" toggle.
  POST is **gated** by `isRequestedByUser` (403 `not_requested` otherwise) and clears
  this user's keep + "don't care". Does not touch others' keeps.
- `POST /api/skip-batch` `{ratingKeys[]}` — per-user skip + fresh batch (keep-loop).
- `GET /api/library?sections=<id,id,…>&q=&sort=size|title|added|year&dir=asc|desc&state=keptByMe,keptOther,dontcare,okDeleteMine,okDeleteAny,undecided&kept=all|kept|unkept&keptByMe=1&skip=all|skipped|unskipped&deleted=all|deletedByMe|deletedAny&watch=all|watched|unwatched|unwatchedAny|recent30|recent60|recent90|stale90&source=sonarr|radarr&instance=&tag=&quality=&monitored=all|monitored|unmonitored&requestedByMe=1&hideKept=&offset=`
  — browse/search; `sections` is a comma list of Plex library ids (omit = all,
  multi-select in the sidebar). Returns `kept` (anyone), per-user `keptByMe`,
  per-user `skipped`, per-user `watched`, per-user `requestedByMe` +
  `markedForDeleteByMe`, server-wide `markedForDeleteAny` (no identity),
  **and Sonarr/Radarr metadata** (`source`,
  `instanceName`, `monitored`, `status`, `quality`, `qualityKind`, `tags[]` — null
  when the title isn't arr-matched; powers Browse's List view + quality badge). The
  Browse UI exposes a **Status** filter as a **combinable checkbox dropdown** →
  the `state=` param: a comma list of per-user decision buckets OR'd together
  (**empty = All**). Buckets: `keptByMe` (you keep it), `keptOther` (kept by
  someone else, not you), `dontcare` (your "don't care"), `undecided` (you've made
  no keep/skip/delete decision — excludes only YOUR own marks), and — only when
  Seerr is connected — `okDeleteMine` / `okDeleteAny` (your / anyone's "OK to
  delete", the by-anyone view stays identity-free). Defaults to `state=undecided`
  (hides items you've decided on). (The legacy single-select `kept`/`keptByMe`/
  `skip`/`deleted` params are still honored for back-compat but the Browse UI now
  drives `state`.) Also a **Grid/List** view toggle (remembered in
  `localStorage`; List adds
  click-to-sort column headers — all columns, sort persisted — and a poster column),
  — **only when Tautulli is connected** — a **Watched** filter (`watch=`):
  watched/not-watched **by you**, **not watched by anyone** (`unwatchedAny`,
  server-wide), recency windows, `stale90`; — **only when Sonarr/Radarr is
  connected** — **multi-select** `source`/`instance`/`tag`/`quality`/`status`/
  `monitored` filters (each a comma-separated "any of"; empty = no filter; the
  quality dropdown groups values by resolution bucket with select-all), a **`match`**
  filter (`matched`/`unmatched` — In vs Not in Sonarr·Radarr), and a `sizeMismatch=1`
  toggle (Plex vs arr size diverges >10% AND >1 GB); and `requestedByMe` (Seerr).
  Items also carry `arrSizeBytes` + a computed `sizeMismatch` flag. (The arr
  multi-value filters restrict to arr-matched titles; `match`/`sizeMismatch` don't.)
- `GET /api/library/facets` → `{instances,tags,qualities,statuses}` for the Browse
  arr filter dropdowns (from `arrFacets()`).
- `GET /api/search?q=&offset=` → ranked results (exact>prefix>word>substring,
  multi-token AND), with kept + per-user skipped/watched/requestedByMe +
  markedForDeleteByMe/markedForDeleteAny flags (so search cards show the "OK to
  delete" control too). `GET /api/search/suggest?q=` → top-8 typeahead.
- `GET /api/sections` → managed libraries `[{id,title,kind,itemCount,sizeBytes}]`
  (nav rail Browse, Keep filters, Library, Big Picture).
- `GET /api/storage` → per-filesystem free/total (`fs.statfs`) + per-library used
  size; `configured:false` until libraries are mapped to disk paths.
- `GET /api/overview` → per-library, per-user keep breakdown + disk capacity, in
  one call (powers the Keep totals column and the Big Picture dashboard). Each
  library partitions its bytes/items into `kept` (protected — anyone keeps it),
  `dontcare` (not protected + this user skipped), and `undecided` (the rest);
  `keptByMe*` is a sub-count of kept. Also returns `unwatched*` (items NOBODY on the
  server has watched — the Big Picture "never watched" reclaim metric) plus
  `unwatchedKeptBytes`/`unwatchedKeptByMeBytes`/`unwatchedDontcareBytes`/
  `unwatchedUndecidedBytes` (the never-watched bytes split by keep bucket, so the
  metric can be drawn as a subset of the composition bar — surfacing e.g. kept
  titles nobody has watched), `storage` totals, `mediaUsedBytes`, summed `totals`,
  `tautulli` (bool — whether watch surfaces should render), and — when Sonarr/Radarr
  is connected — `arr: true` + `qualityBreakdown` (`{byQuality[], notInArr}` → the
  Big Picture "By quality" table; its `reclaimableBytes` field shows in the UI as
  "Not kept"); and — when Seerr is connected — `seerr: true` + `markedForDelete:
  {titles, bytes}` (the Big Picture "OK to delete" KPI). Backed by `librarySummary` +
  `arrQualitySummary`/`unmatchedMediaSummary` + `markedForDeleteSummary`.
- `GET /api/about` → `{name, version, latest, updateAvailable, releaseUrl}` for the
  About panel (latest = newest GitHub release via `lib/version.ts`, cached ~6h;
  null when unknown/offline — never an error).
- `GET /api/openapi.json` — the OpenAPI spec (authored at repo-root
  `openapi.json`; keep it in sync when routes change). Rendered at `/api-docs`.
- `GET /api/stats?view=largest|reclaimable|unwatched|markedForDelete&offset=` — big
  picture + summary. `unwatched` = largest titles nobody has watched
  (`neverWatchedItems`; the "Never watched" drill-down, shown only when Tautulli is
  connected). `markedForDelete` = titles anyone marked "OK to delete", largest first,
  each with its marker name(s) + a `keptByAnyone` flag (`markedForDeleteItems`; the
  drill-down shown only when Seerr is connected — the one place marker identity is
  shown). Accepts a session user **or** the API key (`X-Api-Key`).
- `GET /api/requests` — current user's Seerr rating keys for badges, read from the
  `seerr_requests` cache (refreshed by the `requests` job, not live).
- `GET /api/image?path=&w=&h=` — proxies posters (token stays server-side); backend-aware
  (`path` = Plex relative thumb, or a Jellyfin/Emby item id → `/Items/{id}/Images/Primary`).
- `GET /api/health` — public liveness probe (used by the Docker healthcheck).
- Admin (require `is_admin`): `GET/PUT /api/admin/settings` (PUT accepts
  `storageMappings`, `managedSectionIds`, `appTitle`, `appUrl`, `apiKey`, `plexBaseUrl`,
  `jobSchedules`, `plexServer`, `tautulli`, `seerr`, `sonarrInstances`,
  `radarrInstances` — GET returns instances as `[{id,name,url,hasKey}]`, never their
  apiKeys; the automation `apiKey` IS returned so the UI can show a masked
  copy-able field, Servarr-style),
  `GET /api/admin/plex-servers`, `POST /api/admin/test-connection` (services
  `plex`/`jellyfin`/`emby`/`tautulli`/`seerr`/`sonarr`/`radarr`),
  `POST /api/admin/sync-libraries` (discover sections only, fast — backend-agnostic
  via `getBackend().listSections()`),
  `GET /api/admin/storage-check?path=`, `GET /api/admin/jobs` (status + recent runs)
  + `POST /api/admin/jobs {job}` (trigger one/`all`) — both also accept `X-Api-Key`,
  `GET /api/admin/logs?level=&q=&limit=` (keyword search over message+source;
  limit ≤ 1000 for the .txt export) + `DELETE /api/admin/logs`,
  `GET /api/admin/cache` + `POST /api/admin/cache {target:images|requests|watch|arr}`
  (`arr` clears both `arr_items` + `arr_unmatched`),
  `GET /api/admin/health` (`{issues: HealthIssue[]}` — standing warnings from
  `lib/health.ts`; AppShell's ⚠ chip + the Jobs-tab Health card; each issue's
  `docSlug` → a README "Health checks" anchor),
  `GET /api/admin/backups` (list) + `POST {action:'create'|'restore', name?}` +
  `DELETE {name}` + `GET /api/admin/backups/download?name=` (backup names are
  strictly validated — `keeparr[-pre-restore]-YYYYMMDD-HHmmss[-n].db` only),
  `GET /api/admin/arr-health` (`{matched, unmatched[], missing, arrJob}` — Match
  health panel; `unmatched[]` = titles DOWNLOADED in *arr but not in Plex, with
  `sizeBytes`, largest-first),
  `GET/PUT /api/admin/users` (list + grant/revoke admin + enable/disable + the
  `openSignin` toggle; Owner can't be demoted or disabled),
  `POST /api/admin/users/import` (import the Plex shared-user list).

## Settings keys (all via `lib/settings.ts`)

`media_server_type` (`'plex'|'jellyfin'|'emby'`; **defaults to `'plex'`** when unset, so
existing installs are unchanged — chosen once at first-run setup), `media_device_id`
(stable id for the Jellyfin/Emby MediaBrowser auth header). Per-backend connection keys
resolve through type-aware accessors (`getServerBaseUrl/Token/Name/Id`, `getOwnerId`,
`getAdminToken`, `isServerConfigured`): Plex keeps its historical names —
`plex_client_id`, `plex_owner_id`, `plex_admin_token`*, `plex_machine_id`,
`plex_base_url`, `plex_server_token`*, `plex_server_name`; Jellyfin/Emby use a uniform
scheme — `<type>_url`, `<type>_token`*, `<type>_admin_token`*, `<type>_server_id`,
`<type>_server_name`, `<type>_owner_id` (`<type>` = `jellyfin`|`emby`). `plex_sections` (json;
includes each section's `paths[]`; reused for all backends), `tautulli_url`, `tautulli_api_key`*,
`seerr_url`, `seerr_api_key`*, `sonarr_instances`*, `radarr_instances`* (json
arrays of `{id,name,url,apiKey}` — N instances each; the whole blob is encrypted),
`job_schedules` (json per job: `{type:'interval',minutes}`,
`{type:'daily',hour,minute}`, or `{type:'weekly',weekday,hour,minute}`; replaces
the old `job_intervals`),
`storage_mappings` (json `{sectionId,path}[]` — container paths for free-space
measurement), `managed_section_ids` (json; which libraries Keeparr tracks, empty =
all), `open_signin` (`'true'`/`'false'`), `api_key`* (automation), `app_title`,
`app_url` (Plex sign-in forwardUrl; overrides the `APP_URL` env var),
`backup_retention` (how many backup files to keep; default 14),
`dev_storage_total` (demo-only synthetic capacity, set by the seed). `*` = encrypted
at rest.

**Local demo mode**: `npm run seed` (`lib/dev-seed.ts` + `scripts/seed.ts`) fills
`./data` with fake libraries; `KEEPARR_DEV_LOGIN=1` makes `middleware.ts` auto-mint a
dev session (no Plex/login). `KEEPARR_DEV_SERVER=jellyfin|emby npm run seed` configures
the demo as that backend (fake connection) instead of Plex, so the setup/login branch +
backend-aware UI are clickable offline (default = Plex). All inert/absent in production.

## Auth / access control

- **Backend is selectable** (`media_server_type`, default `'plex'`). The login page
  (`app/login/page.tsx` server component → `LoginClient`) reads the type and renders the
  right flow; a server-type chooser appears only on a brand-new install (no type chosen +
  no admin). `decideAccess` (`lib/login.ts`) is backend-agnostic — it only takes booleans.
- **Plex** — PIN OAuth: create pin → user authorizes at app.plex.tv → poll → token →
  identity (`/api/v2/user`) → `decideAccess`. Other users must appear in the server's
  shared-users list (`checkServerAccess`, parsing `plex.tv/api/users` via `parseSharedUsers`).
- **Jellyfin/Emby** — credential login (`/api/auth/login` → `authenticateByName`): a
  successful auth IS server access (no shared-user list). The first-run flow collects the
  server URL via `/api/auth/setup` (bootstrap-only) before login; the bootstrap admin's
  access token becomes the server read token.
- First-ever login = **bootstrap_admin** (claims admin, stores owner id + token; for Plex
  must then connect a server). Owner is always allowed.
- Admin is **binary** (`users.is_admin`). Shared users log in with `is_admin=0`;
  any admin can promote/revoke others from the Users screen via `setUserAdmin`
  (the explicit counterpart to `upsertUser`, whose `MAX(is_admin, …)` only raises).
  The Owner (`plex_owner_id`) can never be demoted. There are **no local accounts**
  — Plex login only, no self-registration.
- **Sign-in gate**: `open_signin` (default on) lets any shared-server user in. When
  off, `decideAccess` admits non-owners only if they're `userKnown && userEnabled`
  (use **Import users from Plex** to pre-create accounts, then toggle Enabled).
  `getSessionUser` returns null for a disabled non-owner, so blocking takes effect
  immediately. The Owner is always allowed/enabled.
- **Security posture** (audited July 2026): all SQL is parameterized (`lib/queries.ts`),
  every `/api/admin/*` route calls `requireAdmin`, secrets are AES-GCM encrypted at
  rest (`lib/crypto.ts` `SECRET_KEYS`). Hardening in place: the image proxy validates
  `path` against an SSRF allowlist (`lib/image-path.ts isSafeImagePath` — Plex must be
  `/library/…`, no `://`/`..`; JF/Emby an opaque id); `/api/auth/login` (Jellyfin/Emby
  creds) is rate-limited per IP (`lib/rate-limit.ts`, 10 / 5 min); the API-key and
  session-signature compares are constant-time (`safeEqual`); `instrumentation.ts`
  logs a loud warning if a production boot uses the default `SESSION_SECRET`. The
  Docker image strips npm/yarn/corepack from the runtime stage (unused attack surface)
  and `npm audit` is clean (postcss pinned via an `overrides` entry). Baseline
  response headers set in `next.config.js` (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, CSP `frame-ancestors 'self'`) — deliberately NO strict
  script/style CSP (would break the inline theme script + Scalar). Backup filenames
  are regex-validated (`isValidBackupName`); the image cache key is SHA-1-hashed before
  becoming a path. `KEEPARR_DEV_LOGIN` is the only auth bypass and is env-gated + inert
  in production (never set it in the image).
- **API key** (`api_key`): `requireAdminOrApiKey`/`requireUserOrApiKey` (`lib/auth.ts`)
  accept an `X-Api-Key` header as an alternative to a session (for `/api/admin/jobs`
  + `/api/stats`). `middleware.ts` lets `/api/` requests carrying that header past the
  edge session gate; the Node route validates the key.
- Server owner's account token (`plex_admin_token`) is used for shared-user
  checks + server discovery. The per-device server token (`plex_server_token`)
  is used for all PMS reads.

## External API notes (verified against Overseerr / python-plexapi / Tautulli)

- **Plex size on disk**: `MediaContainer.Metadata[].Media[].Part[].size` (bytes).
  Movies inline; series via `GET /library/metadata/{ratingKey}/allLeaves` summed
  over all episodes. Helpers: `sumPartSizes`, `sumLeafSizes`. `sumLeafSizes`
  dedupes by `Part.file`/`Part.id` so a **multi-episode file** (one file shared by
  several episode leaves — Plex reports the full size on each) is counted once,
  not once per episode.
- **Plex PIN**: `POST plex.tv/api/v2/pins?strong=true`, auth at
  `app.plex.tv/auth#?clientID=&code=&context[device][product]=`, poll
  `GET plex.tv/api/v2/pins/{id}` until `authToken`. Reuse a stable
  `X-Plex-Client-Identifier` (persisted as `plex_client_id`).
- **Jellyfin / Emby** (MediaBrowser API, verified against Seerr's `jellyfin.ts`): auth
  `POST /Users/AuthenticateByName {Username,Pw}` with the `MediaBrowser Client=…,
  Device=…, DeviceId=…, Version=…[, Token=…]` header (sent on both `Authorization` and
  `X-Emby-Authorization`; device id persisted as `media_device_id`) → `{AccessToken,
  User:{Id,Name,Policy.IsAdministrator}}`. Libraries `GET /Library/MediaFolders`
  (CollectionType movies→movie, tvshows→show). Items `GET /Items?Recursive=true&
  IncludeItemTypes=Movie|Series&ParentId=&fields=ProviderIds,MediaSources,DateCreated`
  (paged via StartIndex/Limit + TotalRecordCount). Series size = `GET
  /Items?ParentId={id}&Recursive=true&IncludeItemTypes=Episode&fields=MediaSources`,
  summing `MediaSources[].Size` deduped by `Path` (multi-episode files). Size on disk =
  `MediaSources[].Size`; ids = `ProviderIds.{Tmdb,Tvdb}` → `guid_tmdb/guid_tvdb`; added =
  `DateCreated`; poster = `GET /Items/{id}/Images/Primary?fillWidth=&fillHeight=&api_key=`.
  Emby is the same API (only the auth-header version string differs). Unverified against a
  live server — built to the documented API + Seerr's client.
- **Tautulli**: `GET {url}/api/v2?apikey=&cmd=&out_type=json`; envelope
  `response.{result,message,data}`. `get_history` rows are at
  `response.data.data[]` (object); aggregate by `grandparent_rating_key`
  (episodes) / `rating_key` (movies).
- **Seerr**: base `/api/v1`, header `X-Api-Key`. Match the user to a Seerr user by
  email / plex / jellyfin username, then read `/user/{id}/requests`. On Plex,
  `media.ratingKey` IS the rating key (direct join); on Jellyfin/Emby that isn't our
  item id, so we match the request's `media.tmdbId` (movies) / `tvdbId` (tv) to
  `media_items.guid_tmdb`/`guid_tvdb` via `ratingKeysByGuid`.
- **Sonarr/Radarr** (v3): base `{url}/api/v3`, header `X-Api-Key`. `GET /series`
  (`tvdbId`, `imdbId`, `monitored`, `status`, `qualityProfileId`, `statistics.sizeOnDisk`,
  `tags:number[]`) / `GET /movie` (`tmdbId`, `imdbId`, `monitored`, `status`, `sizeOnDisk`,
  `movieFile.quality.quality.name`, `tags:number[]`); resolve `tags`/profiles via
  `GET /tag` + `GET /qualityprofile`; `GET /system/status` for the Test button.
  Match `tvdbId→guid_tvdb` (shows) / `tmdbId→guid_tmdb` (movies), falling back to
  `imdbId→guid_imdb`. Series quality is the profile name (target); movie quality is the
  actual file quality.

A fuller source-verified reference is in the planning doc
`~/.claude/plans/alright-this-is-a-mighty-brooks-agent-*.md`.

## Conventions

- **Theming is CSS-variable-driven**: every used color family (slate ladder,
  brand, app/rail/panel surfaces, status hues) resolves through `--c-*`
  variables (`tailwind.config.ts` → `rgb(var(--c-…) / <alpha-value>)`), with
  the palettes in `app/globals.css` — `:root`/`[data-theme='dark']` (canonical,
  stock Tailwind values), `[data-theme='light']` (inverted slate ladder), and
  `[data-cim='1']` (color-impaired remap of rose/emerald/red only). A new
  color+shade needs a variable in every theme block. `data-theme`/`data-cim`
  are stamped on `<html>` pre-paint by the inline script in `app/layout.tsx`
  (localStorage `keeparr.theme` = auto|light|dark, `keeparr.colorImpaired`);
  `components/ThemeMenu.tsx` (in the AppShell user menu) edits them live.
  Two NON-themed constants: `ink` (dark text on brand-amber buttons/badges)
  and `paper` (true white on saturated badges over posters) — use these, not
  `text-slate-900`/`text-white`, when the surface doesn't change with theme.
- Plex-amber accent (`brand` in `tailwind.config.ts`).
- **Toasts**: `components/Toaster.tsx` — `ToastProvider` mounts once in
  AppShell; `useToast()(msg, 'info'|'success'|'error')` anywhere below it
  (no-op fallback without a provider, so hooks stay test-safe). Used for
  silent-failure paths (keep/skip/delete revert, feed/library load errors,
  job/backup actions); settings panels keep their inline `msg` text.
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
  `components/ShortcutsOverlay.tsx`.
- Server components guard admin pages and pass to client components that fetch
  their own data.
- Optimistic UI for keep toggles (revert on failure).
- Refresh work is split into scheduled jobs (`lib/jobs.ts`): `recentlyAdded` (cheap,
  newest items only), `library` (full inventory + movie sizes + new-show sizing),
  `sizes` (expensive per-series `getAllLeaves` recompute), `watch` (Tautulli),
  `requests` (Seerr cache), `arr` (Sonarr/Radarr quality+tags cache), `backup`
  (db snapshot + retention prune, `lib/backup.ts`). Each is
  single-flight per `job_state`, fire-and-forget from `/api/admin/jobs`, auto-run by
  `lib/scheduler.ts` on its `job_schedules` entry (`isDue`: every N minutes/hours, daily
  at a local HH:MM, or weekly on a local weekday at HH:MM). Defaults in `config.ts` (`DEFAULT_JOB_SCHEDULES`): recentlyAdded
  5 min; library 03:00; watch 04:00; requests 05:00; sizes 06:00; arr 07:00;
  backup 08:00.
- **Releases + images**: the update check compares `package.json` version to
  the newest GitHub Release. Shipping a release = bump `package.json` version
  → commit → tag `v<version>` → `gh release create v<version>` with notes —
  do this only when the user explicitly asks to ship/release. Publishing the
  release triggers `.github/workflows/release.yml`, which (after a
  tag==package.json guard + tests) builds the multi-arch image natively
  (amd64 + arm64 runners, no QEMU) and pushes
  `ghcr.io/drohack/keeparr:{latest,X.Y.Z,X.Y}`. `ci.yml` runs tests on every
  PR/push and publishes a `develop` image on pushes to main. Tests are NOT in
  the Dockerfile (hoisted to CI); the Dockerfile must copy `public/`
  explicitly (standalone output omits it). `docker-entrypoint.sh`
  auto-generates SESSION_SECRET into `$DATA_DIR/.session-secret` when the env
  var is unset (env wins; it runs BEFORE node so the Edge middleware sees the
  same process.env — never move this into app code, Edge can't read files).
  Shell scripts are forced LF via .gitattributes (CRLF breaks alpine sh).
  Unraid users install via the
  Community Applications template (github.com/drohack/unraid-templates,
  `keeparr.xml`) — keep its port/paths/vars in sync with the Dockerfile when
  they change.
- ROADMAP.md tracks the researched platform-feature tiers: Tiers 1 (health/
  update/backups/API docs, v0.2.0) and 2 (themes/toasts/logs/PWA/shortcuts,
  v0.3.0) are done; Tier 3 is deliberately parked — don't build those without
  the user asking.
