import {
  getMediaServerType,
  getServerBaseUrl,
  getServerToken,
} from '@/lib/settings';
import { isSafeImagePath } from '@/lib/image-path';
import { readImageCache, writeImageCache } from '@/lib/cache';
import { requireUserOrApiKey } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Proxy a poster through our server so the browser never sees the media-server
 * token. Query: ?path=<thumb ref>&w=&h=. The `path` is backend-specific: a Plex
 * relative thumb path ("/library/metadata/...") or a Jellyfin/Emby item id.
 *
 * This handler enforces its OWN auth: middleware lets any /api request carrying
 * an X-Api-Key header past the edge gate but only DEFERS validation to the Node
 * route (the Edge runtime can't read the DB-stored key), so a bogus header would
 * otherwise reach an unguarded route. requireUserOrApiKey validates the key
 * constant-time and falls back to the session, 401ing a junk key.
 */
export async function GET(req: Request) {
  try {
    await requireUserOrApiKey(req);
  } catch {
    return new Response('unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? '';
  // Clamp to a sane poster range: an arbitrary w/h would mint a new cache file
  // per distinct size (each is part of the cache key), letting an authed user
  // fill DATA_DIR/cache/images.
  const w = clampDim(Number(url.searchParams.get('w')) || 300, 1000);
  const h = clampDim(Number(url.searchParams.get('h')) || 450, 1500);
  if (!path) return new Response('bad path', { status: 400 });

  const type = getMediaServerType();
  const baseUrl = getServerBaseUrl();
  const token = getServerToken();
  if (!baseUrl || !token) return new Response('not configured', { status: 503 });

  // Serve from the on-disk poster cache when present (clearable in Settings).
  const cacheKey = `${type}|${path}|${w}|${h}`;
  const cached = readImageCache(cacheKey);
  if (cached) {
    return new Response(new Uint8Array(cached.body), {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  }

  const upstream = buildUpstreamUrl(type, baseUrl, token, path, w, h);
  if (!upstream) return new Response('bad path', { status: 400 });

  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const buf = Buffer.from(await res.arrayBuffer());
    // Only ever serve images: a misbehaving/misconfigured upstream returning
    // e.g. text/html could otherwise be served same-origin. isSafeImagePath +
    // the fixed transcode/Images endpoints already make this improbable.
    const upstreamType = (res.headers.get('Content-Type') ?? '').toLowerCase();
    const contentType = upstreamType.startsWith('image/')
      ? upstreamType
      : 'image/jpeg';
    writeImageCache(cacheKey, buf, contentType); // populate the disk cache
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentType,
        // Posters are immutable enough; cache in the browser for a day.
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
}

/** Clamp a requested poster dimension to [1, max] (defends the on-disk cache). */
function clampDim(n: number, max: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), max);
}

function buildUpstreamUrl(
  type: ReturnType<typeof getMediaServerType>,
  baseUrl: string,
  token: string,
  path: string,
  w: number,
  h: number
): string | null {
  if (!isSafeImagePath(type, path)) return null;
  const base = baseUrl.replace(/\/$/, '');
  if (type === 'plex') {
    const u = new URL(base + '/photo/:/transcode');
    u.searchParams.set('width', String(w));
    u.searchParams.set('height', String(h));
    u.searchParams.set('minSize', '1');
    u.searchParams.set('upscale', '1');
    u.searchParams.set('url', path);
    u.searchParams.set('X-Plex-Token', token);
    return u.toString();
  }
  // Jellyfin/Emby: `path` is the item id -> its primary image, resized server-side.
  const id = encodeURIComponent(path);
  const u = new URL(`${base}/Items/${id}/Images/Primary`);
  u.searchParams.set('fillWidth', String(w));
  u.searchParams.set('fillHeight', String(h));
  u.searchParams.set('quality', '90');
  u.searchParams.set('api_key', token);
  return u.toString();
}
