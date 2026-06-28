import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { addKeep, getMediaItem, removeKeep, removeSkip } from '@/lib/queries';

export const runtime = 'nodejs';

/** Add the current user's keep. Clears their "don't care" (mutually exclusive). Body: { ratingKey }. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { ratingKey } = (await req.json()) as { ratingKey?: string };
    if (!ratingKey || !getMediaItem(ratingKey)) {
      return NextResponse.json({ error: 'unknown_item' }, { status: 404 });
    }
    const newlyKept = addKeep(user.plexUserId, ratingKey);
    removeSkip(user.plexUserId, ratingKey); // keep and don't-care are exclusive
    return NextResponse.json({ kept: true, newlyKept });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Remove only the current user's keep (never another user's). Body: { ratingKey }. */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const { ratingKey } = (await req.json()) as { ratingKey?: string };
    if (!ratingKey) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    const removed = removeKeep(user.plexUserId, ratingKey);
    return NextResponse.json({ kept: false, removed });
  } catch (e) {
    return errorResponse(e);
  }
}
