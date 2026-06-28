import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import {
  addSkip,
  getMediaItem,
  removeKeep,
  removeSkip,
} from '@/lib/queries';

export const runtime = 'nodejs';

/** Mark "don't care" for the current user. Clears their keep (mutually exclusive). Body: { ratingKey }. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { ratingKey } = (await req.json()) as { ratingKey?: string };
    if (!ratingKey || !getMediaItem(ratingKey)) {
      return NextResponse.json({ error: 'unknown_item' }, { status: 404 });
    }
    const changed = addSkip(user.plexUserId, ratingKey);
    removeKeep(user.plexUserId, ratingKey); // don't-care clears my keep
    return NextResponse.json({ skipped: true, changed });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Clear a "don't care" for the current user. Body: { ratingKey }. */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const { ratingKey } = (await req.json()) as { ratingKey?: string };
    if (!ratingKey) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    const changed = removeSkip(user.plexUserId, ratingKey);
    return NextResponse.json({ skipped: false, changed });
  } catch (e) {
    return errorResponse(e);
  }
}
