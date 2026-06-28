'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { LibrarySection, MediaCardData } from '@/lib/types';
import { formatSize } from '@/lib/format';
import MediaCard, { CARD_GRID_CLASS } from './MediaCard';

type Sort = 'size' | 'title' | 'added' | 'year';
type Dir = 'asc' | 'desc';
type Status = 'undecided' | 'kept' | 'dontcare' | 'all';

// One clear Status filter → the existing kept/skip query params.
const STATUS_PARAMS: Record<
  Status,
  { kept: 'all' | 'kept' | 'unkept'; skip: 'all' | 'skipped' | 'unskipped' }
> = {
  undecided: { kept: 'unkept', skip: 'unskipped' }, // hide kept + don't-care
  kept: { kept: 'kept', skip: 'all' },
  dontcare: { kept: 'all', skip: 'skipped' },
  all: { kept: 'all', skip: 'all' },
};

export default function LibraryBrowser({
  sections,
}: {
  sections: LibrarySection[];
}) {
  // Library selection lives in the URL (?sections=) — driven by the nav rail's
  // Browse list. Empty = all libraries.
  const searchParams = useSearchParams();
  const selectedKey = (searchParams.get('sections') || '')
    .split(',')
    .filter(Boolean)
    .sort()
    .join(',');

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState<Sort>('size');
  const [dir, setDir] = useState<Dir>('desc');
  // Default hides items you've already decided on (kept or don't-care).
  const [status, setStatus] = useState<Status>('undecided');
  const [requestedByMe, setRequestedByMe] = useState(false);

  const [items, setItems] = useState<MediaCardData[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const selectedIds = useMemo(
    () => new Set(selectedKey.split(',').filter(Boolean)),
    [selectedKey]
  );

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Load Seerr requested keys once.
  useEffect(() => {
    fetch('/api/requests')
      .then((r) => r.json())
      .then((d) => setRequested(new Set<string>(d.ratingKeys ?? [])))
      .catch(() => {});
  }, []);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      const off = reset ? 0 : offset;
      const params = new URLSearchParams();
      if (selectedKey) params.set('sections', selectedKey);
      if (debouncedQ) params.set('q', debouncedQ);
      params.set('sort', sort);
      params.set('dir', dir);
      params.set('kept', STATUS_PARAMS[status].kept);
      params.set('skip', STATUS_PARAMS[status].skip);
      if (requestedByMe) params.set('requestedByMe', '1');
      params.set('offset', String(off));
      const data = await fetch(`/api/library?${params}`).then((r) => r.json());
      setHasMore(data.hasMore);
      setOffset(data.nextOffset);
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
      setLoading(false);
    },
    [selectedKey, debouncedQ, sort, dir, status, requestedByMe, offset]
  );

  // Reset + reload whenever a filter (or the rail selection) changes.
  const filterKey = `${selectedKey}|${debouncedQ}|${sort}|${dir}|${status}|${requestedByMe}`;
  useEffect(() => {
    setOffset(0);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const inputCls =
    'rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand';

  const shownLibs = selectedIds.size
    ? sections.filter((s) => selectedIds.has(s.sectionId))
    : sections;
  const shownBytes = shownLibs.reduce((a, s) => a + s.sizeBytes, 0);

  return (
    <div className="px-6 py-6">
      <div className="mb-1 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">Browse</h1>
        <span className="text-sm text-slate-500">
          {selectedIds.size === 0
            ? 'All libraries'
            : shownLibs.map((s) => s.title).join(' + ')}{' '}
          · {formatSize(shownBytes)}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Pick libraries from the <span className="text-slate-300">Browse</span> list in
        the sidebar (all shown by default).
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          className={`${inputCls} flex-1 min-w-[220px]`}
          placeholder="Search titles…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={inputCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="size">Size</option>
          <option value="title">Title</option>
          <option value="year">Release year</option>
          <option value="added">Recently added</option>
        </select>
        <button
          onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className={inputCls}
          title={dir === 'desc' ? 'Descending' : 'Ascending'}
        >
          {dir === 'desc' ? '↓' : '↑'}
        </button>
        <select
          className={inputCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          title="Which items to show"
        >
          <option value="undecided">Undecided</option>
          <option value="kept">Kept</option>
          <option value="dontcare">Don&apos;t care</option>
          <option value="all">All</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={requestedByMe}
            onChange={(e) => setRequestedByMe(e.target.checked)}
          />
          Requested by me
        </label>
      </div>

      {items.length === 0 && !loading ? (
        <p className="text-slate-400 py-12 text-center">No matches.</p>
      ) : (
        <div className={CARD_GRID_CLASS}>
          {items.map((item) => (
            <MediaCard
              key={item.ratingKey}
              item={item}
              skippable
              requested={requested.has(item.ratingKey)}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="text-center mt-6">
          <button
            onClick={() => fetchPage(false)}
            disabled={loading}
            className="rounded-md border border-slate-700 hover:border-slate-500 px-5 py-2 text-sm disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
