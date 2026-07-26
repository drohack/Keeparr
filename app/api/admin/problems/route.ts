import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { isArrConfigured } from '@/lib/settings';
import {
  duplicateGroups,
  getArrConflicts,
  getArrUnmatched,
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

/** The categories this endpoint can list (diskOrphans is a reserved stub). */
const QUERYABLE: ProblemType[] = [
  'sizeMismatch',
  'notInArr',
  'missingFromPlex',
  'duplicates',
  'arrConflicts',
  'zeroSize',
  'removedButKept',
  'missingIds',
];
/** Categories that only mean anything with Sonarr/Radarr connected. */
const ARR_GATED = new Set<ProblemType>([
  'sizeMismatch',
  'notInArr',
  'missingFromPlex',
  'arrConflicts',
]);

/** Swap a row's raw `thumb` path for the proxied poster URL. */
function withPoster<T extends { thumb: string | null }>({ thumb, ...rest }: T) {
  return { ...rest, thumbUrl: thumbUrl(thumb) };
}

/** Paged list for one problem category. Query: type=<category>, offset.
 *  Unlike /api/stats there is NO default view — an unknown/absent type is a
 *  400 (falling back to an arbitrary category could return the whole library). */
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
    const offset = Math.max(0, Number(p.get('offset')) || 0);

    let items: { rows: unknown[]; hasMore: boolean };
    if (type === 'sizeMismatch') {
      const rows = sizeMismatchItems(PAGE + 1, offset);
      items = {
        rows: rows.slice(0, PAGE).map(withPoster),
        hasMore: rows.length > PAGE,
      };
    } else if (type === 'notInArr') {
      const rows = notInArrItems(PAGE + 1, offset);
      items = {
        rows: rows.slice(0, PAGE).map(withPoster),
        hasMore: rows.length > PAGE,
      };
    } else if (type === 'missingFromPlex') {
      // Not in the media server, so no poster to proxy.
      const all = getArrUnmatched();
      items = {
        rows: all.slice(offset, offset + PAGE),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'duplicates') {
      // Grouped in JS; one "item" is a whole duplicate group.
      const all = duplicateGroups();
      items = {
        rows: all.slice(offset, offset + PAGE).map((g) => ({
          ...g,
          items: g.items.map(withPoster),
        })),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'arrConflicts') {
      const all = getArrConflicts();
      items = {
        rows: all.slice(offset, offset + PAGE).map(withPoster),
        hasMore: all.length > offset + PAGE,
      };
    } else if (type === 'zeroSize') {
      const rows = zeroSizeItems(PAGE + 1, offset);
      items = {
        rows: rows.slice(0, PAGE).map(withPoster),
        hasMore: rows.length > PAGE,
      };
    } else if (type === 'removedButKept') {
      // Removed from the media server — a proxied thumb would 404, so no poster.
      const all = removedButKeptItems();
      items = {
        rows: all.slice(offset, offset + PAGE).map((r) => ({
          ...r,
          keptBy: r.keptBy.map((k) => k.username || `User ${k.plexUserId}`),
        })),
        hasMore: all.length > offset + PAGE,
      };
    } else {
      const rows = missingExternalIdItems(PAGE + 1, offset);
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
