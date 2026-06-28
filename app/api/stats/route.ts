import { NextResponse } from 'next/server';
import { requireUserOrApiKey } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import {
  largestItems,
  libraryStats,
  reclaimableItems,
} from '@/lib/queries';
import { toCard } from '@/lib/cards';

export const runtime = 'nodejs';

const PAGE = 60;

/** Big-picture stats. Query: view=largest|reclaimable, offset. */
export async function GET(req: Request) {
  try {
    const user = await requireUserOrApiKey(req);
    const p = new URL(req.url).searchParams;
    const view = p.get('view') === 'reclaimable' ? 'reclaimable' : 'largest';
    const offset = Math.max(0, Number(p.get('offset')) || 0);

    let items;
    if (view === 'reclaimable') {
      const rows = reclaimableItems(PAGE + 1, offset);
      items = {
        rows: rows.slice(0, PAGE).map((r) => toCard(r, false)),
        hasMore: rows.length > PAGE,
      };
    } else {
      const rows = largestItems(PAGE + 1, offset, user.plexUserId);
      items = {
        rows: rows
          .slice(0, PAGE)
          .map((r) => toCard(r, r.kept === 1, r.kept_by_me === 1)),
        hasMore: rows.length > PAGE,
      };
    }

    return NextResponse.json({
      summary: libraryStats(),
      items: items.rows,
      hasMore: items.hasMore,
      nextOffset: offset + PAGE,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
