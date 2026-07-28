'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryKind, ProblemCategorySummary, ProblemType } from '@/lib/types';
import { formatRelative, formatSize } from '@/lib/format';
import { copyText } from '@/lib/clipboard';
import { normalizeName, pathSegments, pathTail } from '@/lib/paths';
import { useToast } from './Toaster';
import MultiSelect from './MultiSelect';

// Labels/hints name the ACTUAL connected media server ("Plex", "Jellyfin"…) —
// a bare "server" reads like the machine/filesystem. `server` comes from the
// summary endpoint's serverType.
const SERVER_NAME: Record<string, string> = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' };

const problemLabels = (server: string): Record<ProblemType, string> => ({
  sizeMismatch: 'Size mismatch',
  notInArr: `In ${server}, not in *arr`,
  missingFromPlex: `In *arr, not in ${server}`,
  identityMismatch: 'Identity mismatch',
  duplicates: 'Duplicates',
  arrConflicts: '*arr conflicts',
  zeroSize: 'Zero size',
  removedButKept: 'Removed but kept',
  missingIds: 'Missing IDs',
  diskOrphans: 'On disk, in neither',
});

// One short line above the active table explaining what the category means
// and what fixes it (the MatchHealthCard explainer convention).
const problemHints = (server: string): Record<ProblemType, string> => ({
  sizeMismatch: `${server} and Sonarr/Radarr report materially different sizes (>10% and >1 GB) for the same title. The "On disk" column is the measured truth (Disk scan job): whichever side it disagrees with needs a rescan. Movies flagged multi-part are expected to differ — ${server} merged several files into one item and sums them all.`,
  notInArr: `These titles exist in ${server} but no Sonarr/Radarr instance manages them — nothing will upgrade or re-download them.`,
  missingFromPlex: `Sonarr/Radarr tracks these but ${server} doesn't. Check "On disk": a real folder inside a library means ${server} needs a scan (or the folder was matched to something else — see Identity mismatch); "not found"/"empty" means the *arr's record is stale (Refresh & Scan there) or the files never left the download folder (import them into a library).`,
  identityMismatch: `The same folder is claimed under two different identities — ${server} matched it to one title/id, Sonarr/Radarr tracks another (each row shows both sides' ids). Fix whichever match is wrong (usually ${server}’s: ⋯ → Fix Match). Rows where you already fixed the match clear on the next Sonarr/Radarr sync — run it after a library sync so it sees the fresh ids.`,
  duplicates: `Two library entries share the same external id. The Location column shows where each copy lives — the same folder means a split/double-import in ${server} (merge the entries); different folders mean two real copies on disk. Click a path to copy it.`,
  arrConflicts: `Two Sonarr/Radarr records resolve to the same ${server} item. Across two instances that means both download and upgrade it independently; within ONE instance it means two of its titles match one ${server} item — usually a merged multi-part entry in ${server} that carries both ids.`,
  zeroSize: `${server} lists the title but reports zero file bytes — broken/missing files or a dead metadata-only entry.`,
  removedButKept: `Gone from ${server} while someone still keeps it — something protected got deleted anyway (or the item’s id changed in a rebuild).`,
  missingIds: `No TheTVDB/TMDB/IMDb id at all, so the title can never match Sonarr/Radarr — fix the match in ${server}.`,
  diskOrphans: `Top-level folders and files under your mapped library paths that neither ${server} nor Sonarr/Radarr account for. A "Looks like" match usually means a leftover old copy — the library already has that title in another folder, so verify and delete the leftover. If nearly everything here looks orphaned, check that library's storage mapping. Populated by the Disk scan job.`,
});

/** Fix-it instructions for pills that are visible but not yet runnable. */
const REASON_TIP: Record<NonNullable<ProblemCategorySummary['reason']>, string> = {
  storage_not_configured:
    'Map your libraries to disk paths in Settings → Connections, then run the Disk scan job.',
  not_scanned: 'Run the Disk scan job in Settings → Jobs (it also runs weekly).',
};

