import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { usedBytesBySection } from '@/lib/queries';
import { buildStorageReport } from '@/lib/storage';
import {
  getDevStorageTotal,
  getPlexSections,
  getStorageMappings,
} from '@/lib/settings';

export const runtime = 'nodejs';

/** Storage report: per-filesystem free/total + per-library used size. */
export async function GET() {
  try {
    await requireUser();
    const report = await buildStorageReport(
      getStorageMappings(),
      usedBytesBySection(),
      { fakeTotalBytes: getDevStorageTotal() ?? undefined }
    );
    const sections = getPlexSections().map((s) => ({
      id: s.id,
      title: s.title,
    }));
    return NextResponse.json({ report, sections });
  } catch (e) {
    return errorResponse(e);
  }
}
