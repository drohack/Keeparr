import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { librarySummary, usedBytesBySection } from '@/lib/queries';
import { buildStorageReport } from '@/lib/storage';
import {
  getDevStorageTotal,
  getManagedSections,
  getStorageMappings,
} from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Everything the Keep totals column and the Big Picture dashboard need in one
 * call: per-library keep/don't-care/undecided breakdown (per user) plus real
 * disk capacity. Buckets partition each library's bytes so stacked bars add up.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const summary = new Map(
      librarySummary(user.plexUserId).map((r) => [r.section_id, r])
    );
    const report = await buildStorageReport(
      getStorageMappings(),
      usedBytesBySection(),
      { fakeTotalBytes: getDevStorageTotal() ?? undefined }
    );

    const libraries = getManagedSections().map((s) => {
      const r = summary.get(s.id);
      return {
        id: s.id,
        title: s.title,
        kind: s.type === 'movie' ? 'movie' : 'show',
        items: r?.items ?? 0,
        bytes: r?.bytes ?? 0,
        keptItems: r?.kept_items ?? 0,
        keptBytes: r?.kept_bytes ?? 0,
        keptByMeItems: r?.kept_by_me_items ?? 0,
        keptByMeBytes: r?.kept_by_me_bytes ?? 0,
        dontcareItems: r?.dontcare_items ?? 0,
        dontcareBytes: r?.dontcare_bytes ?? 0,
        undecidedItems: r?.undecided_items ?? 0,
        undecidedBytes: r?.undecided_bytes ?? 0,
      };
    });

    const sum = (k: keyof (typeof libraries)[number]) =>
      libraries.reduce((a, l) => a + (l[k] as number), 0);

    const totals = {
      items: sum('items'),
      bytes: sum('bytes'),
      keptItems: sum('keptItems'),
      keptBytes: sum('keptBytes'),
      keptByMeItems: sum('keptByMeItems'),
      keptByMeBytes: sum('keptByMeBytes'),
      dontcareItems: sum('dontcareItems'),
      dontcareBytes: sum('dontcareBytes'),
      undecidedItems: sum('undecidedItems'),
      undecidedBytes: sum('undecidedBytes'),
    };

    const storage = report.totals
      ? {
          configured: true as const,
          totalBytes: report.totals.totalBytes,
          freeBytes: report.totals.freeBytes,
          usedBytes: report.totals.usedBytes,
        }
      : { configured: false as const };

    // Tracked media that lives on disk (= sum of library bytes); the disk bar
    // shows "other" = usedBytes - mediaUsedBytes for everything Keeparr can't see.
    return NextResponse.json({
      storage,
      mediaUsedBytes: totals.bytes,
      libraries,
      totals,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
