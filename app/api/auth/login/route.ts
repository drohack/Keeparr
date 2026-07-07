import { NextResponse } from 'next/server';
import { authenticateByName } from '@/lib/jellyfin';
import { decideAccess } from '@/lib/login';
import { rateLimit } from '@/lib/rate-limit';
import { countAdmins, getUser, logEvent, upsertUser } from '@/lib/queries';
import { errorResponse } from '@/lib/route-helpers';
import { syncSeerrRequestsForUser } from '@/lib/sync';
import {
  getMediaServerType,
  getOpenSignin,
  getOwnerId,
  getServerBaseUrl,
  isServerConfigured,
  setServerField,
} from '@/lib/settings';
import { setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Username/password login for Jellyfin/Emby (the Plex equivalent is the PIN flow
 * under /api/auth/plex/*). The user authenticates against the configured server;
 * a successful auth IS server access. The first user bootstraps admin/owner and
 * their access token becomes the server read token. Body: { username, password }.
 */
// Brute-force defense: cap credential attempts per client IP. The image is
// public and Jellyfin/Emby is a first-class backend, so this endpoint is
// internet-reachable on some deployments.
const LOGIN_LIMIT = 10; // attempts…
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // …per 5 minutes per IP

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  try {
    const type = getMediaServerType();
    if (type === 'plex') {
      return NextResponse.json({ error: 'use_plex_pin' }, { status: 400 });
    }

    const { limited, retryAfterMs } = rateLimit(
      `login:${clientIp(req)}`,
      LOGIN_LIMIT,
      LOGIN_WINDOW_MS
    );
    if (limited) {
      const retryAfter = Math.ceil(retryAfterMs / 1000);
      logEvent('warn', 'auth', `Login rate-limited for ${clientIp(req)}.`);
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }
    const url = getServerBaseUrl();
    if (!url) {
      return NextResponse.json({ error: 'not_set_up' }, { status: 409 });
    }
    const { username, password } = (await req.json()) as {
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }

    let auth;
    try {
      auth = await authenticateByName(url, username, password);
    } catch (e) {
      logEvent('warn', 'auth', `${type} sign-in failed for ${username}: ${String(e)}`);
      return NextResponse.json({ status: 'denied', message: String(e) });
    }
    const account = auth.user;
    const ownerId = getOwnerId();
    const isOwner = ownerId != null && ownerId === account.id;

    const existing = getUser(account.id);
    const decision = decideAccess({
      hasAdmin: countAdmins() > 0,
      serverConfigured: isServerConfigured(),
      isOwner,
      // For Jellyfin/Emby, authenticating against the server == having access.
      hasServerAccess: true,
      openSignin: getOpenSignin(),
      userKnown: existing != null,
      userEnabled: existing?.enabled ?? false,
    });

    if (decision === 'denied') {
      logEvent('warn', 'auth', `Sign-in denied for ${account.name} (account disabled).`);
      return NextResponse.json({ status: 'denied' });
    }

    const becomesAdmin = decision === 'bootstrap_admin' || isOwner;

    if (decision === 'bootstrap_admin') {
      // First user claims admin/owner; their access token becomes the server
      // read token (admin token reads every library).
      setServerField(type, 'ownerId', account.id);
      setServerField(type, 'adminToken', auth.accessToken);
      setServerField(type, 'token', auth.accessToken);
    } else if (isOwner) {
      // Keep the owner's tokens fresh on each login.
      setServerField(type, 'adminToken', auth.accessToken);
      setServerField(type, 'token', auth.accessToken);
    }

    upsertUser({
      plexUserId: account.id, // internal user id (historically Plex); any string
      username: account.name,
      email: null, // Jellyfin/Emby accounts have no email; Seerr matches by name
      thumb: null,
      isAdmin: becomesAdmin,
    });

    await setSessionCookie(account.id);

    if (existing == null) {
      void syncSeerrRequestsForUser(account.id, {
        email: null,
        username: account.name,
      }).catch((e) =>
        logEvent('warn', 'seerr', `First-login request sync failed: ${String(e)}`)
      );
    }

    logEvent(
      'info',
      'auth',
      `${account.name} signed in${decision === 'bootstrap_admin' ? ' (first user — admin)' : becomesAdmin ? ' (admin)' : ''}.`
    );
    return NextResponse.json({
      status: 'authorized',
      needsSetup: decision === 'bootstrap_admin' || decision === 'await_setup',
      isAdmin: becomesAdmin,
    });
  } catch (e) {
    return errorResponse(e, 'auth/login');
  }
}
