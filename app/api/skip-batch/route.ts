import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { addSkips, countFeedRemaining, getFeed } from '@/lib/queries';
import { toCard } from '@/lib/cards';
import { FEED_BATCH_SIZE } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * The "keep these, skip the rest" action. Records the shown batch as skipped
 * for this user (so they don't reappear in their rolls) and returns a fresh
 * batch. Body: { ratingKeys: string[] }.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { ratingKeys } = (await req.json()) as { ratingKeys?: string[] };
    if (Array.isArray(ratingKeys) && ratingKeys.length > 0) {
      addSkips(user.plexUserId, ratingKeys.map(String));
    }
    const items = getFeed(user.plexUserId, FEED_BATCH_SIZE, {
      preferWatched: true,
    });
    const remaining = countFeedRemaining(user.plexUserId);
    return NextResponse.json({
      items: items.map((m) => toCard(m, false)),
      remaining,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
