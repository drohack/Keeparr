import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { searchMedia } from '@/lib/queries';
import { thumbUrl } from '@/lib/cards';

export const runtime = 'nodejs';

/** Typeahead suggestions (slim). GET ?q= — top 8 closest matches. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ suggestions: [] });

    const rows = searchMedia({
      query: q,
      plexUserId: user.plexUserId,
      limit: 8,
      offset: 0,
    });
    const suggestions = rows.map((r) => ({
      ratingKey: r.rating_key,
      title: r.title,
      year: r.year,
      thumbUrl: thumbUrl(r.thumb),
      kept: r.kept === 1,
      skipped: r.skipped === 1,
    }));
    return NextResponse.json({ suggestions });
  } catch (e) {
    return errorResponse(e);
  }
}
