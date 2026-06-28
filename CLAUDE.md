# CLAUDE.md — Keeparr contributor guide

Keep this file and README.md in sync when you change behavior, schema, routes,
or settings keys.

## What Keeparr is

Plex-login web app for deciding what media to **keep** and reporting what can be
deleted. Tag + report only — **never deletes**. Keep is **per-user** but
protective: an item is kept (safe) if **anyone** keeps it, and you can only
remove **your own** keep. Keep and "don't care" are **mutually exclusive** per
user (a 3-state control: none / keep / don't care). "Don't care" ("skip the
rest") is per-user. See README.md for the feature overview.

## Canonical rules

- **Categories are the user's actual Plex libraries — never hardcode "Movies /
  TV / Anime".** Everyone's library setup differs; the feed filters and library
  sidebar are driven by `getPlexSections()` (section ids). `library_kind`
  (movie/show) is Plex's own section type and may be used internally (e.g. to seed
  some movies into the mixed feed), but it is not a user-facing taxonomy.
- All SQL lives in `lib/queries.ts`. Don't write SQL elsewhere.
- All external HTTP lives in `lib/plex.ts`, `lib/tautulli.ts`, `lib/seerr.ts`.
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
  queries.ts         ALL SQL
  types.ts           shared DTOs
  format.ts          formatGB / formatSize
  crypto.ts          AES-GCM encrypt/decrypt for stored tokens
  session.ts         signed cookie (Edge-safe, Web Crypto)
  auth.ts            session read/write + requireUser/requireAdmin (Node)
  settings.ts        typed settings accessors (+ secret encryption)
  login.ts           pure access-control decision (decideAccess) — unit tested
  plex.ts            plex.tv OAuth + PMS read API + size summation helpers
  tautulli.ts        watch-history client
  seerr.ts           requests client
  sync.ts            job runners: syncRecentlyAdded / syncLibrary / syncSizes / syncWatchHistory / syncSeerrRequests
  jobs.ts            job registry + runJob/runWithState (single-flight) + isDue/dueJobs
  scheduler.ts       per-job scheduler (interval or daily HH:MM); fires due jobs each minute
  cards.ts           MediaItem → MediaCardData (+ proxied poster URL)
  storage.ts         fs.statfs free/total per filesystem (Node-only); dedupes mounts
  cache.ts           on-disk poster cache (read/write/clear/stats) — Node-only
  route-helpers.ts   errorResponse
