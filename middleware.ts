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
 * Gate everything behind a valid Plex session except the login page, the auth
 * endpoints, and the health probe. Per-route admin checks (is_admin) happen in
 * the admin route handlers / pages, which can read the DB (Node runtime).
 */
const PUBLIC_PATHS = ['/login'];
const PUBLIC_PREFIXES = ['/api/auth/', '/api/health'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = await verifySessionToken(token, Date.now());
  if (userId) return NextResponse.next();

  // Local demo mode: auto-mint a dev session so you browse with no Plex/login.
  // Off unless KEEPARR_DEV_LOGIN=1 — inert (and absent) in production. Requires
  // `npm run seed` first so the dev user + data exist. The cookie is set on the
  // forwarded request (so this same render is authenticated) and the response.
  if (process.env.KEEPARR_DEV_LOGIN === '1') {
    const devToken = await createSessionToken(DEV_USER_ID, Date.now());
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

  // Let API requests bearing an X-Api-Key header through; the Node route
  // validates the key against the DB (the Edge runtime can't read it).
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
