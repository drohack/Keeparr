# Keeparr roadmap

Platform/polish gaps identified by comparing Keeparr against the conventions of
Sonarr/Radarr (Servarr) and Overseerr/Jellyseerr/Seerr (July 2026 research pass).
Core keep/reclaim functionality is considered complete; these are the "edge"
features self-hosters expect.

**Status (July 2026):** Tiers 1 and 2 are implemented, merged to `main`, and
shipping - continuous delivery tags a release + publishes a ghcr image on every
push (v0.2.x to v0.3.x are live). Tier 3 is deliberately parked - decided July
2026 that none of it is needed for how Keeparr is used today; revisit on real
demand.

## Tier 1 - done (v0.2.0)

- [x] **Health checks** - `lib/health.ts` + `/api/admin/health`; warning chip in the
  top bar (admins) + Health card on Settings -> Jobs, each warning linking to a
  README fix-it anchor. (Servarr System -> Status -> Health pattern.)
- [x] **Version-available check** - GitHub Releases via `lib/version.ts`
  (cached ~6h, never throws); surfaced on About + as a health warning.
- [x] **Backup & restore** - daily `backup` job (retention setting),
  Settings -> Jobs -> Backups card with create/download/delete/restore
  (restore keeps a pre-restore safety snapshot).
- [x] **Reverse-proxy docs** - README section (NPM/nginx/Caddy, subdomain-only
  stance); cookies were already `x-forwarded-proto`-aware.
- [x] **API docs** - hand-written `openapi.json` served at `/api/openapi.json`,
  rendered by Scalar at `/api-docs`; API-key regenerate already existed.

## Tier 2 - done (v0.3.0)

- [x] **Logs viewer upgrades** - keyword search (`?q=`), auto-refresh with
  pause, copy-per-row, download as .txt (exports the DB log; there is no
  on-disk file), relative timestamps.
- [x] **Theme: Auto / Light / Dark** + **color-impaired mode** - CSS-variable
  palette remap (`data-theme`/`data-cim` on <html>), per-user via the avatar
  menu; zero per-component churn.
- [x] **Toasts** (dependency-free Toaster) for silent-failure paths +
  **relative dates** with absolute-on-hover (no extra preference needed).
- [x] **PWA manifest** - `app/manifest.ts` + generated icons (incl. maskable
  + apple-touch), Keep/Browse/Big Picture shortcuts.
- [x] **`?` keyboard-shortcuts overlay** (+ `/` focuses search).

## Tier 3 - parked (decided July 2026: not needed for now)

- **"Show Advanced Settings" toggle** - progressive disclosure of power-user
  fields (Servarr pattern); the Settings surface doesn't warrant it yet.
- **Subpath hosting** (`example.net/keeparr`) - Next.js bakes `basePath` at
  build time and every client `fetch('/api/...')` would need a prefix helper;
  Overseerr/Jellyseerr (same stack) never shipped it either. Subdomain-only is
  the documented stance; revisit only if real subpath demand shows up.
- **Read-only / guest permission level** - one step beyond binary admin
  (top Sonarr community wish). Full Seerr-style permission bitmask judged
  overkill for a keep-tagging tool.
- **Notifications** - Webhook + Discord + ntfy agents with per-event opt-in.
  Natural events: "title marked OK-to-delete", weekly reclaimable digest,
  health issue, low disk space.
- **SSO / forward-auth compatibility** - honor a reverse-proxy auth header
  (Authelia/Authentik). Loudest open auth wish across all three peer projects;
  Keeparr's media-server login sidesteps most of the need.
- **Prometheus `/metrics` endpoint** - niche but rising expectation.
- **Maintainerr integration** - Keeparr collects the human decisions;
  [Maintainerr](https://github.com/jorenn92/Maintainerr) executes deletions
  (rules -> collections -> grace period -> delete/unmonitor/clear-request).
  Hooking them together closes the loop while preserving Keeparr's
  never-deletes stance: Keeparr marks what's safe to reclaim, Maintainerr does
  the maintenance. Candidate mechanisms (research when un-parked): Keeparr
  applies a **Plex label/collection** (e.g. `keeparr-release`) to titles that
  are OK-to-delete + kept by nobody, which a Maintainerr rule can match; or
  push via Maintainerr's API if it grows an external-source rule input. Needs
  care: the label must be REMOVED the moment anyone keeps the title (keeps are
  protective), and this would be Keeparr's first write to the media server -
  gate it behind an explicit opt-in setting.

Of these, **notifications** delivers the most day-to-day value if ever
un-parked (a weekly reclaimable digest fits Keeparr's purpose),
**read-only guest** is the cheapest to build, and **Maintainerr integration**
is the most strategically interesting (turns Keeparr's report into automated
maintenance without Keeparr itself ever deleting).

## Explicitly not doing

- **Analytics/telemetry toggle** - Keeparr collects nothing, so there is
  nothing to toggle. README states the no-telemetry stance instead.
- **Calendar / iCal feed** - doesn't map to the keep/reclaim domain.
