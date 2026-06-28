import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import {
  queryLibrary,
  seerrRequestKeys,
  type KeptFilter,
  type LibrarySort,
  type SkipFilter,
  type SortDir,
} from '@/lib/queries';
import { toCard } from '@/lib/cards';

export const runtime = 'nodejs';

const PAGE = 60;
const SORTS: LibrarySort[] = ['size', 'title', 'added', 'year'];
const KEPT: KeptFilter[] = ['all', 'kept', 'unkept'];
const SKIP: SkipFilter[] = ['all', 'skipped', 'unskipped'];

/**
 * Browse/search a library. Query: section, q, sort, dir, kept, skip,
 * requestedByMe, hideKept (legacy), offset.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const p = new URL(req.url).searchParams;

    const sort = (p.get('sort') as LibrarySort) || 'size';
    const dir = (p.get('dir') as SortDir) === 'asc' ? 'asc' : 'desc';
    const kept = (p.get('kept') as KeptFilter) || 'all';
    const skip = (p.get('skip') as SkipFilter) || 'all';
    const offset = Math.max(0, Number(p.get('offset')) || 0);

    // "Requested by me" reads the cached Seerr requests (refreshed by the
    // 'requests' job). Empty until that job has run.
    const requestedKeys: string[] | null =
      p.get('requestedByMe') === '1' ? seerrRequestKeys(user.plexUserId) : null;

    const sectionIds = (p.get('sections') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const rows = queryLibrary({
      plexUserId: user.plexUserId,
      sectionIds,
      search: p.get('q') || undefined,
      sort: SORTS.includes(sort) ? sort : 'size',
      dir,
      hideKept: p.get('hideKept') === '1',
      keptFilter: KEPT.includes(kept) ? kept : 'all',
      skipFilter: SKIP.includes(skip) ? skip : 'all',
      requestedKeys,
      limit: PAGE + 1, // fetch one extra to detect "has more"
      offset,
    });
    const hasMore = rows.length > PAGE;
    const items = rows
      .slice(0, PAGE)
      .map((r) => toCard(r, r.kept === 1, r.kept_by_me === 1, r.skipped === 1));
    return NextResponse.json({ items, hasMore, nextOffset: offset + PAGE });
  } catch (e) {
    return errorResponse(e);
  }
}