// --- Row shapes as /api/admin/problems returns them, per category ---
interface MediaRowBase {
  ratingKey: string;
  title: string;
  year: number | null;
  libraryKind: LibraryKind;
  thumbUrl: string | null;
  /** Full server-side folder path (null until a library scan captures it). */
  dirPath: string | null;
}
type SizeMismatchRow = MediaRowBase & {
  plexBytes: number;
  arrBytes: number;
  deltaBytes: number;
  source: string;
  instanceName: string;
  /** MEASURED size (Disk scan job) — the tiebreaker. Null until measured. */
  diskSizeBytes: number | null;
  diskCheckedAt: number | null;
  /** Movie: distinct video files merged into the item (>1 = multi-part, so the
   *  server's sum legitimately exceeds the *arr's one file). Null for shows. */
  fileCount: number | null;
};
type NotInArrRow = MediaRowBase & {
  sizeBytes: number;
  addedAt: number | null;
  /** Set when an unmatched *arr title claims this item's folder — the row is
   *  really the media half of an identity mismatch. */
  identityArrTitle: string | null;
};
interface MissingFromPlexRow {
  source: string;
  instanceName: string;
  title: string;
  extKind: string;
  extId: string;
  sizeBytes: number;
  /** Full folder path as the *arr sees it. */
  path: string | null;
  /** Disk reality check: null = not verified, false = folder missing, true = found. */
  onDisk: boolean | null;
  /** Measured size when found. */
  diskSizeBytes: number | null;
  /** Set when a media item claims this title's folder — the row is really the
   *  *arr half of an identity mismatch. */
  claimedByTitle: string | null;
}
interface DuplicateGroupRow {
  idKind: string;
  idValue: string;
  totalBytes: number;
  items: (MediaRowBase & { sizeBytes: number; addedAt: number | null })[];
}
interface ArrConflictViewRow {
  ratingKey: string;
  title: string;
  thumbUrl: string | null;
  winner: { source: string; instanceName: string };
  loser: { source: string; instanceName: string };
  /** Both claims from ONE instance: two *arr titles resolve to one server item
   *  (usually a merged multi-part entry), not an instance overlap. */
  sameInstance: boolean;
  sizeOnDisk: number;
}
type ZeroSizeRow = MediaRowBase & {
  addedAt: number | null;
  arrBytes: number | null;
  instanceName: string | null;
};
interface RemovedButKeptRow {
  ratingKey: string;
  title: string;
  year: number | null;
  libraryKind: LibraryKind;
  sizeBytes: number;
  /** Last-known folder path (the item is gone from the server; may be stale). */
  dirPath: string | null;
  keptBy: string[];
}
type MissingIdRow = MediaRowBase & { sizeBytes: number };
interface IdentityMismatchRow {
  media: MediaRowBase & {
    sizeBytes: number;
    /** The server's OWN ids (CSV possible) — shown so the disagreement with the
     *  *arr's id is visible instead of two identical-looking titles. */
    guidTmdb: string | null;
    guidTvdb: string | null;
    guidImdb: string | null;
  };
  arr: {
    title: string;
    source: string;
    instanceName: string;
    extKind: string;
    extId: string;
    downloaded: boolean;
    path: string | null;
  };
}
interface DiskOrphanViewRow {
  name: string;
  sectionId: string;
  path: string;
  isDir: boolean;
  sizeBytes: number;
  /** Circuit breaker recorded the name but skipped sizing (suspect mapping). */
  sizeSkipped: boolean;
  /** The library title this orphan LOOKS like — usually a leftover old copy. */
  likely: {
    ratingKey: string;
    title: string;
    year: number | null;
    sizeBytes: number;
    libraryKind: LibraryKind;
  } | null;
}

const kindLabel = (k: LibraryKind) => (k === 'movie' ? 'Movie' : 'Series');
const instLabel = (source: string, name: string) =>
  `${source === 'sonarr' ? 'Sonarr' : 'Radarr'} — ${name}`;

const within10 = (a: number, b: number) => Math.abs(a - b) <= 0.1 * Math.max(a, b, 1);

/** Which side does the MEASURED size agree with? That side is right. */
function mismatchVerdict(r: SizeMismatchRow, server: string): string {
  if (r.diskSizeBytes == null) return '';
  if (within10(r.diskSizeBytes, r.arrBytes)) {
    return `Disk agrees with the *arr — ${server}'s size is stale: Scan Library Files in ${server}`;
  }
  if (within10(r.diskSizeBytes, r.plexBytes)) {
    return `Disk agrees with ${server} — the *arr's record is stale: Refresh & Scan there`;
  }
  return 'Matches neither claim — likely partial or corrupted files';
}

/** A merged multi-part movie mismatches by construction: the server sums every
 *  file in the item, the *arr counts only its own. Nothing is stale. */
const isMultiPart = (r: SizeMismatchRow) =>
  r.libraryKind === 'movie' && r.fileCount != null && r.fileCount > 1;

/** Per-table view options, sent to the API. `sort: null` = category default. */
interface ViewState {
  hideMissingIds: boolean;
  sort: string | null;
  dir: 'asc' | 'desc';
  sections: string[];
  kind: '' | 'movie' | 'show';
}
const DEFAULT_VIEW: ViewState = {
  hideMissingIds: true,
  sort: null,
  dir: 'desc',
  sections: [],
  kind: '',
};

/** Name-ish columns read better ascending on first click. */
const defaultDirFor = (col: string): 'asc' | 'desc' =>
  col === 'title' || col === 'name' || col === 'instance' ? 'asc' : 'desc';

/** Categories whose rows aren't (single) media items — hide the N/A filters. */
const NO_LIBRARY_FILTER = new Set<ProblemType>(['missingFromPlex', 'arrConflicts']);
const NO_KIND_FILTER = new Set<ProblemType>(['diskOrphans', 'arrConflicts']);

/** The pill strip's three families (matches the summary's category order). */
const PILL_GROUPS: { label: (server: string) => string; types: ProblemType[] }[] = [
  {
    label: (s) => `${s} ↔ Sonarr/Radarr`,
    types: ['sizeMismatch', 'notInArr', 'missingFromPlex', 'identityMismatch', 'arrConflicts'],
  },
  {
    label: (s) => `Within ${s}`,
    types: ['duplicates', 'zeroSize', 'removedButKept', 'missingIds'],
  },
  { label: () => 'On disk', types: ['diskOrphans'] },
];

/** The row-level action: short visible label, long explanation on hover. */
function ActionBadge({
  label,
  tone,
  tip,
}: {
  label: string;
  tone: 'fix' | 'note';
  tip: string;
}) {
  return (
    <span
      className={`inline-block cursor-help whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${
        tone === 'fix' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-400'
      }`}
      title={tip}
    >
      {label}
    </span>
  );
}

