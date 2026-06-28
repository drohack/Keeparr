import { getPlexBaseUrl, getServerToken } from '@/lib/settings';
import { readImageCache, writeImageCache } from '@/lib/cache';

export const runtime = 'nodejs';

/**
 * Proxy a Plex thumb through our server so the browser never sees the Plex
 * token. Uses the photo transcoder to resize. Query: ?path=<relative thumb>
 * &w=<width>&h=<height>. Auth is enforced by middleware.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? '';
  const w = Number(url.searchParams.get('w')) || 300;
  const h = Number(url.searchParams.get('h')) || 450;

  if (!path.startsWith('/')) {
    return new Response('bad path', { status: 400 });
  }

  const baseUrl = getPlexBaseUrl();
  const token = getServerToken();
  if (!baseUrl || !token) {
    return new Response('not configured', { status: 503 });
  }

  // Serve from the on-disk poster cache when present (clearable in Settings).
  const cacheKey = `${path}|${w}|${h}`;
  const cached = readImageCache(cacheKey);
  if (cached) {
    return new Response(new Uint8Array(cached.body), {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  }

  const transcode = new URL(
    baseUrl.replace(/\/$/, '') + '/photo/:/transcode'
  );
  transcode.searchParams.set('width', String(w));
  transcode.searchParams.set('height', String(h));
  transcode.searchParams.set('minSize', '1');
  transcode.searchParams.set('upscale', '1');
  transcode.searchParams.set('url', path);
  transcode.searchParams.set('X-Plex-Token', token);

  try {
    const res = await fetch(transcode.toString());
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('Content-Type') ?? 'image/jpeg';
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
