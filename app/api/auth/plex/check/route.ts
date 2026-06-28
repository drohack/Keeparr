import { NextResponse } from 'next/server';
import { checkPin, checkServerAccess, getPlexAccount } from '@/lib/plex';
import { decideAccess } from '@/lib/login';
import { countAdmins, getUser, upsertUser } from '@/lib/queries';
import {
  getAdminToken,
  getMachineId,
  getOpenSignin,
  getOwnerId,
  isServerConfigured,
  writeSetting,
} from '@/lib/settings';
import { setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Poll a Plex PIN. While unauthorized → { status: 'pending' }. Once the user
 * authorizes, resolve their identity, apply the access decision, and (if
 * allowed) upsert the user + set the session cookie.
 *
 * Returns one of: pending | authorized | denied. `needsSetup` is true when an
 * admin still has to connect a Plex server.
 */
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  let token: string | null;
  try {
    token = await checkPin(id);
  } catch (e) {
    return NextResponse.json(
      { error: 'plex_check_failed', message: String(e) },
      { status: 502 }
    );
  }
  if (!token) return NextResponse.json({ status: 'pending' });

  // Authorized at Plex — resolve identity.
  const account = await getPlexAccount(token);
  const serverConfigured = isServerConfigured();
  const ownerId = getOwnerId();
  const isOwner = ownerId != null && ownerId === account.id;

  let hasServerAccess = false;
  if (serverConfigured && !isOwner) {
    const adminToken = getAdminToken();
    const machineId = getMachineId();
    if (adminToken && machineId) {
      try {
        hasServerAccess = await checkServerAccess({
          adminToken,
          machineId,
          userPlexId: account.id,
          adminPlexId: ownerId ?? '',
        });
      } catch {
        hasServerAccess = false;
      }
    }
  }

  const existing = getUser(account.id);
  const decision = decideAccess({
    hasAdmin: countAdmins() > 0,
    serverConfigured,
    isOwner,
    hasServerAccess,
    openSignin: getOpenSignin(),
    userKnown: existing != null,
    userEnabled: existing?.enabled ?? false,
  });

  if (decision === 'denied') {
    return NextResponse.json({ status: 'denied' });
  }

  const becomesAdmin = decision === 'bootstrap_admin' || isOwner;

  if (decision === 'bootstrap_admin') {
    // First user claims admin. Persist their account token (used for the
    // shared-users access check + server discovery) and owner id.
    writeSetting('plex_owner_id', account.id);
    writeSetting('plex_admin_token', token);
  } else if (isOwner) {
    // Keep the owner's account token fresh on each login.
    writeSetting('plex_admin_token', token);
  }

  upsertUser({
    plexUserId: account.id,
    username: account.username ?? account.title,
    email: account.email,
    thumb: account.thumb,
    isAdmin: becomesAdmin,
  });

  await setSessionCookie(account.id);

  return NextResponse.json({
    status: 'authorized',
    needsSetup: decision === 'bootstrap_admin' || decision === 'await_setup',
    isAdmin: becomesAdmin,
  });
}
