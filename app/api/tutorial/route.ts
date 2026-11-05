import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { markTutorialDone } from '@/lib/queries';
import { errorResponse } from '@/lib/route-helpers';

export const runtime = 'nodejs';

/** The user finished or skipped the Keep-page tour: stop auto-starting it for
 *  this account on every device. Replaying from the user menu never calls this. */
export async function POST() {
  try {
    const user = await requireUser();
    markTutorialDone(user.plexUserId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, 'api/tutorial');
  }
}
