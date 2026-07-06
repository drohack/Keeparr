import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import {
  queryLibrary,
  seerrRequestKeys,
  type ArrMonitored,
  type DeleteFilter,
  type KeptFilter,
  type LibrarySort,
  type SkipFilter,
  type SortDir,
  type StateBucket,
  type WatchFilter,
} from '@/lib/queries';
import { toCard } from '@/lib/cards';

export const runtime = 'nodejs';

const PAGE = 60;
const SORTS: LibrarySort[] = [
  'size',
  'title',
  'added',
  'year',
  'library',
  'quality',
  'tags',
  'status',
  'watched',
];
const KEPT: KeptFilter[] = ['all', 'kept', 'unkept'];
const SKIP: SkipFilter[] = ['all', 'skipped', 'unskipped'];
const DELETED: DeleteFilter[] = ['all', 'deletedByMe', 'deletedAny'];
const STATE_BUCKETS: StateBucket[] = [
  'keptByMe',
  'keptOther',
  'dontcare',
  'okDeleteMine',
  'okDeleteAny',
  'undecided',
];
const WATCH: WatchFilter[] = [
  'all',
  'watched',
  'unwatched',
  'unwatchedAny',
  'recent30',
  'recent60',
  'recent90',
  'stale90',
];

function safeTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Browse/search a library. Query: sections, q, sort, dir, kept, keptByMe, skip,
 * watch, requestedByMe, hideKept (legacy), offset, plus Sonarr/Radarr filters
 * source/instance/tag/quality/monitored. Each item also carries arr metadata
 * (quality/tags/status…) for the Browse list view, null when not arr-matched.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const p = new URL(req.url).searchParams;

    const sort = (p.get('sort') as LibrarySort) || 'size';
    const dir = (p.get('dir') as SortDir) === 'asc' ? 'asc' : 'desc';
    const kept = (p.get('kept') as KeptFilter) || 'all';
    const keptByMe = p.get('keptByMe') === '1';
    const skip = (p.get('skip') as SkipFilter) || 'all';
    const deleted = (p.get('deleted') as DeleteFilter) || 'all';
    const watch = (p.get('watch') as WatchFilter) || 'all';
    const offset = Math.max(0, Number(p.get('offset')) || 0);

    // Multi-value arr filters arrive as comma-separated lists.
    const csv = (key: string) =>
      (p.get(key) || '').split(',').map((s) => s.trim()).filter(Boolean);
    const sources = csv('source').filter((s) => s === 'sonarr' || s === 'radarr');
    // Combinable "Status" buckets (OR'd together; empty = no filter). Supersedes
    // the legacy kept/skip/deleted single-select params from the Browse UI.
    const stateBuckets = csv('state').filter((s): s is StateBucket =>
      (STATE_BUCKETS as string[]).includes(s)
    );
    const monitored = csv('monitored').filter(
      (m): m is ArrMonitored => m === 'monitored' || m === 'unmonitored'
    );
    const matchParam = p.get('match');
    const matchFilter =
      matchParam === 'matched' || matchParam === 'unmatched' ? matchParam : 'all';

    // "Requested by me" reads the cached Seerr requests (refreshed by the
    // 'requests' job). Empty until that job has run.
    const requestedKeys: string[] | null =
      p.get('requestedByMe') === '1' ? seerrRequestKeys(user.plexUserId) : null;

    const sectionIds = (p.get('sections') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const rows = queryLibrary({
      plexUserId: user.plexUserId,
      sectionIds,
      search: p.get('q') || undefined,
      sort: SORTS.includes(sort) ? sort : 'size',
      dir,
      hideKept: p.get('hideKept') === '1',
      keptFilter: KEPT.includes(kept) ? kept : 'all',
      keptByMeOnly: keptByMe,
      skipFilter: SKIP.includes(skip) ? skip : 'all',
      deleteFilter: DELETED.includes(deleted) ? deleted : 'all',
      stateBuckets,
      watchFilter: WATCH.includes(watch) ? watch : 'all',
      sources,
      instanceIds: csv('instance'),
      tags: csv('tag'),
      qualities: csv('quality'),
      statuses: csv('status'),
      monitored,
      matchFilter,
      sizeMismatch: p.get('sizeMismatch') === '1',
      requestedKeys,
      limit: PAGE + 1, // fetch one extra to detect "has more"
      offset,
    });
    const hasMore = rows.length > PAGE;
    const items = rows.slice(0, PAGE).map((r) => {
      const arrSize = r.arr_size_bytes ?? undefined;
      // Plex vs arr size diverge >10% AND >1 GB → likely a partial/broken file.
      const mismatch =
        arrSize != null &&
        Math.abs(r.size_bytes - arrSize) > 1_073_741_824 &&
        Math.abs(r.size_bytes - arrSize) > 0.1 * r.size_bytes;
      return {
        ...toCard(r, r.kept === 1, r.kept_by_me === 1, r.skipped === 1, r.watched === 1),
        // "OK to delete" state: whether this user requested it (gates the
        // control), their own mark, and whether anyone released it (no identity).
        requestedByMe: r.requested_by_me === 1,
        markedForDeleteByMe: r.marked_for_delete_by_me === 1,
        markedForDeleteAny: r.marked_for_delete_any === 1,
        // Sonarr/Radarr metadata (null when the title isn't arr-matched).
        source: r.arr_source ?? undefined,
        instanceName: r.arr_instance_name ?? undefined,
        monitored: r.arr_monitored == null ? undefined : r.arr_monitored === 1,
        status: r.arr_status ?? undefined,
        quality: r.arr_quality ?? undefined,
        qualityKind: r.arr_quality_kind ?? undefined,
        tags: r.arr_tags ? safeTags(r.arr_tags) : undefined,
        arrSizeBytes: arrSize,
        sizeMismatch: mismatch || undefined,
      };
    });
    return NextResponse.json({ items, hasMore, nextOffset: offset + PAGE });
  } catch (e) {
    return errorResponse(e);
  }
}
