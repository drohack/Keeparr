import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import {
  applySkipBatch,
  countFeedRemaining,
  getFeed,
  seerrRequestKeys,
  watchedRatingKeys,
} from '@/lib/queries';
import { toCard } from '@/lib/cards';
import { FEED_BATCH_SIZE } from '@/lib/config';

export const runtime = 'nodejs';

/** Far above any real batch (one screen of Keep cards): reject, don't clamp -
 *  clamping would silently drop decisions while the client reports success. */
const MAX_BATCH = 500;

/**
 * The "keep these, skip the rest" action. Records the shown batch as skipped
 * for this user (so they don't reappear in their rolls) and returns a fresh
 * batch. Skipping clears the user's keep / "OK to delete" on those items
 * (mutually exclusive, same as /api/skip); unknown or tombstoned keys are
 * ignored. Body: { ratingKeys: string[] }.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { ratingKeys } = (await req.json()) as { ratingKeys?: unknown };
    if (ratingKeys !== undefined && !Array.isArray(ratingKeys)) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    if (Array.isArray(ratingKeys) && ratingKeys.length > MAX_BATCH) {
      return NextResponse.json({ error: 'too_many_items' }, { status: 400 });
    }
    if (Array.isArray(ratingKeys) && ratingKeys.length > 0) {
      applySkipBatch(
        user.plexUserId,
        ratingKeys.map(String).filter((k) => k.length > 0)
      );
    }
    const items = getFeed(user.plexUserId, FEED_BATCH_SIZE);
    const watched = watchedRatingKeys(user.plexUserId);
    const requested = new Set(seerrRequestKeys(user.plexUserId));
    const remaining = countFeedRemaining(user.plexUserId);
    return NextResponse.json({
      items: items.map((m) => ({
        ...toCard(m, false, undefined, undefined, watched.has(m.rating_key)),
        requestedByMe: requested.has(m.rating_key),
      })),
      remaining,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
