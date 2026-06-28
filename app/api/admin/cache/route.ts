import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { clearImageCache, imageCacheStats } from '@/lib/cache';
import { clearSeerrRequests, clearWatchHistory, logEvent } from '@/lib/queries';

export const runtime = 'nodejs';

/** Cache sizes (posters on disk). */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ images: imageCacheStats() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Clear a cache. Body: { target: 'images' | 'requests' | 'watch' }. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { target } = (await req.json()) as { target?: string };
    let message = '';
    if (target === 'images') {
      const n = clearImageCache();
      message = `Cleared ${n} cached posters.`;
    } else if (target === 'requests') {
      const n = clearSeerrRequests();
      message = `Cleared ${n} cached Seerr requests.`;
    } else if (target === 'watch') {
      const n = clearWatchHistory();
      message = `Cleared ${n} watch-history rows.`;
    } else {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    logEvent('info', 'cache', message);
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    return errorResponse(e);
  }
}
