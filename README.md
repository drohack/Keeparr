# Keeparr

A self-hosted web app that makes it dead-simple for a household to decide **what
media to keep** — and to find what can be safely deleted to reclaim disk space.

Pick your media server — **Plex, Jellyfin, or Emby** — and users log in with that
server's account (Plex via Overseerr-style PIN OAuth; Jellyfin/Emby via username +
password). Keeparr reads whatever libraries you have, along with each series'/movie's
**total size on disk**, and shows simple poster cards. Tap the things worth
keeping; keeps are **per-user but protective** — an item is kept (safe) if
**anyone** keeps it, and you can only remove your own keep. Keep and "don't
care" are mutually exclusive per person. Everything nobody keeps shows up in a
**Reclaimable** report, largest first.

Keeparr **never deletes anything** — it only tags and reports. You delete
manually in Plex / Jellyfin / Emby / Sonarr / Radarr.

> [!NOTE]
> **Plex is the maturely-tested backend.** Jellyfin and Emby support is built to
> their documented APIs (and mirrors Seerr's client) but has **not yet been verified
> against a live Jellyfin/Emby server** — treat it as beta and please report issues.
> Existing Plex installs are unaffected: the backend defaults to Plex and upgrading
> requires no reconfiguration.

## Features

- **Choose your media server** — at first-run setup you pick **Plex, Jellyfin, or
  Emby**; Keeparr targets one server (like Seerr's `mediaServerType`). Plex uses PIN
  OAuth (only accounts with access to your server can get in); Jellyfin/Emby use a
  username/password login against your server. The first user to log in becomes the
  **Owner** (admin). No local accounts, no sign-up — everyone uses their media-server
  account. Existing Plex installs upgrade with no reconfiguration (the type defaults
  to Plex).
- **Admins & access control** — the Owner can promote any Plex user to admin
  (and revoke it). Only admins see/change Settings, connections, and users. Turn
  off **Open sign-in** to admit only accounts you've enabled, and **Import users
  from Plex** to pre-enable people before their first login. The Owner can't be
  demoted or disabled, so you can't get locked out.
- **Choose which libraries** Keeparr tracks — untick any Plex library in Settings
  to exclude it (default: all).
- **Custom title** — rename the app (nav bar + browser tab) in Settings.
- **API key** — generate a key in Settings and send it as `X-Api-Key` to read the
  stats/reclaimable report or trigger refresh jobs from scripts (no login needed).
- **Keep loop** — the home page shows a screen-filling batch of not-yet-kept
  titles, a mix weighted toward the big series (with a few movies always seeded).
  Tap to keep, then **"Next →"** marks everything you didn't keep as "you don't
  care" (per-user) and rolls a fresh set. Switch the feed to any of **your Plex
  libraries** (or **Largest**) — your choice is remembered. Designed for a
  30-second visit.
- **Storage at a glance** — the Keep page's side column shows a disk gauge (free
  space + % full, the empty part *is* your free space), a **by-library donut**
  (share of the whole), per-library kept/don't-care/undecided bars, and your own
  review progress. Free space is read straight off the disk — requires mounting
  your media share read-only and mapping libraries to their paths in Settings
  (Plex's API doesn't expose free space).
- **Search** — typeahead in the nav previews the closest matches as you type;
  Enter opens a results page (ranked best-first, infinite scroll). Already-kept
  titles show greyed/marked, and your own "don't care" choices are flagged.
- **Library browse/search** — your Plex libraries in the sidebar (each with its
  total size), **multi-select several at once** to compare across them (e.g. all
  your series libraries to see the biggest), sort by size / title / release year /
  recently added in either direction, a combinable **Status** filter — a checkbox
  dropdown whose buckets (**Kept by you**, **Kept by others**, **I don't care**,
  **Undecided**, and — when Seerr is connected — **OK to delete (by you)** / **(by
  anyone)**) are OR'd together, so you can view several states at once; it defaults
  to **Undecided** (hiding what you've already decided on) and checking nothing
  shows everything — and — when
  **watch data is available** (Tautulli for Plex; native for Jellyfin/Emby) — a
  **Watched** filter: watched / not watched **by
  you**, **not watched by anyone** (server-wide), watched in the last 30·60·90 days,
  or not watched in 90+ days (great paired with size sort to surface the biggest
  stuff nobody's touched). Plus **requested by me** in Seerr. Switch between a
  **Grid** (poster) and a **List** (dense table) view — your choice is remembered.
  Search always shows everything.
- **Keep / I don't care** — a per-card choice (nothing / keep / I don't care).
  Keeps are per-user but protective: an item stays safe while anyone keeps it, and
  you only remove your own keep. Marking "I don't care" clears your keep (and
  vice-versa) and greys the card.
- **OK to delete** (needs Seerr) — the person who originally **requested** a title
  can sign off on it ("I'm done with it"). The button only appears on titles *you*
  requested, in Browse and the keep loop. It's a fourth, mutually-exclusive state
  (keep / I don't care / OK to delete) and, like the others, never deletes anything
  — it just **doesn't** override someone else's keep, so a released title that
  someone still keeps stays protected (and is flagged "still kept"). It shows on
  **Big Picture** with **who** released it, and Browse can filter to what you
  released or to everything anyone released (the by-anyone view doesn't reveal who).
- **Big Picture** — a dashboard: one honest disk bar (kept by you / kept by others
  / I don't care / undecided, with free as the empty remainder), your review
  progress, a "where your space goes" donut, and per-library breakdown cards with
  bars sized proportional to each library. The charts are interactive (hover to
  highlight a segment + see its size/share). When **Tautulli is connected** it also
  surfaces **"never watched by anyone"** — a headline stat, brackets above the disk
  bar and each library card marking the never-watched slice *within* each keep
  segment (so you can spot *kept* titles nobody has watched), and a dedicated
  drill-down tab (largest never-watched titles) — the strongest reclaim signal. Plus the other drill-down tables: largest titles on
  disk, and what's not kept by anyone (largest first, running total). When **Seerr
  is connected** it also adds an **"OK to delete"** headline stat and a drill-down
  listing the titles requesters have released, largest first, with **who** released
  each (and a "still kept" flag where someone else's keep still protects it).
- **Problems** (admin) — one page that gathers every "something's off" check with
  a count + size per category, so you don't have to dig through Browse filters and
  Settings panels: **size mismatch** (Plex vs *arr sizes diverge), **in the media
  server but not in *arr** (nothing manages the title), **in *arr but not in the
  media server** (downloaded per Sonarr/Radarr but the server can't see it),
  **identity mismatch** (the same folder claimed under two different titles —
  e.g. Plex matched `The Langoliers (1995)` to some obscure film while Radarr
  tracks The Langoliers; one side's match is wrong, and the row shows both
  claims side by side), **duplicates** (two
  library entries sharing one external id), ***arr conflicts** (two instances
  both managing the same title), **zero size** (the server lists it but reports
  no file bytes), **removed but kept** (deleted despite someone's keep), and
  **missing IDs** (no tvdb/tmdb/imdb id, so it can never match *arr), and
  **on disk, in neither** — a weekly *Disk scan* job checks the top level of each
  mapped library path for folders/files that neither the media server nor
  Sonarr/Radarr account for (forgotten downloads, leftovers from deletions).
  Matching is by folder/file **name** per library root (the three systems see
  different absolute paths for the same folder), well-known junk (`@eaDir`,
  `#recycle`, dotfiles…) is ignored, only unaccounted-for entries are sized, and
  if *most* of a root looks orphaned Keeparr assumes the storage mapping is wrong
  and skips the sizing instead of crawling your whole share. Needs the same
  library mounts + storage mappings the free-space report uses. Rows show
  **where the item lives on disk** — a compact path with the full one on hover;
  click to copy — and duplicate groups highlight the folder that differs, so you
  can tell a double-import (same folder) from two real copies (different
  folders) at a glance. Every table has **click-to-sort column headers** and
  **library / movie-vs-series filters**, so you can slice a category down to
  one library while cross-referencing against Sonarr/Radarr. The *arr-based
  categories appear only when Sonarr/Radarr is connected. Report-only, like
  everything else in Keeparr.
- **Size on disk** — series totals are summed across every episode; movies across
  all parts/versions. Shown as `x.xx GB` per card; aggregates auto-switch to TB.
- **Scheduled refresh jobs** — admins set a schedule (every N minutes, daily, or
  weekly at a set time) per job and run any on demand from **Settings → Jobs &
  Cache**: *Recently added scan* (cheap, every 5 min), *Full library scan* (daily
  3 AM), *Watch history* (4 AM), *Requests* (5 AM), *Library size* (the expensive
  per-show recompute, daily 6 AM), *Sonarr / Radarr* (7 AM), *Backup* (8 AM), and
  *Disk scan* (the disk-orphan check, weekly Sunday 9 AM).
  Clear the poster / Seerr / watch caches from the same page, and view app events
  under **Settings → Logs**. A **Recent activity** list shows the last runs + errors.
- **Sonarr / Radarr** (optional) — connect any number of Sonarr and Radarr instances
  to enrich **Browse**: each title gains its **quality** (movie file quality / series
  quality profile), **tags** (Anime, Bounty, whatever you use), and monitoring/status.
  Browse's **List** view shows them as columns (with a poster + click-to-sort
  headers) and adds **multi-select** source / tag / quality / **status** (ended vs
  continuing) / monitored filters, an **in / not-in-*arr** filter, and a **size
  mismatch** flag (when Plex's size and *arr's diverge — a likely partial/broken
  file) — the quality picker groups values by resolution (tick `1080p` to grab every
  1080p variant). Sort by size to find the biggest, highest-quality titles to
  downgrade; Grid view shows a small quality badge. **Big Picture** gains a **By
  quality** table (how much 2160p/1080p/… is on disk, not kept, and never watched),
  and **Settings → Match health** shows a summary right next to the instance
  config — how many titles matched, plus counts for "in *arr but not on the
  server" and items missing a tmdb/tvdb id — with a Resync button and a link to
  the **Problems** page for the full lists. Report-only; Keeparr never changes
  anything in *arr. Titles match on stable tvdb/tmdb ids; unmatched titles are fine
  to leave. All of this stays hidden until you connect an instance.
- **Watch history** — powers the Browse **Watched** filter, a small "watched" badge on
  cards, and the Big Picture **never watched by anyone** reclaim metric. On **Plex** this
  needs **Tautulli** (optional connector); on **Jellyfin/Emby** it comes natively from the
  server's own play data — no extra setup. All watch surfaces stay hidden when no watch
  source is available, so there's no dead UI.
- **Seerr/Overseerr** (optional) — badges titles you requested, and unlocks **"OK to
  delete"** so the original requester can release a title they're done with (see
  above). Cached locally and refreshed by the *Requests* job (so badges/requests
  reflect the last refresh, not live).
- **Self-hosting niceties** — standing [health checks](#health-checks) with fix-it
  links (⚠ chip in the top bar for admins), an update notice when a new release is
  out, scheduled [database backups](#backups) with one-click restore, an
  [API](#api) with interactive docs at `/api-docs`, first-class
  [reverse-proxy](#reverse-proxy) support, and **zero telemetry**.
- **UI polish** — **Auto / Light / Dark theme** plus a **color-impaired mode**
  (both per-user, in the avatar menu — no admin needed), toast feedback when an
  action fails or a backup finishes, relative timestamps with the exact time on
  hover, a searchable **Logs** viewer (level + keyword filters, auto-refresh with
  pause, copy-a-line, download as .txt), **installable as an app** (PWA manifest
  with Keep / Browse / Big Picture shortcuts), and press <kbd>?</kbd> anywhere for
  the keyboard-shortcuts cheat sheet (<kbd>/</kbd> jumps to search).

## Tech stack

| Layer     | Choice                                  |
| --------- | --------------------------------------- |
| Framework | Next.js 15 (App Router) + React 19 + TS |
| Storage   | SQLite via `better-sqlite3` (WAL)       |
| Styling   | Tailwind CSS                            |
| Tests     | Vitest (real in-memory SQLite, no mocks)|
| Deploy    | Single Docker container (Alpine)        |

## Local development

```bash
npm install
cp .env.example .env        # set SESSION_SECRET
npm run dev                 # http://localhost:3000
```

The SQLite db lives at `./data/keeparr.db` locally (gitignored).

First run: a setup step asks which media server you use — **Plex, Jellyfin, or Emby**.
Plex → sign in with Plex, then **Settings → Connections** → Discover & connect your
server (or host/port/SSL manually). Jellyfin/Emby → enter your server URL, then sign in
with a server account (the first user becomes the Owner/admin). Then optionally add
Seerr and any number of Sonarr/Radarr instances (and Tautulli, for Plex watch history —
Jellyfin/Emby report watch data natively) → on the **Connections** page pick which
libraries to track and map each to its on-disk path (for the free-space header) → in
**Settings → Jobs & Cache** hit **Run all now** (or run individual jobs).

## Local demo data (no Plex)

Want to click through the app without a Plex server? Load fake data and turn on
the dev auto-login:

```bash
npm run seed                       # fills ./data with ~100 movies / TV / anime
KEEPARR_DEV_LOGIN=1 npm run dev    # auto-logged-in at http://localhost:3000

# To click through the app as a Jellyfin (or Emby) backend instead of Plex:
KEEPARR_DEV_SERVER=jellyfin npm run seed
KEEPARR_DEV_LOGIN=1 npm run dev
```

- Posters are blank (no Plex to proxy), but everything else works — keep, "don't
  care", search, browse, sizes, library filters, the storage header (~75% full).
- Data lives only in `./data` (gitignored) and **persists** across restarts, so your
  toggles survive. `npm run seed -- --reset` wipes and reloads; or delete `./data`.
- **`KEEPARR_DEV_LOGIN` must never be set in production** — it bypasses login. Unset,
  it has no effect and the normal Plex login gate applies.

## Tests & build

```bash
npm test          # vitest
npm run build     # production build
npm run verify    # test + build (the same checks CI runs before publishing an image)
```

## Install

Prebuilt multi-arch images (amd64 + arm64) are published to
**`ghcr.io/drohack/keeparr`** on every push to main: `latest` (the stable
channel) plus immutable version tags (`0.3`, `0.3.6`, …).

### Unraid — Community Applications (recommended)

The easiest way to run Keeparr. Open **Apps** (Community Applications), search
**Keeparr**, and Install — or browse the listing at
[ca.unraid.net/apps/keeparr](https://ca.unraid.net/apps/keeparr). Pick a WebUI
port and an appdata path, hit Apply, and you're done; there are no required
secrets (see Notes below). Updates appear in the **Docker** tab like any other
container — pair with the *CA Auto Update Applications* plugin for hands-off
updates.

### Docker (any host)

Not on Unraid? Run the same published image directly:

```bash
docker run -d --name keeparr \
  -p 8767:3000 \
  -v /path/to/appdata/keeparr:/data \
  ghcr.io/drohack/keeparr:latest
```

…or with the repo's `docker-compose.yml`:

```bash
docker compose up -d                          # pulls ghcr.io/drohack/keeparr:latest
docker compose pull && docker compose up -d   # to update
```

### Build from source

To build the image yourself — for development, or a platform the published
image doesn't cover — clone the repo and build with the bundled Dockerfile
(`docker-compose.yml` has a commented `build: .` line for exactly this):

```bash
git clone https://github.com/drohack/Keeparr.git && cd Keeparr
docker build -t keeparr:local .
docker run -d --name keeparr -p 8767:3000 -v "$PWD/data:/data" keeparr:local
```

For iterating on the code without Docker, see
[Local development](#local-development).

Notes for every install method:

- **Secrets are auto-generated.** On first start the container creates a
  session secret and stores it at `/data/.session-secret` — it signs logins
  AND encrypts the stored media-server / Tautulli / Seerr / *arr tokens at
  rest, and it travels with your appdata. Set the `SESSION_SECRET` env var
  only if you want to manage it yourself, and **never change it once in
  use** (stored tokens would need re-entering). If you do set it, use a
  **high-entropy** value — `openssl rand -hex 32`. A weak secret is dangerous
  (it derives the encryption key too); in production Keeparr refuses to boot on
  the insecure default and warns on a secret under 32 characters.
- Persist `/data` (the SQLite database + poster cache + backups + secret).
- **File ownership (`PUID`/`PGID`).** The container starts as root only to fix
  ownership of the `/data` mount, then drops to `PUID:PGID` (default `1001:1001`)
  before running the app. On Unraid set `PUID=99` and `PGID=100` (`nobody:users`)
  to match your appdata; the Community Applications template exposes both. If you
  hit a permission error on a pre-existing `/data`, set these to the owner of that
  directory.
- **Complete first-run setup on a trusted network.** The first account to sign in
  becomes the admin/owner, so choose your server and log in as admin *before*
  exposing Keeparr to the internet.
- For the free-space header, mount media share(s) **read-only** (e.g.
  `/mnt/user/Movies:/media/movies:ro`) and map each library to its container
  path under **Settings → Connections**. Optional.
- Optional `APP_URL` sets the Plex auth `forwardUrl` for redirect-style logins.
- **Plain HTTP vs HTTPS:** the session cookie is only marked `Secure` when the
  request arrives over HTTPS (via `x-forwarded-proto` from a TLS reverse
  proxy), so plain-HTTP LAN access works fine.
- **Sessions** last 30 days. Normal **Log out** clears the current device; if you
  suspect a session was stolen, use **Sign out all devices** in the user menu — it
  invalidates every outstanding token for your account immediately.

**Migrating from a source-built deploy** (the old `docker compose up --build`
flow): stop the old container, copy its `data/` directory to the new `/data`
mount location (e.g. `/mnt/user/appdata/keeparr`), and carry the secret over —
either keep setting `SESSION_SECRET` to the **same value** from your old
`.env`, or write that value into `<appdata>/.session-secret` and drop the env
var. With those two carried over, everything (keeps, users, connections)
survives intact.

CI runs the full test suite before any image is built or pushed, so a failing
test never ships.

## Reverse proxy

Run Keeparr on its own **subdomain** (e.g. `keeparr.example.net`). Subpath
hosting (`example.net/keeparr`) is **not supported** — Next.js bakes the base
path in at build time, so like Overseerr/Jellyseerr (the same stack), Keeparr
is subdomain-only.

Keeparr is proxy-friendly out of the box: the session cookie is marked `Secure`
when the request arrives with `X-Forwarded-Proto: https`, so a TLS-terminating
proxy just works. Set **Application URL** (Settings → General, or the `APP_URL`
env var) to your public URL so the Plex sign-in redirect lands back on it.

**Nginx Proxy Manager**: add a Proxy Host for `keeparr.example.net` →
`http://<server-ip>:8767`, enable Websockets Support (harmless; Keeparr doesn't
need it) and your SSL cert. Done.

**nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name keeparr.example.net;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://127.0.0.1:8767;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Caddy**:

```caddy
keeparr.example.net {
    reverse_proxy 127.0.0.1:8767
}
```

## Backups

Everything Keeparr stores — keeps, users, watch/request caches, settings
(secrets stay encrypted) — lives in one SQLite file, so a backup is one file.

- The **Backup** job snapshots the database daily (08:00 by default; schedule it
  in Settings → Jobs) using SQLite's online-backup API — safe while the app runs.
- Old backups are pruned past the **retention** count (default 14, configurable
  in Settings → Jobs → Backups).
- **Settings → Jobs → Backups** lists snapshots with **Download / Restore /
  Delete**. Restore snapshots the current database first (`keeparr-pre-restore-…`)
  before replacing it, so a mistaken restore is itself reversible.
- Files live in `DATA_DIR/backups/` (`/data/backups` in Docker) — include that
  folder (or just `DATA_DIR`) in your host backup tool for off-box copies.

## API

Keeparr has a small JSON API. Interactive docs live at **`/api-docs`** (sign-in
required), backed by the OpenAPI spec at `/api/openapi.json` (also in the repo
root as `openapi.json`).

- Most endpoints use the session cookie from the web login.
- For automation, generate an **API key** (Settings → General → API access) and
  send it as the `X-Api-Key` header. It works on `GET/POST /api/admin/jobs`
  (read job status / trigger refreshes) and `GET /api/stats` (largest /
  reclaimable / never-watched / marked-for-delete views).

```bash
# Trigger the library scan from a cron/script:
curl -X POST -H "X-Api-Key: <key>" -H "Content-Type: application/json" \
  -d '{"job":"library"}' https://keeparr.example.net/api/admin/jobs
```

**Telemetry: none.** Keeparr never phones home; its only outbound call beyond
your own services is the GitHub release check for the update notice.

## Health checks

Admins get a standing **Health** card (Settings → Jobs) and a ⚠ chip in the top
bar when something needs attention. Each warning links to a section below.

### Media server not configured

No Plex/Jellyfin/Emby connection is stored, so nothing can sync. Connect your
server under **Settings → Connections** (Plex: sign in + pick the server;
Jellyfin/Emby: URL + credentials at first-run setup).

### A job is failing

A scheduled job's last run errored — the message shows the cause. Common ones:
the media server/Tautulli/Seerr/Sonarr/Radarr is unreachable (wrong URL/API key,
container down) or a network blip. Fix the connection under **Settings →
Connections**, then re-run the job from **Settings → Jobs**. The Logs tab has
the full history.

### A job is stale

The job hasn't succeeded in over twice its schedule. Usually the app was
stopped for a while (fine — it catches up), or the in-process scheduler is
stuck; restarting the container recovers it. Run the job manually from
**Settings → Jobs** to confirm it works.

### No storage mappings

Libraries are managed but no library is mapped to a disk path, so Big Picture
can't show capacity/free space. Mount your media shares into the container
(read-only) and map each library under **Settings → Connections → Storage**.

### Backups disabled

The Backup job is set to manual-only. Give it a schedule under **Settings →
Jobs** (daily is plenty) so your keeps/settings are snapshotted automatically.

### Updating

A newer release is out. Every push to `main` publishes a versioned image to
`ghcr.io/drohack/keeparr` — pull it and restart:

```bash
docker compose pull
docker compose up -d
```

(Unraid: update from the Community Applications / Docker tab as usual.) Your
data carries over (it lives in the mounted `data/` volume).

## How "size on disk" is computed

Plex stores file size on `Media[].Part[].size` (bytes). Movies have it inline;
series do not, so Keeparr calls `/library/metadata/{ratingKey}/allLeaves` once
per show and sums every episode's parts — counting each **physical file once**, so
a multi-episode file (where Plex reports the full size on every episode it holds)
isn't multiplied. Jellyfin/Emby work the same way via `MediaSources[].Size` (summed
across a series' episodes, deduped by file path). Results are cached in SQLite, so
pages read instantly. Because the per-show calls are the expensive part, the **Library size**
job is separate from the cheap **Full library scan** job — schedule the size
recompute less often (default daily at 6 AM) and the inventory refresh more often
(default daily at 3 AM, with the cheap *Recently Added* scan filling the gap every
5 minutes), or run either on demand. Jobs are checked each minute and fire
when due.

## Media item IDs (one backend per instance)

Keeparr targets a **single** media server per install (like Seerr's `mediaServerType`).
Internally every item is keyed by an opaque **`rating_key`** (a `TEXT` column): for Plex
that's the Plex `ratingKey`, for Jellyfin/Emby it's the stable Jellyfin item id. Nothing
parses or assumes a format, and only one backend is ever active in a database, so the ids
are always internally consistent — **no schema change is needed to support the three
backends** (cross-server matching for Sonarr/Radarr/Seerr uses the stable `tmdb`/`tvdb`
ids instead). Switching an existing install to a *different* backend would leave the old
backend's ids (and the keeps/watch tied to them) unmatched — so choose your backend at
setup and stick with it.

## Contributing

Issues and pull requests are welcome — it's meant to be a small, friendly
companion to the *arr / Plex self-hosting stack. Before opening a PR, run
`npm run verify` (tests + production build); the Docker image build also gates on
the test suite.

## License

[MIT](LICENSE) — free and open source. Use it, fork it, ship it.
