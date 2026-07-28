import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getMediaServerType, getStorageMappings, isArrConfigured } from '@/lib/settings';
import {
  arrConflictsSummary,
  arrMatchedCount,
  arrUnmatchedSummary,
  diskOrphansSummary,
  duplicateGroups,
  getJobState,
  identityMismatchSummary,
  missingExternalIdsSummary,
  removedButKeptSummary,
  sizeMismatchSummary,
  unmatchedMediaSummary,
  zeroSizeCount,
} from '@/lib/queries';
import type { ProblemCategorySummary } from '@/lib/types';

export const runtime = 'nodejs';

const ZERO = { titles: 0, bytes: 0 };

/** Per-category counts + bytes for the Problems page pill strip. Categories
 *  are returned in display order; arr-gated ones come back `available: false`
 *  (zeroed) when Sonarr/Radarr isn't configured, and `notInArr` additionally
 *  waits for the first successful arr match — before that EVERY title would be
 *  a false positive. `diskOrphans` needs storage mappings AND a completed Disk
 *  scan run; until then it's unavailable with a `reason` the UI turns into a
 *  fix-it tooltip. */
export async function GET() {
  try {
    await requireAdmin();
    const arr = isArrConfigured();
    const storageConfigured = getStorageMappings().length > 0;
    const scanned = getJobState('diskScan').lastRun != null;
    const orphansReady = storageConfigured && scanned;
    // Gate "not in *arr" until the arr job has actually matched something.
    // The count reflects the list's DEFAULT view: items with no external id at
    // all are excluded (they can never match — they're the Missing IDs category).
    const notInArrReady = arr && arrMatchedCount() > 0;
    const notInArr = notInArrReady ? unmatchedMediaSummary(true) : ZERO;
    const dupes = duplicateGroups();

    const categories: ProblemCategorySummary[] = [
      { type: 'sizeMismatch', available: arr, ...(arr ? sizeMismatchSummary() : ZERO) },
      {
        type: 'notInArr',
        available: notInArrReady,
        titles: notInArr.titles,
        bytes: notInArr.bytes,
      },
      { type: 'missingFromPlex', available: arr, ...(arr ? arrUnmatchedSummary() : ZERO) },
      {
        type: 'identityMismatch',
        available: arr,
        ...(arr ? identityMismatchSummary() : ZERO),
      },
      { type: 'arrConflicts', available: arr, ...(arr ? arrConflictsSummary() : ZERO) },
      {
        type: 'duplicates',
        available: true,
        titles: dupes.length, // GROUP count — the UI labels it "N groups"
        bytes: dupes.reduce((s, g) => s + g.totalBytes, 0),
      },
      { type: 'zeroSize', available: true, titles: zeroSizeCount(), bytes: 0 },
      { type: 'removedButKept', available: true, ...removedButKeptSummary() },
      { type: 'missingIds', available: true, ...missingExternalIdsSummary() },
      {
        type: 'diskOrphans',
        available: orphansReady,
        ...(orphansReady ? diskOrphansSummary() : ZERO),
        ...(orphansReady
          ? {}
          : { reason: !storageConfigured ? ('storage_not_configured' as const) : ('not_scanned' as const) }),
      },
    ];

    // serverType lets the UI name the actual media server in labels ("In *arr,
    // not in Plex") instead of an ambiguous "server".
    return NextResponse.json({ arrConfigured: arr, serverType: getMediaServerType(), categories });
  } catch (e) {
    return errorResponse(e, 'api/admin/problems/summary');
  }
}
