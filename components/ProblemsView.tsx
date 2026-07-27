'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryKind, ProblemCategorySummary, ProblemType } from '@/lib/types';
import { formatRelative, formatSize } from '@/lib/format';
import { copyText } from '@/lib/clipboard';
import { pathSegments, pathTail } from '@/lib/paths';
import { useToast } from './Toaster';

// Labels/hints name the ACTUAL connected media server ("Plex", "Jellyfin"…) —
// a bare "server" reads like the machine/filesystem. `server` comes from the
// summary endpoint's serverType.
const SERVER_NAME: Record<string, string> = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' };

const problemLabels = (server: string): Record<ProblemType, string> => ({
  sizeMismatch: 'Size mismatch',
  notInArr: `In ${server}, not in *arr`,
  missingFromPlex: `In *arr, not in ${server}`,
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
  sizeMismatch: `${server} and Sonarr/Radarr report materially different sizes (>10% and >1 GB) for the same title — often a partial/broken file or one side needing a rescan.`,
  notInArr: `These titles exist in ${server} but no Sonarr/Radarr instance manages them — nothing will upgrade or re-download them.`,
  missingFromPlex: `Downloaded in Sonarr/Radarr (files on disk, per *arr) but not present in ${server} — usually a library path ${server} doesn’t scan, or a failed import.`,
  duplicates: `Two library entries share the same external id. The Location column shows where each copy lives — the same folder means a split/double-import in ${server} (merge the entries); different folders mean two real copies on disk. Click a path to copy it.`,
  arrConflicts:
    'Two Sonarr/Radarr instances both manage this title — they can download and upgrade it independently, wasting space and bandwidth.',
  zeroSize: `${server} lists the title but reports zero file bytes — broken/missing files or a dead metadata-only entry.`,
  removedButKept: `Gone from ${server} while someone still keeps it — something protected got deleted anyway (or the item’s id changed in a rebuild).`,
  missingIds: `No TheTVDB/TMDB/IMDb id at all, so the title can never match Sonarr/Radarr — fix the match in ${server}.`,
  diskOrphans: `Top-level folders and files under your mapped library paths that neither ${server} nor Sonarr/Radarr account for. Matching is by name; if nearly everything here looks orphaned, check that library's storage mapping. Populated by the Disk scan job.`,
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
};
type NotInArrRow = MediaRowBase & { sizeBytes: number; addedAt: number | null };
interface MissingFromPlexRow {
  source: string;
  instanceName: string;
  title: string;
  extKind: string;
  extId: string;
  sizeBytes: number;
  /** Full folder path as the *arr sees it. */
  path: string | null;
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
  sizeOnDisk: number;
}
type ZeroSizeRow = MediaRowBase & { addedAt: number | null };
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
interface DiskOrphanViewRow {
  name: string;
  sectionId: string;
  path: string;
  isDir: boolean;
  sizeBytes: number;
  /** Circuit breaker recorded the name but skipped sizing (suspect mapping). */
  sizeSkipped: boolean;
}

const kindLabel = (k: LibraryKind) => (k === 'movie' ? 'Movie' : 'Series');
const instLabel = (source: string, name: string) =>
  `${source === 'sonarr' ? 'Sonarr' : 'Radarr'} — ${name}`;

export default function ProblemsView() {
  const [categories, setCategories] = useState<ProblemCategorySummary[] | null>(null);
  const [serverName, setServerName] = useState('Plex');
  const [active, setActive] = useState<ProblemType | null>(null);
  const [items, setItems] = useState<unknown[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // notInArr only: items with no external id can never match *arr, so they
  // flood that view (they have their own Missing IDs category) — hidden by default.
  const [hideMissingIds, setHideMissingIds] = useState(true);
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
    async (type: ProblemType, reset: boolean, hideMissing: boolean = hideMissingIds) => {
      const seq = ++fetchSeq.current;
      setLoading(true);
      const off = reset ? 0 : offset;
      const extra = type === 'notInArr' && !hideMissing ? '&includeMissingIds=1' : '';
      try {
        const data = await fetch(`/api/admin/problems?type=${type}&offset=${off}${extra}`).then(
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
    [offset, toast, hideMissingIds]
  );

  useEffect(() => {
    if (active) load(active, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Row shapes differ per category, so the old category's rows must never
  // render under the new one's columns. Clearing here (not in the effect —
  // effects run AFTER the re-render) batches with setActive into one render.
  const selectCategory = (t: ProblemType) => {
    if (t === active) return;
    setItems([]);
    setHasMore(false);
    setActive(t);
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
        <div className="flex flex-wrap gap-2 mb-4">
          {pills.map((c) =>
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
                  active === c.type ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
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

        {/* What the selected check means — ABOVE the table so it's readable
            without scrolling past a long list. Per-category controls sit on the
            same line, right-aligned. */}
        {active && (
          <div className="mb-3 flex items-start justify-between gap-6">
            <p className="text-sm text-slate-400">{hints[active]}</p>
            {active === 'notInArr' && (
              <label
                className="flex shrink-0 items-center gap-2 text-sm text-slate-400"
                title="Titles with no tvdb/tmdb/imdb id can never match Sonarr/Radarr — see the Missing IDs check"
              >
                <input
                  type="checkbox"
                  checked={hideMissingIds}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setHideMissingIds(v);
                    setItems([]);
                    setHasMore(false);
                    load('notInArr', true, v);
                  }}
                />
                Hide titles with missing IDs
              </label>
            )}
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
                <ProblemTable type={active} items={items} server={serverName} />
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
const HEAD_CLS = 'bg-rail text-slate-500 text-xs uppercase tracking-wide';
const ROW_CLS = 'border-t border-slate-800 hover:bg-slate-900/60';

/** Per-category thead + tbody — the shapes are too different for one config. */
function ProblemTable({
  type,
  items,
  server,
}: {
  type: ProblemType;
  items: unknown[];
  server: string;
}) {
  switch (type) {
    case 'sizeMismatch': {
      const rows = items as SizeMismatchRow[];
      return (
        <>
          <thead className={HEAD_CLS}>
            <tr>
              {th('', 'left', 'w-8')}
              {th('Title')}
              {th('Kind')}
              {th('Location')}
              {th(`${server} size`, 'right')}
              {th('*arr size', 'right')}
              {th('Δ', 'right')}
              {th('Instance')}
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
                <td className="px-3 py-2 text-slate-300">{instLabel(r.source, r.instanceName)}</td>
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
              {th('Title')}
              {th('Kind')}
              {th('Location')}
              {th('Size', 'right')}
              {th('Added', 'right')}
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
              {th('Title')}
              {th('Instance')}
              {th('Location')}
              {th('External id')}
              {th('Size in *arr', 'right')}
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
              </tr>
            ))}
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
              <GroupRows key={`${g.idKind}-${g.idValue}`} group={g} />
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
              {th('Title')}
              {th('Matched to')}
              {th('Also claimed by')}
              {th('Size on disk', 'right')}
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
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatSize(r.sizeOnDisk)}</td>
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
              {th('Title')}
              {th('Kind')}
              {th('Location')}
              {th('Added', 'right')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ratingKey} className={ROW_CLS}>
                <Poster url={r.thumbUrl} />
                <TitleCell title={r.title} year={r.year} />
                <td className="px-3 py-2 text-slate-400">{kindLabel(r.libraryKind)}</td>
                <PathCell path={r.dirPath} />
                <AddedCell addedAt={r.addedAt} />
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
              {th('Title')}
              {th('Kind')}
              {th('Last known location')}
              {th('Last known size', 'right')}
              {th('Kept by')}
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
              {th('Name')}
              {th('Kind')}
              {th('Path')}
              {th('Size', 'right')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} className={ROW_CLS}>
                <td className="px-3 py-2 font-medium">{r.name}</td>
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
              {th('Title')}
              {th('Kind')}
              {th('Location')}
              {th('Size', 'right')}
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
              </tr>
            ))}
          </tbody>
        </>
      );
    }
  }
}

/** One duplicate group: a full-width header row, then its member rows. The
 *  members' shared path prefix is dimmed so the differing folder pops —
 *  identical locations mean a split entry, different ones mean two real copies. */
function GroupRows({ group }: { group: DuplicateGroupRow }) {
  const dimPrefix = commonPathPrefix(group.items.map((m) => m.dirPath));
  return (
    <>
      <tr className="border-t border-slate-800 bg-slate-900/60">
        <td colSpan={6} className="px-3 py-1.5 text-xs text-slate-400">
          <span className="font-mono">{group.idKind}:{group.idValue}</span>
          <span className="text-slate-500">
            {' '}
            · {group.items.length} copies · {formatSize(group.totalBytes)}
          </span>
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
