import { NextResponse } from 'next/server';
import { authenticateByName } from '@/lib/jellyfin';
import { decideAccess } from '@/lib/login';
import { clientIp, rateLimit } from '@/lib/rate-limit';
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
// Brute-force defense: cap credential attempts. The image is public and
// Jellyfin/Emby is a first-class backend, so this endpoint is internet-reachable
// on some deployments.
//
// The per-IP bucket is best-effort only: the App-Router `Request` exposes no
// reliable client socket IP (Next 15 removed `request.ip`), so we key it on the
// client-controlled X-Forwarded-For - which an attacker can rotate to reset the
// window. The bucket that actually stops brute force is the per-USERNAME one
// (unaffected by IP rotation), backed by a GLOBAL ceiling that caps distributed
// spraying across many usernames.
const LOGIN_LIMIT = 10; // attempts per IP...
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // ...per 5 minutes
const USER_LIMIT = 10; // attempts per username per 5 minutes
const GLOBAL_LIMIT = 50; // total attempts across all IPs/usernames per 5 minutes

export async function POST(req: Request) {
  try {
    const type = getMediaServerType();
    if (type === 'plex') {
      return NextResponse.json({ error: 'use_plex_pin' }, { status: 400 });
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

    // Check every bucket (per-username defeats IP rotation; global caps spraying;
    // per-IP is best-effort). Each is a distinct key, so one attempt = one hit per
    // bucket. Trip on the first that's over its limit.
    const ip = clientIp(req);
    const buckets: Array<{ key: string; limit: number }> = [
      { key: `login:user:${username.trim().toLowerCase()}`, limit: USER_LIMIT },
      { key: 'login:all', limit: GLOBAL_LIMIT },
      { key: `login:${ip}`, limit: LOGIN_LIMIT },
    ];
    let worstRetryMs = 0;
    let limited = false;
    for (const b of buckets) {
      const r = rateLimit(b.key, b.limit, LOGIN_WINDOW_MS);
      if (r.limited) {
        limited = true;
        worstRetryMs = Math.max(worstRetryMs, r.retryAfterMs);
      }
    }
    if (limited) {
      const retryAfter = Math.ceil(worstRetryMs / 1000);
      logEvent('warn', 'auth', `Login rate-limited for ${username} from ${ip}.`);
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
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
      logEvent('warn', 'auth', `Sign-in denied for ${account.name} (not enabled while sign-in is closed, or setup unfinished).`);
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
      `${account.name} signed in${decision === 'bootstrap_admin' ? ' (first user - admin)' : becomesAdmin ? ' (admin)' : ''}.`
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
