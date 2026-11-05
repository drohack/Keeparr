import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getBackend } from '@/lib/mediaserver';
import { isServerConfigured, setPlexSections } from '@/lib/settings';
import { logEvent } from '@/lib/queries';

export const runtime = 'nodejs';

/**
 * Refresh just the library LIST from the configured media server (fast) - so
 * newly created libraries show up to manage/map without a full content scan.
 */
export async function POST() {
  try {
    await requireAdmin();
    if (!isServerConfigured()) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 });
    }
    const sections = await getBackend().listSections();
    setPlexSections(
      sections.map((s) => ({ id: s.id, title: s.title, type: s.kind, paths: s.paths }))
    );
    logEvent('info', 'mediaserver', `Synced ${sections.length} libraries.`);
    return NextResponse.json({ count: sections.length });
  } catch (e) {
    return errorResponse(e);
  }
}
