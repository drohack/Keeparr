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
- **Size on disk** — series totals are summed across every episode; movies across
  all parts/versions. Shown as `x.xx GB` per card; aggregates auto-switch to TB.
- **Scheduled refresh jobs** — admins set a schedule (every N minutes, or daily at a
  set time) per job and run any on demand from **Settings → Jobs & Cache**: *Recently
  Added* (cheap, every 5 min), *Plex Full Library Scan* (daily 3 AM), *Library size*
  (the expensive per-show recompute, daily 6 AM), *Tautulli* (4 AM), and *Seerr* (5 AM).
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
  and **Settings → Match health** shows how many matched, the titles that are
  **downloaded in *arr but not in Plex** (largest-first with sizes + a total — media on
  disk Plex can't see, so you can rescan/fix it), and a count of Plex items missing a
  tmdb/tvdb id (so you can fix them). Report-only; Keeparr never changes
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
npm run verify    # test + build (the same checks the Docker image gates on)
```

## Deploy to Unraid (Docker)

`docker compose` reads `SESSION_SECRET` from a `.env` file in the repo, so set it **once**
and never pass it inline (regenerating it on every run would rotate the key and invalidate
your stored tokens + sessions).

```bash
# First time only — on the server, from the repo:
cp .env.example .env
# edit .env and set SESSION_SECRET, e.g.:
#   echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env   (then remove the change-me line)
docker compose up -d --build
```

```bash
# Every update afterwards — pull the new code and rebuild/recreate the container:
git pull
docker compose up -d --build
```

`--build` rebuilds the image from the pulled source; `-d` runs it detached. The `.env`
secret is reused, so your data and stored tokens carry over untouched.

- Published on host port **8767** (`8767:3000`) — change in `docker-compose.yml`
  or put behind your reverse proxy.
- Persist the database by mounting `./data` → `/mnt/user/appdata/keeparr/data`.
- For the free-space header, mount your media share(s) **read-only** into the
  container (e.g. `/mnt/user/Movies:/media/movies:ro`) and map each library to its
  container path under **Settings → Connections** (Storage / free space). See the commented examples in
  `docker-compose.yml`. Without this, the storage header just prompts to configure.
- `SESSION_SECRET` is **required** (compose fails without it). It also encrypts
  the stored media-server / Tautulli / Seerr / *arr tokens at rest — rotating it means
  re-entering them.
- Optional `APP_URL` sets the Plex auth `forwardUrl` for redirect-style logins.
- **Plain HTTP vs HTTPS:** the session cookie is only marked `Secure` when the
  request arrives over HTTPS (detected via `x-forwarded-proto` from a TLS reverse
  proxy). Accessing directly over `http://<host>:<port>` on your LAN works — the
  cookie isn't forced Secure, so it isn't dropped. Behind a TLS proxy it's set
  Secure automatically.

The image build runs the test suite as a gate (`RUN npm test`), so a failing
test blocks the image.

## How "size on disk" is computed

Plex stores file size on `Media[].Part[].size` (bytes). Movies have it inline;
series do not, so Keeparr calls `/library/metadata/{ratingKey}/allLeaves` once
per show and sums every episode's parts — counting each **physical file once**, so
a multi-episode file (where Plex reports the full size on every episode it holds)
isn't multiplied. Jellyfin/Emby work the same way via `MediaSources[].Size` (summed
across a series' episodes, deduped by file path). Results are cached in SQLite, so
pages read instantly. Because the per-show calls are the expensive part, the **Series
sizes** job is separate from the cheap **Library data** job — schedule the size
recompute less often (default every 12h) and the inventory refresh more often
(default hourly), or run either on demand. Jobs are checked each minute and fire
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
