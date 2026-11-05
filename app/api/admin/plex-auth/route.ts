import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildAuthUrl, checkPin, createPin, getPlexAccount } from '@/lib/plex';
import { logEvent } from '@/lib/queries';
import { errorResponse } from '@/lib/route-helpers';
import { getAppUrl, writeSetting } from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Re-authenticate against plex.tv from Settings, to (re)store the ADMIN token.
 *
 * Distinct from `/api/auth/plex/*`, which signs you IN: this deliberately does
 * not touch the session or create a user. It only replaces `plex_admin_token`,
 * the token used for plex.tv calls - server discovery and the shared-user list.
 *
 * Why it has to exist: that token is captured once, at first-run, from whoever
 * set Keeparr up. If that person is not the Plex server OWNER (common - the
 * installer need not own the server), Discover lists nothing they own and the
 * owner's data is unreachable, with no way to fix it from the UI short of
 * wiping the install. Signing in here as the owner repairs it.
 *
 * POST -> start:  { id, authUrl }   (open authUrl, then poll)
 * GET ?id= -> poll: { status: 'pending' | 'authorized', username? }
 */
export async function POST() {
  try {
    await requireAdmin();
    const pin = await createPin();
    return NextResponse.json({
      id: pin.id,
      authUrl: buildAuthUrl(pin.code, getAppUrl() || undefined),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    const token = await checkPin(id);
    if (!token) return NextResponse.json({ status: 'pending' });

    // Identify the account before storing, so the UI can say WHOSE token this
    // now is - "signed in" without a name hides a wrong-account token.
    const account = await getPlexAccount(token);
    writeSetting('plex_admin_token', token);
    logEvent(
      'info',
      'connection',
      `Plex admin token replaced via Settings (account: ${account.username ?? account.id})`
    );
    return NextResponse.json({
      status: 'authorized',
      username: account.username ?? String(account.id),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
