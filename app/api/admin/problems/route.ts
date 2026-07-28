import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getStorageMappings, isArrConfigured } from '@/lib/settings';
import {
  duplicateGroups,
  getArrConflicts,
  getArrUnmatched,
  getDiskOrphansAnnotated,
  identityMismatchItems,
  missingExternalIdItems,
  notInArrItems,
  removedButKeptItems,
  sizeMismatchItems,
  zeroSizeItems,
} from '@/lib/queries';
import { thumbUrl } from '@/lib/cards';
import type { ProblemType } from '@/lib/types';

export const runtime = 'nodejs';

const PAGE = 60;

/** The categories this endpoint can list. */
const QUERYABLE: ProblemType[] = [
  'sizeMismatch',
  'notInArr',
  'missingFromPlex',
  'identityMismatch',
  'duplicates',
  'arrConflicts',
  'zeroSize',
  'removedButKept',
  'missingIds',
  'diskOrphans',
];
/** Categories that only mean anything with Sonarr/Radarr connected. */
const ARR_GATED = new Set<ProblemType>([
  'sizeMismatch',
  'notInArr',
  'missingFromPlex',
  'identityMismatch',
  'arrConflicts',
]);

/** Swap a row's raw `thumb` path for the proxied poster URL. */
function withPoster<T extends { thumb: string | null }>({ thumb, ...rest }: T) {
  return { ...rest, thumbUrl: thumbUrl(thumb) };
}

/** String/number comparator factory for the JS-sliced categories. */
function jsSort<T>(
  rows: T[],
  get: (r: T) => string | number | null,
  dir: 'asc' | 'desc'
): T[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last regardless of direction
    if (bv == null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') {
      return mul * av.localeCompare(bv);
    }
    return mul * ((av as number) - (bv as number));
  });
}