app/
  login/             Plex PIN login (popup + poll)
  page.tsx           home: AppShell → KeepView (no-scroll single-screen)
  library/           AppShell → LibraryBrowser (Browse; library selection via rail)
  search/            AppShell → SearchResults
  stats/             AppShell → StatsView (full-width dashboard)
  settings/<tab>/    admin Settings sub-tabs: general, users, connections, libraries,
                     jobs, logs, about (+ /settings → general). admin/* → redirects.
  api/...            route handlers (see below)
components/          AppShell (rail + top bar + user menu), MediaCard, KeepView,
                     LibraryBrowser, StatsView, UsersManager, SearchBox, SearchResults;
                     breakdown.tsx (shared keep/reclaim visual language: StackedBar,
                       Donut, LegendRow + the TONE palette — used by KeepView's totals
                       column and the StatsView dashboard);
                     settings/ (SettingsLayout + General/Users/Connections/JobsCache/Logs/About panels;
                       managed libraries + storage live inside the Connections panel)
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
  exclusive with that user's keep (the keep/skip routes clear the other).
- `users` — Plex accounts; `is_admin` (first login / server owner), `enabled`
  (admin can block an account; Owner is exempt). Migrated via guarded `ALTER TABLE`.
- `watch_history` — `(plex_user_id, rating_key)` plays, from Tautulli.
- `seerr_requests` — `(plex_user_id, rating_key)`; cached Seerr requests (refreshed
  by the `requests` job; badges/filters read this, not live Seerr).
- `settings` — key/value; secret values encrypted.
- `job_state` — one row per scheduled job (`recentlyAdded`/`library`/`sizes`/`watch`/
  `requests`): last run/status/message/duration/result.
- `job_runs` — append-only run history (last ~100) for the admin activity log.
- `logs` — app-event log (`ts,level,source,message`, pruned to ~1000) for Settings → Logs.
- `sync_state` — legacy single row (id=1); superseded by `job_state`, no longer read.

The shared id across Plex/Tautulli/Seerr is the Plex **ratingKey** (mutable
across Plex library rebuilds — treat as best-effort).

## API routes

- `POST /api/auth/plex/pin` → `{id, authUrl}`; `GET /api/auth/plex/check?id=` →
  `{status: pending|authorized|denied, needsSetup, isAdmin}`; `POST
  /api/auth/logout`; `GET /api/auth/me`.
- `GET /api/feed/random?limit=&section=&largest=1` → home batch. Default (no
  params) = screen-fill mix across **all Plex libraries**, weighted toward big
  series with a guaranteed few movies. `section=<id>` limits to one Plex library;
  `largest=1` = biggest titles regardless of library/keep-eligibility
  (`remaining` is null). Categories are real Plex libraries — never hardcoded.
- `POST/DELETE /api/keep` `{ratingKey}` — toggle **this user's** keep. POST also
  clears their "don't care"; DELETE removes only their own keep (others' keeps
  stay, item remains protected).
- `POST/DELETE /api/skip` `{ratingKey}` — per-user single-item "don't care"
  toggle. POST also clears this user's keep (mutually exclusive).
- `POST /api/skip-batch` `{ratingKeys[]}` — per-user skip + fresh batch (keep-loop).
- `GET /api/library?sections=<id,id,…>&q=&sort=size|title|added|year&dir=asc|desc&kept=all|kept|unkept&skip=all|skipped|unskipped&requestedByMe=1&hideKept=&offset=`
  — browse/search; `sections` is a comma list of Plex library ids (omit = all,
  multi-select in the sidebar). Returns `kept` (anyone), per-user `keptByMe`, and
  per-user `skipped`. The Browse UI exposes one **Status** filter (default
  **Undecided** → `kept=unkept&skip=unskipped`, i.e. hides decided items; Kept;
  Don't care; All). `requestedByMe` filters to the user's Seerr requests
  (best-effort; empty when Seerr unconfigured).
- `GET /api/search?q=&offset=` → ranked results (exact>prefix>word>substring,
  multi-token AND), with kept + per-user skipped flags. `GET /api/search/suggest?q=`
  → top-8 typeahead.
- `GET /api/sections` → managed libraries `[{id,title,kind,itemCount,sizeBytes}]`
  (nav rail Browse, Keep filters, Library, Big Picture).
- `GET /api/storage` → per-filesystem free/total (`fs.statfs`) + per-library used
  size; `configured:false` until libraries are mapped to disk paths.
- `GET /api/overview` → per-library, per-user keep breakdown + disk capacity, in
  one call (powers the Keep totals column and the Big Picture dashboard). Each
  library partitions its bytes/items into `kept` (protected — anyone keeps it),
  `dontcare` (not protected + this user skipped), and `undecided` (the rest);
  `keptByMe*` is a sub-count of kept. Also returns `storage` totals, `mediaUsedBytes`,
  and summed `totals`. Backed by `librarySummary(plexUserId)` in `lib/queries.ts`.
- `GET /api/about` → `{name, version}` for the About panel.
- `GET /api/stats?view=largest|reclaimable&offset=` — big picture + summary.
  Accepts a session user **or** the API key (`X-Api-Key`).
- `GET /api/requests` — current user's Seerr rating keys for badges, read from the
  `seerr_requests` cache (refreshed by the `requests` job, not live).
- `GET /api/image?path=&w=&h=` — proxies Plex thumbs (token stays server-side).
- `GET /api/health` — public liveness probe (used by the Docker healthcheck).
- Admin (require `is_admin`): `GET/PUT /api/admin/settings` (PUT accepts
  `storageMappings`, `managedSectionIds`, `appTitle`, `appUrl`, `apiKey`, `plexBaseUrl`,
  `jobSchedules`, `plexServer`, `tautulli`, `seerr`),
  `GET /api/admin/plex-servers`, `POST /api/admin/test-connection`,
  `POST /api/admin/sync-libraries` (discover sections only, fast),
  `GET /api/admin/storage-check?path=`, `GET /api/admin/jobs` (status + recent runs)
  + `POST /api/admin/jobs {job}` (trigger one/`all`) — both also accept `X-Api-Key`,
  `GET /api/admin/logs?level=` + `DELETE /api/admin/logs`,
  `GET /api/admin/cache` + `POST /api/admin/cache {target:images|requests|watch}`,
  `GET/PUT /api/admin/users` (list + grant/revoke admin + enable/disable + the
  `openSignin` toggle; Owner can't be demoted or disabled),
  `POST /api/admin/users/import` (import the Plex shared-user list).

## Settings keys (all via `lib/settings.ts`)

`plex_client_id`, `plex_owner_id`, `plex_admin_token`*, `plex_machine_id`,
`plex_base_url`, `plex_server_token`*, `plex_server_name`, `plex_sections` (json;
includes each section's Plex `paths[]`), `tautulli_url`, `tautulli_api_key`*,
`seerr_url`, `seerr_api_key`*, `job_schedules` (json per job: `{type:'interval',
minutes}` or `{type:'daily',hour,minute}`; replaces the old `job_intervals`),
`storage_mappings` (json `{sectionId,path}[]` — container paths for free-space
measurement), `managed_section_ids` (json; which libraries Keeparr tracks, empty =
all), `open_signin` (`'true'`/`'false'`), `api_key`* (automation), `app_title`,
`app_url` (Plex sign-in forwardUrl; overrides the `APP_URL` env var),
`dev_storage_total` (demo-only synthetic capacity, set by the seed). `*` = encrypted
at rest.

**Local demo mode**: `npm run seed` (`lib/dev-seed.ts` + `scripts/seed.ts`) fills
`./data` with fake libraries; `KEEPARR_DEV_LOGIN=1` makes `middleware.ts` auto-mint a
dev session (no Plex/login). Both are inert/absent in production.

## Auth / access control

- PIN OAuth: create pin → user authorizes at app.plex.tv → poll → token →
  identity (`/api/v2/user`) → access decision (`lib/login.ts decideAccess`).
- First-ever login = **bootstrap_admin** (claims admin, stores owner id + account
  token, must connect a server). Owner is always allowed. Other users must
  appear in the server's shared-users list (`checkServerAccess`, which parses the
  XML from `plex.tv/api/users` via `parseSharedUsers`).
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
  over all episodes. Helpers: `sumPartSizes`, `sumLeafSizes`.
- **Plex PIN**: `POST plex.tv/api/v2/pins?strong=true`, auth at
  `app.plex.tv/auth#?clientID=&code=&context[device][product]=`, poll
  `GET plex.tv/api/v2/pins/{id}` until `authToken`. Reuse a stable
  `X-Plex-Client-Identifier` (persisted as `plex_client_id`).
- **Tautulli**: `GET {url}/api/v2?apikey=&cmd=&out_type=json`; envelope
  `response.{result,message,data}`. `get_history` rows are at
  `response.data.data[]` (object); aggregate by `grandparent_rating_key`
  (episodes) / `rating_key` (movies).
- **Seerr**: base `/api/v1`, header `X-Api-Key`. `media.ratingKey` IS the Plex
  rating key (direct join). We match the Plex user to a Seerr user by email /
  plex username, then read `/user/{id}/requests`.

A fuller source-verified reference is in the planning doc
`~/.claude/plans/alright-this-is-a-mighty-brooks-agent-*.md`.

## Conventions

- Dark theme, Plex-amber accent (`brand` in `tailwind.config.ts`).
- Server components guard admin pages and pass to client components that fetch
  their own data.
- Optimistic UI for keep toggles (revert on failure).
- Refresh work is split into scheduled jobs (`lib/jobs.ts`): `recentlyAdded` (cheap,
  newest items only), `library` (full inventory + movie sizes + new-show sizing),
  `sizes` (expensive per-series `getAllLeaves` recompute), `watch` (Tautulli),
  `requests` (Seerr cache). Each is single-flight per `job_state`, fire-and-forget
  from `/api/admin/jobs`, auto-run by `lib/scheduler.ts` on its `job_schedules` entry
  (`isDue`: every N minutes, or daily at a local HH:MM). Defaults in `config.ts`
  (`DEFAULT_JOB_SCHEDULES`): recentlyAdded 5 min; library 03:00; watch 04:00;
  requests 05:00; sizes 06:00.
