import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
} from '@/lib/session';
import { DEV_USER_ID } from '@/lib/dev-constants';

/**
 * Gate everything behind a valid session except the login page, the auth
 * endpoints, and the health probe. Per-route admin checks (is_admin) happen in
 * the admin route handlers / pages, which can read the DB (Node runtime).
 */
// The manifest + icons must be public: browsers fetch the PWA manifest
// WITHOUT credentials (unless crossorigin=use-credentials), and favicons are
// fetched pre-login on the login page itself.
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/icon.svg', '/icon.png'];
const PUBLIC_PREFIXES = ['/api/auth/', '/api/health', '/icons/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // Edge can't read the DB, so this only checks signature + expiry; the epoch is
  // enforced by getSessionUser in the Node layer (like the enabled check).
  const session = await verifySessionToken(token, Date.now());
  if (session) return NextResponse.next();

  // Local demo mode: auto-mint a dev session so you browse with no Plex/login.
  // Off unless KEEPARR_DEV_LOGIN=1 AND not a production build - this auth bypass
  // can never activate in production even if the env var leaks in. Requires
  // `npm run seed` first so the dev user + data exist. The cookie is set on the
  // forwarded request (so this same render is authenticated) and the response.
  if (
    process.env.KEEPARR_DEV_LOGIN === '1' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const devToken = await createSessionToken(DEV_USER_ID, 0, Date.now());
    req.cookies.set(SESSION_COOKIE, devToken);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set(SESSION_COOKIE, devToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  }

  // Let API requests bearing an X-Api-Key header through. This only DEFERS auth
  // to the Node route - the Edge runtime can't read the DB to validate the key.
  // Every /api route MUST therefore call a require* helper itself (a bare header
  // presence is NOT authentication); this passthrough alone protects nothing.
  if (pathname.startsWith('/api/') && req.headers.get('x-api-key')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', req.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
