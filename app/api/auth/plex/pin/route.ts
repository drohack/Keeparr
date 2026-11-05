import { NextResponse } from 'next/server';
import { buildAuthUrl, createPin } from '@/lib/plex';
import { APP_URL } from '@/lib/config';
import { getAppUrl } from '@/lib/settings';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Light per-IP cap so this endpoint can't be used to hammer plex.tv for PINs.
// The real auth happens at app.plex.tv, so this is amplification defense, not
// brute-force defense.
const PIN_LIMIT = 20; // pins per 5 min per IP
const PIN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Start the Plex PIN OAuth flow. Returns the pin id (for polling) and the
 * app.plex.tv auth URL the browser opens (popup). A forwardUrl is included when
 * an App URL is configured (Settings -> General, else the APP_URL env var).
 */
export async function POST(req: Request) {
  try {
    const { limited, retryAfterMs } = rateLimit(
      `pin:${clientIp(req)}`,
      PIN_LIMIT,
      PIN_WINDOW_MS
    );
    if (limited) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }
    const pin = await createPin();
    const appUrl = getAppUrl() || APP_URL;
    const forwardUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/login` : undefined;
    const authUrl = buildAuthUrl(pin.code, forwardUrl);
    return NextResponse.json({ id: pin.id, authUrl });
  } catch (e) {
    return NextResponse.json(
      { error: 'plex_pin_failed', message: String(e) },
      { status: 502 }
    );
  }
}
