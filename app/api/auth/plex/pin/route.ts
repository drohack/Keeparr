import { NextResponse } from 'next/server';
import { buildAuthUrl, createPin } from '@/lib/plex';
import { APP_URL } from '@/lib/config';
import { getAppUrl } from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Start the Plex PIN OAuth flow. Returns the pin id (for polling) and the
 * app.plex.tv auth URL the browser opens (popup). A forwardUrl is included when
 * an App URL is configured (Settings → General, else the APP_URL env var).
 */
export async function POST() {
  try {
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