export default function ProblemsView() {
  const [categories, setCategories] = useState<ProblemCategorySummary[] | null>(null);
  const [serverName, setServerName] = useState('Plex');
  const [active, setActive] = useState<ProblemType | null>(null);
  const [items, setItems] = useState<unknown[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Per-table view: sort (null = category default), library/kind filters, and
  // the notInArr-only "hide missing ids" toggle. Filters are sticky across
  // category switches; sort resets to the category default.
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [libraries, setLibraries] = useState<{ id: string; title: string }[]>([]);
  const toast = useToast();
  // Guards against out-of-order responses: only the latest request may commit
  // state (a slow old response must not clobber a newer one).
  const fetchSeq = useRef(0);

  useEffect(() => {
    fetch('/api/admin/problems/summary')
      .then((r) => r.json())
      .then((d) => {
        const cats: ProblemCategorySummary[] = Array.isArray(d.categories) ? d.categories : [];
        setCategories(cats);
        setServerName(SERVER_NAME[d.serverType] ?? 'Plex');
        // Open on the first category that actually has problems; fall back to
        // the first runnable one so the page never opens on the stub.
        const runnable = cats.filter((c) => c.available && !c.planned);
        const first = runnable.find((c) => c.titles > 0) ?? runnable[0];
        if (first) setActive(first.type);
      })
      .catch(() => toast("Couldn't load the problem summary — is the server reachable?", 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(
    async (type: ProblemType, reset: boolean, v: ViewState = view) => {
      const seq = ++fetchSeq.current;
      setLoading(true);
      const off = reset ? 0 : offset;
      const qs = new URLSearchParams({ type, offset: String(off) });
      if (type === 'notInArr' && !v.hideMissingIds) qs.set('includeMissingIds', '1');
      if (v.sort) {
        qs.set('sort', v.sort);
        qs.set('dir', v.dir);
      }
      if (v.sections.length && !NO_LIBRARY_FILTER.has(type)) {
        qs.set('sections', v.sections.join(','));
      }
      if (v.kind && !NO_KIND_FILTER.has(type)) qs.set('kind', v.kind);
      try {
        const data = await fetch(`/api/admin/problems?${qs.toString()}`).then(
          (r) => r.json()
        );
        if (seq !== fetchSeq.current) return; // superseded — drop it
        // An error response has no `items` — guard against a crash.
        const list = Array.isArray(data.items) ? data.items : [];
        setHasMore(!!data.hasMore);
        if (typeof data.nextOffset === 'number') setOffset(data.nextOffset);
        setItems((prev) => (reset ? list : [...prev, ...list]));
      } catch {
        if (seq !== fetchSeq.current) return; // superseded — don't toast for it
        toast("Couldn't load the problem list — is the server reachable?", 'error');
      } finally {
        if (seq === fetchSeq.current) setLoading(false);
      }
    },
    [offset, toast, view]
  );

  useEffect(() => {
    if (active) load(active, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    fetch('/api/sections')
      .then((r) => r.json())
      .then((d) => setLibraries(Array.isArray(d.sections) ? d.sections : []))
      .catch(() => {});
  }, []);

  // Row shapes differ per category, so the old category's rows must never
  // render under the new one's columns. Clearing here (not in the effect —
  // effects run AFTER the re-render) batches with setActive into one render.
  // Sort resets to the new category's default; filters stay sticky.
  const selectCategory = (t: ProblemType) => {
    if (t === active) return;
    setView((v) => ({ ...v, sort: null }));
    setItems([]);
    setHasMore(false);
    setActive(t);
  };

  /** Apply a view change and refetch page 1 with the NEW values (state alone
   *  would give load a stale closure). */
  const applyView = (patch: Partial<ViewState>) => {
    const next = { ...view, ...patch };
    setView(next);
    if (!active) return;
    setItems([]);
    setHasMore(false);
    load(active, true, next);
  };

  const onSort = (col: string) => {
    if (view.sort === col) {
      applyView({ dir: view.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      applyView({ sort: col, dir: defaultDirFor(col) });
    }
  };

  // Hide arr-gated categories entirely when unavailable (like Big Picture hides
  // its Tautulli/Seerr tabs); categories that just need setup (a reason) or are
  // planned stay visible but dimmed with a fix-it tooltip.
  const pills = (categories ?? []).filter((c) => c.available || c.planned || c.reason);
  const labels = problemLabels(serverName);
  const hints = problemHints(serverName);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Problems</h1>
        <p className="mt-1 text-sm text-slate-400">
          Server-maintenance checks — inconsistencies between your media server,
          Sonarr/Radarr, and Keeparr. Only admins see this page.
        </p>
      </div>

      <div>
        {/* The pill strip, grouped into its three natural families. */}
        <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
          {PILL_GROUPS.map((g) => {
            const groupPills = pills.filter((c) => g.types.includes(c.type));
            if (groupPills.length === 0) return null;
            return (
              <div key={g.types[0]}>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                  {g.label(serverName)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {groupPills.map((c) =>
                    !c.available ? (
                      <span
                        key={c.type}
                        className="rounded-md px-4 py-2 text-sm text-slate-400 opacity-50 cursor-default"
                        title={`${hints[c.type]}${c.reason ? ` ${REASON_TIP[c.reason]}` : ''}`}
                      >
                        {labels[c.type]}
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                          {c.planned
                            ? 'Planned'
                            : c.reason === 'not_scanned'
                              ? 'Not scanned'
                              : 'Setup needed'}
                        </span>
                      </span>
                    ) : (
                      <button
                        key={c.type}
                        onClick={() => selectCategory(c.type)}
                        className={`rounded-md px-4 py-2 text-sm ${
                          active === c.type
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {labels[c.type]}
                        <span className={active === c.type ? 'text-slate-400' : 'text-slate-500'}>
                          {' '}
                          · {c.titles}
                          {c.type === 'duplicates' && c.titles > 0 ? ' groups' : ''}
                          {c.bytes > 0 ? ` · ${formatSize(c.bytes)}` : ''}
                        </span>
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* What the selected check means — ABOVE the table so it's readable
            without scrolling past a long list. Per-category controls sit on the
            same line, right-aligned (hidden where they don't apply). */}
        {active && (
          <div className="mb-3 flex items-start justify-between gap-6">
            <p className="text-sm text-slate-400">{hints[active]}</p>
            <div className="flex shrink-0 items-center gap-3">
              {active === 'notInArr' && (
                <label
                  className="flex items-center gap-2 text-sm text-slate-400"
                  title="Titles with no tvdb/tmdb/imdb id can never match Sonarr/Radarr — see the Missing IDs check"
                >
                  <input
                    type="checkbox"
                    checked={view.hideMissingIds}
                    onChange={(e) => applyView({ hideMissingIds: e.target.checked })}
                  />
                  Hide titles with missing IDs
                </label>
              )}
              {!NO_KIND_FILTER.has(active) && (
                <select
                  value={view.kind}
                  onChange={(e) => applyView({ kind: e.target.value as ViewState['kind'] })}
                  className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">Movies & series</option>
                  <option value="movie">Movies</option>
                  <option value="show">Series</option>
                </select>
              )}
              {!NO_LIBRARY_FILTER.has(active) && libraries.length > 0 && (
                <MultiSelect
                  placeholder="All libraries"
                  summaryName="Libraries"
                  groups={[
                    { options: libraries.map((l) => ({ value: l.id, label: l.title })) },
                  ]}
                  selected={view.sections}
                  onChange={(next) => applyView({ sections: next })}
                />
              )}
            </div>
          </div>
        )}

        {active && categories && !loading && items.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">
            Nothing here — this check is clean. 🎉
          </p>
        ) : (
          active && (
            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <table className="w-full text-sm">
                <ProblemTable
                  type={active}
                  items={items}
                  server={serverName}
                  sort={view.sort}
                  dir={view.dir}
                  onSort={onSort}
                />
              </table>
            </div>
          )
        )}

        {hasMore && active && (
          <div className="text-center mt-6">
            <button
              onClick={() => load(active, false)}
              disabled={loading}
              className="rounded-md border border-slate-700 hover:border-slate-500 px-5 py-2 text-sm disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Shared cells ---

function Poster({ url }: { url: string | null }) {
  return (
    <td className="py-1 pl-3 pr-0 w-8">
      <div className="h-9 w-6 overflow-hidden rounded bg-slate-800">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
    </td>
  );
}

function TitleCell({ title, year }: { title: string; year?: number | null }) {
  return (
    <td className="px-3 py-2">
      <span className="font-medium">{title}</span>
      {year != null && <span className="text-slate-500"> ({year})</span>}
    </td>
  );
}

/** Compact, copyable path cell: shows the tail (last two segments, "…/tv/Scrubs"),
 *  full path on hover, click copies the whole path. With `dimPrefix` (the
 *  duplicates diff view) the FULL path renders with the group's shared prefix
 *  dimmed so the differing folder pops. */
function PathCell({ path, dimPrefix }: { path: string | null; dimPrefix?: string }) {
  const toast = useToast();
  if (!path) {
    return (
      <td className="px-3 py-2 font-mono text-xs">
        <span className="cursor-help text-slate-600" title="Captured on the next library scan">
          —
        </span>
      </td>
    );
  }
  const copy = async () => {
    toast((await copyText(path)) ? 'Path copied' : "Couldn't copy the path", 'info');
  };
  const dimmed = dimPrefix && path.startsWith(dimPrefix) && path.length > dimPrefix.length;
  return (
    <td className="px-3 py-2 font-mono text-xs">
      <button
        type="button"
        onClick={copy}
        title={`${path} (click to copy)`}
        className="max-w-full cursor-pointer truncate text-left text-slate-500 hover:text-slate-300"
      >
        {dimmed ? (
          <>
            <span className="text-slate-700">{dimPrefix}</span>
            <span className="text-slate-400">{path.slice(dimPrefix!.length)}</span>
          </>
        ) : (
          pathTail(path)
        )}
      </button>
    </td>
  );
}

/** Segment-wise longest common prefix of a group's paths (incl. the trailing
 *  separator), for the duplicates diff view. Needs ≥2 non-null paths that
 *  actually share a first segment; returns undefined otherwise. */
function commonPathPrefix(paths: (string | null)[]): string | undefined {
  const present = paths.filter((p): p is string => !!p);
  if (present.length < 2) return undefined;
  const split = present.map((p) => pathSegments(p));
  const first = split[0];
  let common = 0;
  while (common < first.length - 1 && split.every((s) => s[common] === first[common])) {
    common++;
  }
  if (common === 0) return undefined;
  // Rebuild the prefix from the ORIGINAL string so separators survive: cut the
  // first path right after its `common`-th segment.
  const src = present[0];
  let idx = 0;
  let seen = 0;
  while (seen < common && idx < src.length) {
    // Skip any leading separators, then one segment, then trailing separators.
    while (idx < src.length && /[/\\]/.test(src[idx])) idx++;
    while (idx < src.length && !/[/\\]/.test(src[idx])) idx++;
    seen++;
    while (idx < src.length && /[/\\]/.test(src[idx])) idx++;
  }
  return src.slice(0, idx);
}

function AddedCell({ addedAt }: { addedAt: number | null }) {
  return (
    <td className="px-3 py-2 text-right text-slate-400">
      {addedAt != null ? (
        <span title={new Date(addedAt * 1000).toLocaleString()}>{formatRelative(addedAt)}</span>
      ) : (
        <span className="text-slate-600">—</span>
      )}
    </td>
  );
}

const th = (label: string, align: 'left' | 'right' = 'left', extra = '') => (
  <th
    className={`${align === 'right' ? 'text-right' : 'text-left'} font-medium px-3 py-2 ${extra}`}
  >
    {label}
  </th>
);

/** A sortable column header: click to sort, shows the active arrow.
 *  (LibraryBrowser's SortTh, generalized over string sort keys.) */
function SortTh({
  col,
  align = 'left',
  sort,
  dir,
  onSort,
  children,
}: {
  col: string;
  align?: 'left' | 'right';
  sort: string | null;
  dir: 'asc' | 'desc';
  onSort: (c: string) => void;
  children: string;
}) {
  const active = sort === col;
  const arrow = active ? (dir === 'desc' ? ' ↓' : ' ↑') : '';
  return (
    <th
      className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-slate-300 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${active ? 'text-slate-300' : ''}`}
      onClick={() => onSort(col)}
      title="Sort by this column"
    >
      {children}
      {arrow}
    </th>
  );
}
const HEAD_CLS = 'bg-rail text-slate-500 text-xs uppercase tracking-wide';
const ROW_CLS = 'border-t border-slate-800 hover:bg-slate-900/60';

/** Per-category thead + tbody — the shapes are too different for one config. */
function ProblemTable({
  type,
  items,
  server,
  sort,
  dir,
  onSort,
}: {
  type: ProblemType;
  items: unknown[];
  server: string;
  sort: string | null;
  dir: 'asc' | 'desc';
  onSort: (c: string) => void;
}) {
  const sortProps = { sort, dir, onSort };
  switch (type) {
    case 'sizeMismatch': {
      const rows = items as SizeMismatchRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              <SortTh col="title" {...sortProps}>Title</SortTh>
              {th('Kind')}
              {th('Location')}
              <SortTh col="size" align="right" {...sortProps}>{`${server} size`}</SortTh>
              <SortTh col="arrSize" align="right" {...sortProps}>*arr size</SortTh>
              <SortTh col="delta" align="right" {...sortProps}>Δ</SortTh>
              {th('On disk', 'right')}
              {th('Instance')}
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ratingKey} className={ROW_CLS}>
                <Poster url={r.thumbUrl} />
                <TitleCell title={r.title} year={r.year} />
                <td className="px-3 py-2 text-slate-400">{kindLabel(r.libraryKind)}</td>
                <PathCell path={r.dirPath} />
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.plexBytes)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.arrBytes)}</td>
                <td
                  className={`px-3 py-2 text-right font-mono ${
                    r.deltaBytes > 0 ? 'text-rose-300' : 'text-amber-300'
                  }`}
                  title={
                    r.deltaBytes > 0
                      ? `${server} sees more than *arr does`
                      : `*arr has more on disk than ${server} sees`
                  }
                >
                  {r.deltaBytes > 0 ? '+' : '−'}
                  {formatSize(Math.abs(r.deltaBytes))}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.diskSizeBytes == null ? (
                    <span
                      className="cursor-help text-slate-600"
                      title="Not measured yet — the Disk scan job walks these folders"
                    >
                      —
                    </span>
                  ) : (
                    <span className="cursor-help" title={mismatchVerdict(r, server)}>
                      {formatSize(r.diskSizeBytes)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-300">{instLabel(r.source, r.instanceName)}</td>
                <td className="px-3 py-2">
                  {isMultiPart(r) ? (
                    <ActionBadge
                      label={`Multi-part item (${r.fileCount} files) — likely fine`}
                      tone="note"
                      tip={`${server} merged ${r.fileCount} video files into this one item and sums them all; the *arr counts only its own file, so the sizes differ by design. If the merge is intentional, nothing to fix — otherwise split the item apart in ${server}.`}
                    />
                  ) : r.diskSizeBytes == null ? (
                    <ActionBadge
                      label="Run Disk scan"
                      tone="note"
                      tip="The measured on-disk size decides which side is stale — the Disk scan job (Settings → Jobs) walks these folders"
                    />
                  ) : within10(r.diskSizeBytes, r.arrBytes) ? (
                    <ActionBadge label={`Rescan ${server}`} tone="fix" tip={mismatchVerdict(r, server)} />
                  ) : within10(r.diskSizeBytes, r.plexBytes) ? (
                    <ActionBadge label="Rescan *arr" tone="fix" tip={mismatchVerdict(r, server)} />
                  ) : (
                    <ActionBadge label="Check files" tone="fix" tip={mismatchVerdict(r, server)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
    case 'notInArr': {
      const rows = items as NotInArrRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              <SortTh col="title" {...sortProps}>Title</SortTh>
              {th('Kind')}
              {th('Location')}
              <SortTh col="size" align="right" {...sortProps}>Size</SortTh>
              <SortTh col="added" align="right" {...sortProps}>Added</SortTh>
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ratingKey} className={ROW_CLS}>
                <Poster url={r.thumbUrl} />
                <TitleCell title={r.title} year={r.year} />
                <td className="px-3 py-2 text-slate-400">{kindLabel(r.libraryKind)}</td>
                <PathCell path={r.dirPath} />
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.sizeBytes)}</td>
                <AddedCell addedAt={r.addedAt} />
                <td className="px-3 py-2">
                  {r.identityArrTitle ? (
                    <ActionBadge
                      label="Fix match — see Identity mismatch"
                      tone="fix"
                      tip={`An unmatched *arr title ("${r.identityArrTitle}") claims this item's folder — the two disagree about what it is. The real fix is on the Identity mismatch check.`}
                    />
                  ) : (
                    <ActionBadge
                      label="Add to *arr — or ignore"
                      tone="note"
                      tip="Nothing manages this title, so it won't be upgraded or re-downloaded. Add it to Sonarr/Radarr if you want that — or leave it if you don't."
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
    case 'missingFromPlex': {
      const rows = items as MissingFromPlexRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              <SortTh col="title" {...sortProps}>Title</SortTh>
              <SortTh col="instance" {...sortProps}>Instance</SortTh>
              {th('Location')}
              {th('External id')}
              <SortTh col="size" align="right" {...sortProps}>Size in *arr</SortTh>
              {th('On disk', 'right')}
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.instanceName}-${r.extKind}-${r.extId}`} className={ROW_CLS}>
                <TitleCell title={r.title} />
                <td className="px-3 py-2 text-slate-300">{instLabel(r.source, r.instanceName)}</td>
                <PathCell path={r.path} />
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {r.extKind}:{r.extId}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.sizeBytes)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.onDisk == null ? (
                    <span
                      className="cursor-help text-slate-600"
                      title="Not verified yet — run the Sonarr/Radarr or Disk scan job (needs storage mappings)"
                    >
                      —
                    </span>
                  ) : !r.onDisk ? (
                    <span
                      className="cursor-help text-amber-400"
                      title="Folder not found under any mapped library — the *arr's record is stale (Refresh & Scan there) or the files never reached a library folder (import them)"
                    >
                      not found
                    </span>
                  ) : (r.diskSizeBytes ?? 0) < 10 * 1024 * 1024 ? (
                    <span
                      className="cursor-help text-amber-400"
                      title="Folder exists but is essentially empty — the *arr's record is stale: Refresh & Scan there"
                    >
                      empty
                    </span>
                  ) : (
                    <span
                      className="cursor-help"
                      title={`Files really are on disk — ${server} needs a library scan (or matched this folder to something else: see Identity mismatch)`}
                    >
                      {formatSize(r.diskSizeBytes ?? 0)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.claimedByTitle ? (
                    <ActionBadge
                      label="Fix match — see Identity mismatch"
                      tone="fix"
                      tip={`${server} has this folder matched as "${r.claimedByTitle}" — the two disagree about what it is. The real fix is on the Identity mismatch check.`}
                    />
                  ) : r.onDisk === false || (r.onDisk === true && (r.diskSizeBytes ?? 0) < 10 * 1024 * 1024) ? (
                    <ActionBadge
                      label="Refresh & Scan in *arr"
                      tone="fix"
                      tip="The folder is missing or empty on disk — the *arr's record is stale (files were removed outside it). Refresh & Scan the title there and it clears."
                    />
                  ) : r.onDisk === true ? (
                    <ActionBadge
                      label={`Scan ${server} library`}
                      tone="fix"
                      tip={`The files really exist — ${server} just hasn't indexed them. Scan Library Files (and check the folder is inside a library path).`}
                    />
                  ) : (
                    <ActionBadge
                      label="Verify: run Disk scan"
                      tone="note"
                      tip="Whether the files actually exist decides the fix — run the Sonarr/Radarr or Disk scan job to check (needs storage mappings)."
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
    case 'identityMismatch': {
      const rows = items as IdentityMismatchRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              {th('Folder')}
              <SortTh col="title" {...sortProps}>{`${server} says`}</SortTh>
              {th('*arr says')}
              {th('Downloaded', 'right')}
              <SortTh col="size" align="right" {...sortProps}>Size</SortTh>
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ids = [
                r.media.guidTmdb ? `tmdb:${r.media.guidTmdb}` : null,
                r.media.guidTvdb ? `tvdb:${r.media.guidTvdb}` : null,
                r.media.guidImdb ? `imdb:${r.media.guidImdb}` : null,
              ].filter(Boolean);
              return (
              <tr key={`${r.media.ratingKey}-${r.arr.extId}-${i}`} className={ROW_CLS}>
                <Poster url={r.media.thumbUrl} />
                <PathCell path={r.media.dirPath} />
                <td className="px-3 py-2">
                  <span className="text-slate-300">{r.media.title}</span>
                  {r.media.year != null ? (
                    <span className="text-slate-500"> ({r.media.year})</span>
                  ) : null}{' '}
                  {ids.length > 0 ? (
                    <span
                      className="cursor-help font-mono text-xs text-slate-500"
                      title={`${server}'s own external ids for this item — compare with the *arr's id in the next column`}
                    >
                      · {ids.join(' · ')}
                    </span>
                  ) : (
                    <span
                      className="cursor-help text-xs text-slate-600"
                      title={`${server} has no tmdb/tvdb/imdb id for this item — it can never match the *arr's entry`}
                    >
                      · no external ids
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="text-slate-300">{r.arr.title}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {instLabel(r.arr.source, r.arr.instanceName)} ·{' '}
                    <span className="font-mono text-xs">
                      {r.arr.extKind}:{r.arr.extId}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {r.arr.downloaded ? (
                    <span className="text-slate-300">✓</span>
                  ) : (
                    <span
                      className="cursor-help text-slate-600"
                      title="In *arr but no files — added, never imported"
                    >
                      —
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatSize(r.media.sizeBytes)}
                </td>
                <td className="px-3 py-2">
                  <ActionBadge
                    label={`Fix match in ${server}`}
                    tone="fix"
                    tip={`${server} matched this folder to "${r.media.title}" while the *arr tracks "${r.arr.title}" — one is wrong (usually ${server}: ⋯ → Fix Match on the item).`}
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </>
      );
    }
    case 'duplicates': {
      const groups = items as DuplicateGroupRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              {th('Title')}
              {th('Kind')}
              {th('Location')}
              {th('Size', 'right')}
              {th('Added', 'right')}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={`${g.idKind}-${g.idValue}`} group={g} server={server} />
            ))}
          </tbody>
        </>
      );
    }
    case 'arrConflicts': {
      const rows = items as ArrConflictViewRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              <SortTh col="title" {...sortProps}>Title</SortTh>
              {th('Matched to')}
              {th('Also claimed by')}
              <SortTh col="size" align="right" {...sortProps}>Size on disk</SortTh>
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.ratingKey}-${i}`} className={ROW_CLS}>
                <Poster url={r.thumbUrl} />
                <TitleCell title={r.title} />
                <td className="px-3 py-2 text-slate-300">
                  {instLabel(r.winner.source, r.winner.instanceName)}
                </td>
                <td className="px-3 py-2 text-slate-300">
                  {instLabel(r.loser.source, r.loser.instanceName)}
                  {r.sameInstance ? (
                    <span
                      className="cursor-help text-slate-500"
                      title={`The same instance has a SECOND title ("${r.title}") that also resolves to this ${server} item`}
                    >
                      {' '}
                      · 2nd title, same instance
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.sizeOnDisk)}</td>
                <td className="px-3 py-2">
                  {r.sameInstance ? (
                    <ActionBadge
                      label={`Merged item? Split apart in ${server}`}
                      tone="fix"
                      tip={`Two ${r.loser.source === 'sonarr' ? 'Sonarr' : 'Radarr'} titles both match this one ${server} item — usually ${server} merged several entries into one (e.g. a multi-part film carrying both ids). Split the item apart in ${server} so each title matches its own, or remove one of the two titles in the *arr.`}
                    />
                  ) : (
                    <ActionBadge
                      label="Remove from one instance"
                      tone="fix"
                      tip="Both instances download and upgrade this title independently — unmonitor or delete it in the instance that shouldn't own it."
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
    case 'zeroSize': {
      const rows = items as ZeroSizeRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              <SortTh col="title" {...sortProps}>Title</SortTh>
              {th('Kind')}
              {th('Location')}
              {th('In *arr', 'right')}
              <SortTh col="added" align="right" {...sortProps}>Added</SortTh>
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ratingKey} className={ROW_CLS}>
                <Poster url={r.thumbUrl} />
                <TitleCell title={r.title} year={r.year} />
                <td className="px-3 py-2 text-slate-400">{kindLabel(r.libraryKind)}</td>
                <PathCell path={r.dirPath} />
                <td className="px-3 py-2 text-right font-mono">
                  {r.arrBytes != null ? (
                    <span
                      className="cursor-help"
                      title={`${r.instanceName ?? 'The *arr'} reports this much on disk for the title`}
                    >
                      {formatSize(r.arrBytes)}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <AddedCell addedAt={r.addedAt} />
                <td className="px-3 py-2">
                  {r.arrBytes != null && r.arrBytes > 0 ? (
                    <ActionBadge
                      label={`${server} sees no files — rescan`}
                      tone="fix"
                      tip={`${r.instanceName ?? 'The *arr'} has ${formatSize(r.arrBytes)} on disk for this title, but ${server} indexes nothing — Scan Library Files, and check the folder if that doesn't fix it.`}
                    />
                  ) : (
                    <ActionBadge
                      label="Check folder / remove entry"
                      tone="note"
                      tip="No files anywhere we can see — check the Location for stray files; if the entry is a dead metadata-only shell, remove it from the library."
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
    case 'removedButKept': {
      const rows = items as RemovedButKeptRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              <SortTh col="title" {...sortProps}>Title</SortTh>
              {th('Kind')}
              {th('Last known location')}
              <SortTh col="size" align="right" {...sortProps}>Last known size</SortTh>
              {th('Kept by')}
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ratingKey} className={ROW_CLS}>
                <TitleCell title={r.title} year={r.year} />
                <td className="px-3 py-2 text-slate-400">{kindLabel(r.libraryKind)}</td>
                <PathCell path={r.dirPath} />
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.sizeBytes)}</td>
                <td className="px-3 py-2 text-slate-300">{r.keptBy.join(', ') || '—'}</td>
                <td className="px-3 py-2">
                  <ActionBadge
                    label="Re-add it — or release the keep"
                    tone="note"
                    tip="Someone still keeps this but it's gone from the server. Re-download it if the deletion was a mistake; otherwise the keeper can release their keep. (If the server merely rebuilt its ids, the next scans self-heal.)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
    case 'diskOrphans': {
      const rows = items as DiskOrphanViewRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              <SortTh col="name" {...sortProps}>Name</SortTh>
              {th('Looks like')}
              {th('Kind')}
              {th('Path')}
              <SortTh col="size" align="right" {...sortProps}>Size</SortTh>
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} className={ROW_CLS}>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2">
                  {r.likely ? (
                    <span
                      className="cursor-help"
                      title={`The library already has "${r.likely.title}" (${formatSize(
                        r.likely.sizeBytes
                      )}) in another folder — this entry is probably a leftover old copy; verify, then delete it`}
                    >
                      <span className="text-slate-300">{r.likely.title}</span>
                      {r.likely.year != null && (
                        <span className="text-slate-500"> ({r.likely.year})</span>
                      )}
                      <span className="text-slate-500">
                        {' '}
                        · {formatSize(r.likely.sizeBytes)} in library
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-400">{r.isDir ? 'Folder' : 'File'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.path}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.sizeSkipped ? (
                    <span
                      className="cursor-help text-slate-600"
                      title="Sizing skipped — most of this root looked orphaned, so the storage mapping is suspect. Fix the mapping and rerun the Disk scan."
                    >
                      —
                    </span>
                  ) : (
                    formatSize(r.sizeBytes)
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.sizeSkipped ? (
                    <ActionBadge
                      label="Check storage mapping"
                      tone="fix"
                      tip="Most of this root looked orphaned — the mapping probably points at the wrong folder. Fix it in Settings → Connections and rerun the Disk scan."
                    />
                  ) : r.likely ? (
                    <ActionBadge
                      label="Leftover copy — verify & delete"
                      tone="fix"
                      tip={`The library already has "${r.likely.title}" (${formatSize(r.likely.sizeBytes)}) in another folder — this is probably an old copy nothing points at. Verify, then delete it.`}
                    />
                  ) : (
                    <ActionBadge
                      label="Unclaimed — review"
                      tone="note"
                      tip="Neither the media server nor Sonarr/Radarr accounts for this. Look inside: import it if it's wanted media, delete it if it's junk."
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
    default: {
      const rows = items as MissingIdRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              <SortTh col="title" {...sortProps}>Title</SortTh>
              {th('Kind')}
              {th('Location')}
              <SortTh col="size" align="right" {...sortProps}>Size</SortTh>
              {th('What to do')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ratingKey} className={ROW_CLS}>
                <Poster url={r.thumbUrl} />
                <TitleCell title={r.title} year={r.year} />
                <td className="px-3 py-2 text-slate-400">{kindLabel(r.libraryKind)}</td>
                <PathCell path={r.dirPath} />
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.sizeBytes)}</td>
                <td className="px-3 py-2">
                  <ActionBadge
                    label={`Fix match in ${server} — or ignore`}
                    tone="note"
                    tip={`No TheTVDB/TMDB/IMDb id at all, so it can never match Sonarr/Radarr. Fix the match in ${server} if it matters — home videos and one-offs are fine to leave.`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </>
      );
    }
  }
}

/** One duplicate group: a full-width header row (with the group's verdict
 *  badge), then its member rows. The members' shared path prefix is dimmed so
 *  the differing folder pops — identical locations mean a split entry,
 *  different ones mean two real copies. */
function GroupRows({ group, server }: { group: DuplicateGroupRow; server: string }) {
  const dimPrefix = commonPathPrefix(group.items.map((m) => m.dirPath));
  const paths = group.items.map((m) => m.dirPath);
  const knownPaths = paths.filter((p): p is string => !!p);
  const samePlace =
    knownPaths.length === group.items.length &&
    new Set(knownPaths.map((p) => normalizeName(p))).size === 1;
  return (
    <>
      <tr className="border-t border-slate-800 bg-slate-900/60">
        <td colSpan={6} className="px-3 py-1.5 text-xs text-slate-400">
          <div className="flex items-center justify-between gap-4">
            <span>
              <span className="font-mono">{group.idKind}:{group.idValue}</span>
              <span className="text-slate-500">
                {' '}
                · {group.items.length} copies · {formatSize(group.totalBytes)}
              </span>
            </span>
            {knownPaths.length < group.items.length ? (
              <ActionBadge
                label="Compare folders"
                tone="note"
                tip="Some locations aren't captured yet — run a Full library scan (and Library size for shows), then the verdict appears here."
              />
            ) : samePlace ? (
              <ActionBadge
                label={`Split entry — merge in ${server}`}
                tone="fix"
                tip={`Both entries point at the SAME folder — one import got split in two. Merge them (or Fix Match one) in ${server}; no disk space is wasted.`}
              />
            ) : (
              <ActionBadge
                label="Two copies — keep one?"
                tone="fix"
                tip="Different folders = two real copies on disk. Delete the one you don't want — unless this is an intentional multi-edition setup (e.g. 4K + 1080p in separate libraries)."
              />
            )}
          </div>
        </td>
      </tr>
      {group.items.map((m) => (
        <tr key={m.ratingKey} className={ROW_CLS}>
          <Poster url={m.thumbUrl} />
          <TitleCell title={m.title} year={m.year} />
          <td className="px-3 py-2 text-slate-400">{kindLabel(m.libraryKind)}</td>
          <PathCell path={m.dirPath} dimPrefix={dimPrefix} />
          <td className="px-3 py-2 text-right font-mono">{formatSize(m.sizeBytes)}</td>
          <AddedCell addedAt={m.addedAt} />
        </tr>
      ))}
    </>
  );
}
