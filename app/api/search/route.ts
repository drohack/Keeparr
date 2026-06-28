import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { searchMedia } from '@/lib/queries';
import { toCard } from '@/lib/cards';

export const runtime = 'nodejs';

const PAGE = 30;

/** Full search results, paged. GET ?q=&offset= */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') ?? '').trim();
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    if (q.length < 2) {
      return NextResponse.json({ items: [], hasMore: false, nextOffset: offset });
    }

    const rows = searchMedia({
      query: q,
      plexUserId: user.plexUserId,
      limit: PAGE + 1,
      offset,
    });
    const hasMore = rows.length > PAGE;
    const items = rows
      .slice(0, PAGE)
      .map((r) => toCard(r, r.kept === 1, r.kept_by_me === 1, r.skipped === 1));

    return NextResponse.json({ items, hasMore, nextOffset: offset + items.length });
  } catch (e) {
    return errorResponse(e);
  }
}
