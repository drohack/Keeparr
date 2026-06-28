# Keeparr

A self-hosted web app that makes it dead-simple for a household to decide **what
media to keep** — and to find what can be safely deleted to reclaim disk space.

Users log in with their **Plex account** (Overseerr-style PIN OAuth). Keeparr
reads whatever Plex libraries you have, along with each series'/movie's
**total size on disk**, and shows simple poster cards. Tap the things worth
keeping; keeps are **per-user but protective** — an item is kept (safe) if
**anyone** keeps it, and you can only remove your own keep. Keep and "don't
care" are mutually exclusive per person. Everything nobody keeps shows up in a
**Reclaimable** report, largest first.

Keeparr **never deletes anything** — it only tags and reports. You delete
manually in Plex / Sonarr / Radarr.

## Features

- **Plex login** — PIN OAuth, like Overseerr/Jellyseerr. Only accounts with
  access to your Plex server can get in. The first user to log in becomes the
  **Owner** (admin). There are no local accounts and no sign-up — everyone uses
  their Plex account.
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
  recently added in either direction, and a single **Status** filter (defaults to
  **Undecided**, hiding what you've already kept or marked "don't care"; switch to
  Kept, Don't care, or All), plus **requested by me** in Seerr. Search always
  shows everything.
- **Keep / don't care** — a 3-state choice per card (nothing / keep / don't
  care). Keeps are per-user but protective: an item stays safe while anyone keeps
  it, and you only remove your own keep. Marking "don't care" clears your keep
  (and vice-versa) and greys the card.
- **Big Picture** — a dashboard: one honest disk bar (kept by you / kept by others
  / you don't care / undecided, with free as the empty remainder), your review
  progress, a "where your space goes" donut, and per-library breakdown cards with
  bars sized proportional to each library. The charts are interactive (hover to
  highlight a segment + see its size/share). Plus the drill-down tables: largest
  titles on disk, and what's not kept by anyone (largest first, running total).
- **Size on disk** — series totals are summed across every episode; movies across
  all parts/versions. Shown as `x.xx GB` per card; aggregates auto-switch to TB.
- **Scheduled refresh jobs** — admins set a schedule (every N minutes, or daily at a
  set time) per job and run any on demand from **Settings → Jobs & Cache**: *Recently
  Added* (cheap, every 5 min), *Plex Full Library Scan* (daily 3 AM), *Library size*
  (the expensive per-show recompute, daily 6 AM), *Tautulli* (4 AM), and *Seerr* (5 AM).
  Clear the poster / Seerr / watch caches from the same page, and view app events
  under **Settings → Logs**. A **Recent activity** list shows the last runs + errors.
- **Tautulli** (optional) — pulls watch history so your most-watched titles
  surface first in the keep loop.
- **Seerr/Overseerr** (optional) — badges titles you requested. Cached locally and
  refreshed by the *Requests* job (so badges reflect the last refresh, not live).

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

First run: log in with Plex (you become the Owner/admin) → **Settings → Connections**
→ Discover & connect your Plex server (or set host/port/SSL manually) → optionally add
Tautulli/Seerr → on the same **Connections** page pick which libraries to track and
map each to its on-disk path (for the free-space header) → in **Settings → Jobs &
Cache** hit **Run all now** (or run individual jobs).

## Local demo data (no Plex)

Want to click through the app without a Plex server? Load fake data and turn on
the dev auto-login:

```bash
npm run seed                       # fills ./data with ~100 movies / TV / anime
KEEPARR_DEV_LOGIN=1 npm run dev    # auto-logged-in at http://localhost:3000
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

```bash
# On the server, from the repo:
SESSION_SECRET="$(openssl rand -hex 32)" docker compose up -d --build
```

- Published on host port **8767** (`8767:3000`) — change in `docker-compose.yml`
  or put behind your reverse proxy.
- Persist the database by mounting `./data` → `/mnt/user/appdata/keeparr/data`.
- For the free-space header, mount your media share(s) **read-only** into the
  container (e.g. `/mnt/user/Movies:/media/movies:ro`) and map each library to its
  container path under **Settings → Connections** (Storage / free space). See the commented examples in
  `docker-compose.yml`. Without this, the storage header just prompts to configure.
- `SESSION_SECRET` is **required** (compose fails without it). It also encrypts
  the stored Plex/Tautulli/Seerr tokens at rest — rotating it means re-entering
  them.
- Optional `APP_URL` sets the Plex auth `forwardUrl` for redirect-style logins.

The image build runs the test suite as a gate (`RUN npm test`), so a failing
test blocks the image.

## How "size on disk" is computed

Plex stores file size on `Media[].Part[].size` (bytes). Movies have it inline;
series do not, so Keeparr calls `/library/metadata/{ratingKey}/allLeaves` once
per show and sums every episode's parts. Results are cached in SQLite, so pages
read instantly. Because the per-show calls are the expensive part, the **Series
sizes** job is separate from the cheap **Library data** job — schedule the size
recompute less often (default every 12h) and the inventory refresh more often
(default hourly), or run either on demand. Jobs are checked each minute and fire
when due.