/** Paged list for one problem category. Query: type=<category>, offset, plus
 *  view options: sort/dir (per-category allow-list; unknown → default order),
 *  sections (comma library ids), kind (movie|show) — filters apply where the
 *  rows are media items (or carry an equivalent, e.g. extKind for
 *  missingFromPlex). Unlike /api/stats there is NO default view — an
 *  unknown/absent type is a 400. */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const p = new URL(req.url).searchParams;
    const type = p.get('type') as ProblemType | null;
    if (!type || !QUERYABLE.includes(type)) {
      return NextResponse.json({ error: 'unknown_type' }, { status: 400 });
    }
    if (ARR_GATED.has(type) && !isArrConfigured()) {
      return NextResponse.json({ error: 'arr_not_configured' }, { status: 400 });
    }
    if (type === 'diskOrphans' && getStorageMappings().length === 0) {
      return NextResponse.json({ error: 'storage_not_configured' }, { status: 400 });
    }
    const offset = Math.max(0, Number(p.get('offset')) || 0);

    // View options (sort keys are validated per category by the queries'
    // allow-lists / the jsSort call sites below).
    const dirParam = p.get('dir');
    const dir: 'asc' | 'desc' | undefined =
      dirParam === 'asc' ? 'asc' : dirParam === 'desc' ? 'desc' : undefined;
    const sort = p.get('sort') ?? undefined;
    const sectionIds = (p.get('sections') ?? '').split(',').filter(Boolean);
    const kindParam = p.get('kind');
    const kind: 'movie' | 'show' | undefined =
      kindParam === 'movie' || kindParam === 'show' ? kindParam : undefined;
    const opts = {
      sort,
      dir,
      sectionIds: sectionIds.length ? sectionIds : undefined,
      kind,
    };
    /** Filter for JS-sliced rows that carry sectionId/libraryKind. */
    const mediaFilter = <T extends { sectionId?: string; libraryKind?: string }>(
      rows: T[]
    ): T[] =>
      rows.filter(
        (r) =>
          (!opts.sectionIds || (r.sectionId != null && opts.sectionIds.includes(r.sectionId))) &&
          (!kind || r.libraryKind === kind)
      );

    let items: { rows: unknown[]; hasMore: boolean };
    if (type === 'sizeMismatch') {
      const rows = sizeMismatchItems(PAGE + 1, offset, opts);
      items = {
        rows: rows.slice(0, PAGE).map(withPoster),
        hasMore: rows.length > PAGE,
      };
    } else if (type === 'notInArr') {
      // Items with no external id can never match *arr, so they'd flood this
      // view — excluded unless the client opts in (includeMissingIds=1; the UI
      // checkbox defaults to hiding them).
      const includeMissingIds = p.get('includeMissingIds') === '1';
      const rows = notInArrItems(PAGE + 1, offset, !includeMissingIds, opts);
      // Cross-link: a row whose folder an unmatched *arr title claims is really
      // an identity mismatch — the fix lives there, not "add to *arr".
      const pairByRk = new Map(
        identityMismatchItems().map((im) => [im.media.ratingKey, im.arr.title])
      );
      items = {
        rows: rows.slice(0, PAGE).map((r) => ({
          ...withPoster(r),
          identityArrTitle: pairByRk.get(r.ratingKey) ?? null,
        })),
        hasMore: rows.length > PAGE,
      };
    } else if (type === 'missingFromPlex') {
      // Not in the media server, so no poster to proxy. Kind filters via the
      // ext id axis (tvdb = series, tmdb = movie).
      let all = getArrUnmatched();
      if (kind) all = all.filter((r) => r.extKind === (kind === 'show' ? 'tvdb' : 'tmdb'));
      all = jsSort(
        all,
        sort === 'title' ? (r) => r.title : sort === 'instance' ? (r) => r.instanceName : (r) => r.sizeBytes,
        dir ?? (sort === 'title' || sort === 'instance' ? 'asc' : 'desc')
      );
      // Cross-link: if a media item claims this title's folder, the row is the
      // *arr half of an identity mismatch.
      const pairByExt = new Map(
        identityMismatchItems().map((im) => [
          `${im.arr.source}|${im.arr.extKind}|${im.arr.extId}`,
          im.media.title,
        ])
      );
      items = {
        rows: all.slice(offset, offset + PAGE).map((r) => ({
          ...r,
          claimedByTitle: pairByExt.get(`${r.source}|${r.extKind}|${r.extId}`) ?? null,
        })),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'identityMismatch') {
      let all = identityMismatchItems().filter(
        (r) =>
          (!opts.sectionIds || opts.sectionIds.includes(r.media.sectionId)) &&
          (!kind || r.media.libraryKind === kind)
      );
      all = jsSort(
        all,
        sort === 'title' ? (r) => r.media.title : (r) => r.media.sizeBytes,
        dir ?? (sort === 'title' ? 'asc' : 'desc')
      );
      items = {
        rows: all.slice(offset, offset + PAGE).map((r) => ({
          ...r,
          media: { ...withPoster(r.media) },
        })),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'duplicates') {
      // Grouped in JS; one "item" is a whole duplicate group. A group stays
      // when ANY member passes the filters (members can span libraries).
      const all = duplicateGroups().filter((g) => mediaFilter(g.items).length > 0);
      items = {
        rows: all.slice(offset, offset + PAGE).map((g) => ({
          ...g,
          items: g.items.map(withPoster),
        })),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'arrConflicts') {
      let all = getArrConflicts();
      all = jsSort(
        all,
        sort === 'title' ? (r) => r.title : (r) => r.sizeOnDisk,
        dir ?? (sort === 'title' ? 'asc' : 'desc')
      );
      items = {
        rows: all.slice(offset, offset + PAGE).map(withPoster),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'zeroSize') {
      const rows = zeroSizeItems(PAGE + 1, offset, opts);
      items = {
        rows: rows.slice(0, PAGE).map(withPoster),
        hasMore: rows.length > PAGE,
      };
    } else if (type === 'diskOrphans') {
      // Real filesystem entries — nothing to proxy a poster from. `likely` is
      // the diagnosis: the library title this orphan LOOKS like (usually a
      // leftover old copy).
      let all = getDiskOrphansAnnotated();
      if (opts.sectionIds) all = all.filter((r) => opts.sectionIds!.includes(r.sectionId));
      all = jsSort(
        all,
        sort === 'name' ? (r) => r.name : (r) => r.sizeBytes,
        dir ?? (sort === 'name' ? 'asc' : 'desc')
      );
      items = {
        rows: all.slice(offset, offset + PAGE).map((r) => ({
          name: r.name,
          sectionId: r.sectionId,
          path: r.path,
          isDir: r.isDir,
          sizeBytes: r.sizeBytes,
          sizeSkipped: r.sizeSkipped,
          likely: r.likely,
        })),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'removedButKept') {
      // Removed from the media server — a proxied thumb would 404, so no poster.
      let all = mediaFilter(removedButKeptItems());
      all = jsSort(
        all,
        sort === 'title' ? (r) => r.title : (r) => r.sizeBytes,
        dir ?? (sort === 'title' ? 'asc' : 'desc')
      );
      items = {
        rows: all.slice(offset, offset + PAGE).map((r) => ({
          ...r,
          // dirPath rides along via the spread (last-known location).
          keptBy: r.keptBy.map((k) => k.username || `User ${k.plexUserId}`),
        })),
        hasMore: all.length > offset + PAGE,
      };
    } else {
      const rows = missingExternalIdItems(PAGE + 1, offset, opts);
      items = {
        rows: rows.slice(0, PAGE).map(withPoster),
        hasMore: rows.length > PAGE,
      };
    }

    return NextResponse.json({
      type,
      items: items.rows,
      hasMore: items.hasMore,
      nextOffset: offset + PAGE,
    });
  } catch (e) {
    return errorResponse(e, 'api/admin/problems');
  }
}
