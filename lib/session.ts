/**
 * Signed session cookie helpers. Uses the Web Crypto API (available in both the
 * Edge middleware runtime and the Node.js route-handler runtime) so the same
 * signing/verification logic works everywhere. No Node-only imports here.
 *
 * The session payload carries the authenticated media-server account id.
 */

export const SESSION_COOKIE = 'keeparr_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  return process.env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me';
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  return toHex(sig);
}

/** Constant-time-ish string compare (length mismatch short-circuits). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Create a signed session token for a user, valid for SESSION_TTL_MS. The
 * `epoch` is the user's `session_epoch` at mint time - bumping it in the DB
 * invalidates every token minted before the bump (an admin disabling the account).
 */
export async function createSessionToken(
  plexUserId: string,
  epoch: number,
  now: number
): Promise<string> {
  const exp = now + SESSION_TTL_MS;
  const payload = `${plexUserId}.${epoch}.${exp}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

/**
 * Verify a session token's signature and expiry. Returns `{ userId, epoch }` on
 * success, or null. Token format: `${plexUserId}.${epoch}.${exp}.${sig}`. This
 * runs in the Edge runtime and CANNOT read the DB, so the epoch is returned for
 * the Node layer (getSessionUser) to compare against the user's current epoch.
 */
export async function verifySessionToken(
  token: string | undefined,
  now: number
): Promise<{ userId: string; epoch: number } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [plexUserId, epochStr, expStr, sig] = parts;
  const exp = Number(expStr);
  const epoch = Number(epochStr);
  if (!Number.isFinite(exp) || exp < now) return null;
  if (!Number.isInteger(epoch)) return null;
  const expected = await hmac(`${plexUserId}.${epochStr}.${expStr}`);
  if (!safeEqual(sig, expected)) return null;
  return { userId: plexUserId, epoch };
}

export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
