import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getUser, listUsers, setUserAdmin, setUserEnabled } from '@/lib/queries';
import { getOpenSignin, getOwnerId, setOpenSignin } from '@/lib/settings';

export const runtime = 'nodejs';

/** List users (with admin/enabled/owner flags) + the open-sign-in setting. */
export async function GET() {
  try {
    await requireAdmin();
    const ownerId = getOwnerId();
    const users = listUsers().map((u) => ({
      ...u,
      isOwner: u.plexUserId === ownerId,
    }));
    return NextResponse.json({ users, openSignin: getOpenSignin() });
  } catch (e) {
    return errorResponse(e);
  }
}

interface PutBody {
  /** Global access setting. */
  openSignin?: boolean;
  /** Per-user update. */
  plexUserId?: string;
  isAdmin?: boolean;
  enabled?: boolean;
}

/**
 * Either set the global `openSignin` flag, or update one user's admin/enabled
 * flags. The Owner can never be demoted or disabled.
 */
export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as PutBody;

    if (typeof body.openSignin === 'boolean') {
      setOpenSignin(body.openSignin);
      return NextResponse.json({ ok: true });
    }

    if (typeof body.plexUserId !== 'string') {
      throw new AuthError(400, 'bad_request');
    }
    if (!getUser(body.plexUserId)) {
      throw new AuthError(404, 'user_not_found');
    }
    const isOwner = body.plexUserId === getOwnerId();

    if (typeof body.isAdmin === 'boolean') {
      if (isOwner && !body.isAdmin) {
        throw new AuthError(400, 'cannot_demote_owner');
      }
      setUserAdmin(body.plexUserId, body.isAdmin);
    }
    if (typeof body.enabled === 'boolean') {
      if (isOwner && !body.enabled) {
        throw new AuthError(400, 'cannot_disable_owner');
      }
      setUserEnabled(body.plexUserId, body.enabled);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
