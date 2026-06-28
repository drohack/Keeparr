import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { seerrRequestKeys } from '@/lib/queries';
import { isSeerrConfigured } from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Plex rating keys the current user has requested via Seerr (for badges). Served
 * from the local cache, which the 'requests' job refreshes on a schedule.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      ratingKeys: seerrRequestKeys(user.plexUserId),
      configured: isSeerrConfigured(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
