import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { sectionSizeSummary } from '@/lib/queries';
import { getManagedSections } from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Managed Plex libraries for the nav rail, Keep filters, and Library view.
 * Returns only libraries Keeparr is tracking, with item counts + total size.
 */
export async function GET() {
  try {
    await requireUser();
    const sizes = new Map(sectionSizeSummary().map((s) => [s.section_id, s]));
    const sections = getManagedSections().map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.type === 'movie' ? 'movie' : 'show',
      itemCount: sizes.get(s.id)?.n ?? 0,
      sizeBytes: sizes.get(s.id)?.bytes ?? 0,
    }));
    return NextResponse.json({ sections });
  } catch (e) {
    return errorResponse(e);
  }
}
