import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { countFeedRemaining, getFeed, largestItems } from '@/lib/queries';
import { toCard } from '@/lib/cards';
import { FEED_BATCH_SIZE } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * A fresh feed batch. Query: limit, largest (1 = biggest titles overall,
 * regardless of library/keep-eligibility), section (a single Plex library id;
 * omit for a mix across all libraries). Categories are real Plex libraries —
 * nothing is hardcoded.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const p = new URL(req.url).searchParams;
    const limit = Math.min(
      120,
      Math.max(1, Number(p.get('limit')) || FEED_BATCH_SIZE)
    );

    if (p.get('largest') === '1') {
      const rows = largestItems(limit, 0, user.plexUserId);
      const items = rows.map((r) => toCard(r, r.kept === 1, r.kept_by_me === 1));
      return NextResponse.json({ items, remaining: null });
    }

    const sectionId = p.get('section') || undefined;
    const rows = getFeed(user.plexUserId, limit, {
      preferWatched: true,
      sectionId,
    });
    const items = rows.map((m) => toCard(m, false));
    const remaining = countFeedRemaining(user.plexUserId, { sectionId });
    return NextResponse.json({ items, remaining });
  } catch (e) {
    return errorResponse(e);
  }
}
