import { NextResponse } from 'next/server';
import { countAdmins, logEvent } from '@/lib/queries';
import { errorResponse } from '@/lib/route-helpers';
import {
  setMediaServerType,
  setServerField,
  type MediaServerType,
} from '@/lib/settings';
import { getPublicServerInfo } from '@/lib/jellyfin';

export const runtime = 'nodejs';

/**
 * First-run setup: choose the media-server type (and, for Jellyfin/Emby, point at
 * the server URL). Only usable during bootstrap - once an admin exists this 403s,
 * so it can't be used to hijack a configured instance. For Plex it just records
 * the type (the PIN login and server connect follow). Body: { type, url? }.
 */
export async function POST(req: Request) {
  try {
    if (countAdmins() > 0) {
      return NextResponse.json({ error: 'already_setup' }, { status: 403 });
    }
    const { type, url } = (await req.json()) as {
      type?: MediaServerType;
      url?: string;
    };
    if (type !== 'plex' && type !== 'jellyfin' && type !== 'emby') {
      return NextResponse.json({ error: 'bad_type' }, { status: 400 });
    }

    if (type === 'plex') {
      setMediaServerType('plex');
      return NextResponse.json({ ok: true });
    }

    // Jellyfin / Emby: verify the URL is reachable before saving it, so the
    // login form that follows can authenticate against it.
    const trimmed = (url ?? '').trim().replace(/\/$/, '');
    if (!trimmed) {
      return NextResponse.json({ error: 'url_required' }, { status: 400 });
    }
    // Restrict the pre-auth probe to http(s). This endpoint is unauthenticated
    // during first-run, so before fetching an operator-supplied URL we reject
    // non-HTTP schemes (file:, gopher:, etc.) that could be used to probe the
    // host. We deliberately do NOT block private/loopback ranges - the legitimate
    // target is a LAN media server on a private IP. (Complete first-run setup on a
    // trusted network before exposing Keeparr; see README.)
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return NextResponse.json({ error: 'bad_url' }, { status: 400 });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'bad_url' }, { status: 400 });
    }
    let info;
    try {
      info = await getPublicServerInfo(trimmed);
    } catch (e) {
      return NextResponse.json(
        { ok: false, message: `Couldn't reach the server: ${String(e)}` },
        { status: 200 }
      );
    }
    setMediaServerType(type);
    setServerField(type, 'url', trimmed);
    if (info.id) setServerField(type, 'id', info.id);
    if (info.name) setServerField(type, 'name', info.name);
    logEvent('info', 'setup', `Media server set to ${type} (${info.name}).`);
    return NextResponse.json({ ok: true, serverName: info.name });
  } catch (e) {
    return errorResponse(e, 'auth/setup');
  }
}
