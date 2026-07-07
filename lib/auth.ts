import { cookies, headers } from 'next/headers';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  safeEqual,
  verifySessionToken,
} from './session';
import { getUser } from './queries';
import { getApiKey, getOwnerId } from './settings';
import type { SessionUser } from './types';

/**
 * Whether the current request is actually served over HTTPS. We only mark the
 * session cookie `Secure` in that case: over plain HTTP on a LAN (e.g.
 * http://tower:8767) a Secure cookie is silently dropped by the browser, which
 * would bounce the user straight back to /login after a successful sign-in.
 * Behind a TLS reverse proxy, x-forwarded-proto is `https` and we set Secure.
 */
async function isHttpsRequest(): Promise<boolean> {
  try {
    const proto = (await headers()).get('x-forwarded-proto') ?? '';
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  } catch {
    return false; // headers() unavailable (e.g. unit tests)
  }
}

/** Set the signed session cookie for a logged-in Plex user. */
export async function setSessionCookie(plexUserId: string): Promise<void> {
  const token = await createSessionToken(plexUserId, Date.now());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttpsRequest(),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Resolve the current session to a full user record, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const plexUserId = await verifySessionToken(token, Date.now());
  if (!plexUserId) return null;
  const user = getUser(plexUserId);
  if (!user) return null;
  // A blocked account is treated as logged-out (the Owner can't be blocked).
  if (!user.enabled && plexUserId !== getOwnerId()) return null;
  return user;
}

/** Throwable guard for route handlers: returns the user or throws a 401-style error. */
export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, 'unauthorized');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthError(403, 'forbidden');
  return user;
}

/** Synthetic principal returned when a request authenticates via the API key. */
const API_PRINCIPAL: SessionUser = {
  plexUserId: 'api-key',
  username: 'API key',
  email: null,
  thumb: null,
  isAdmin: true,
  enabled: true,
};

function apiKeyMatches(req: Request): boolean {
  const provided = req.headers.get('x-api-key');
  if (!provided) return false;
  const stored = getApiKey();
  // Constant-time compare so the key can't be recovered by timing the response.
  return !!stored && safeEqual(stored, provided);
}

/** Admin via session, or a valid `X-Api-Key` header (for automation). */
export async function requireAdminOrApiKey(req: Request): Promise<SessionUser> {
  if (apiKeyMatches(req)) return API_PRINCIPAL;
  return requireAdmin();
}

/** Any signed-in user, or a valid `X-Api-Key` header (for automation). */
export async function requireUserOrApiKey(req: Request): Promise<SessionUser> {
  if (apiKeyMatches(req)) return API_PRINCIPAL;
  return requireUser();
}
