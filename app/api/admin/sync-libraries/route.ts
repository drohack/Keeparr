import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getSections } from '@/lib/plex';
import {
  getPlexBaseUrl,
  getServerToken,
  isServerConfigured,
  setPlexSections,
} from '@/lib/settings';
import { logEvent } from '@/lib/queries';

export const runtime = 'nodejs';

/**
 * Refresh just the library LIST from Plex (fast) — so newly created libraries
 * show up to manage/map without a full content scan.
 */
export async function POST() {
  try {
    await requireAdmin();
    if (!isServerConfigured()) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 });
    }
    const sections = await getSections(getPlexBaseUrl()!, getServerToken()!);
    const wanted = sections.filter((s) => s.type === 'movie' || s.type === 'show');
    setPlexSections(
      wanted.map((s) => ({
        id: s.key,
        title: s.title,
        type: s.type,
        paths: (s.Location ?? []).map((l) => l.path),
      }))
    );
    logEvent('info', 'plex', `Synced ${wanted.length} libraries.`);
    return NextResponse.json({ count: wanted.length });
  } catch (e) {
    return errorResponse(e);
  }
}
