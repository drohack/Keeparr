'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MediaCardData } from '@/lib/types';
import { formatSize } from '@/lib/format';
import MediaCard, { CARD_MIN_W, CARD_GRID_CLASS } from './MediaCard';

interface Library {
  id: string;
  title: string;
  sizeBytes: number;
}
type Selection = 'all' | 'largest' | string; // string = section id

const STORAGE_KEY = 'keeparr.feedSelection';
const GAP = 12; // matches gap-3 in CARD_GRID_CLASS
const LABEL_H = 56; // title + size row + padding below the 2:3 poster
// Fetch a generous batch up front; the measured grid only controls how many of
// these we *display*, so a first-load mis-measure never causes an under-fetch.
const FETCH_LIMIT = 96;

/**
 * cols×rows that fit a w×h area, with cards the SAME size as every other page
 * (same min width + 2:3 poster as CARD_GRID_CLASS). `cols` mirrors the CSS
 * auto-fill so slicing to cols×rows yields whole rows and no scroll.
 */
function dimsFor(w: number, h: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.floor((w + GAP) / (CARD_MIN_W + GAP)));
  const cardW = (w - (cols - 1) * GAP) / cols;
  const cardH = cardW * 1.5 + LABEL_H; // poster is aspect-[2/3]
  const rows = Math.max(1, Math.floor((h + GAP) / (cardH + GAP)));
  return { cols, rows };
}

/** Rough cols×rows from the window, before the grid is measured (no-SSR guard). */
function estimateDims(): { cols: number; rows: number } {
  if (typeof window === 'undefined') return { cols: 8, rows: 3 };
  const w = window.innerWidth - 240 - 220 - 48; // rail + totals col + padding
  const h = window.innerHeight - 56 - 130 - 64; // top bar + header + bottom bar
  return dimsFor(w, h);
}

export default function KeepView({ libraries }: { libraries: Library[] }) {
  const [selection, setSelection] = useState<Selection>('all');
  const [items, setItems] = useState<MediaCardData[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [dims, setDims] = useState(estimateDims);
  const [totals, setTotals] = useState<{ total: number; free: number } | null>(null);

  const gridWrap = useRef<HTMLDivElement | null>(null);

  // Restore last filter.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (
      saved &&
      (saved === 'all' || saved === 'largest' || libraries.some((l) => l.id === saved))
    ) {
      setSelection(saved);
    }
  }, [libraries]);

  function choose(next: Selection) {
    setSelection(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  // Measure the grid area → exact cols×rows that fit (no scroll).
  useLayoutEffect(() => {
    const el = gridWrap.current;
    if (!el) return;
    const measure = () => {
      const { cols, rows } = dimsFor(el.clientWidth, el.clientHeight);
      setDims((d) => (d.cols === cols && d.rows === rows ? d : { cols, rows }));
    };
    measure();
    // Measure again next frame: on client-side navigation the flex layout may
    // not have settled when the layout effect first runs.
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Storage totals for the right column.
  useEffect(() => {
    fetch('/api/storage')
      .then((r) => r.json())
      .then((d) => {
        if (d.report?.totals) {
          setTotals({
            total: d.report.totals.totalBytes,
            free: d.report.totals.freeBytes,
          });
        }
      })
      .catch(() => {});
  }, []);

  // How many cards actually fit (display only — independent of how many we fetch).
  const visible = dims.cols * dims.rows;
  const shown = items.slice(0, visible);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(FETCH_LIMIT) });
    if (selection === 'largest') params.set('largest', '1');
    else if (selection !== 'all') params.set('section', selection);
    const data = await fetch(`/api/feed/random?${params}`).then((r) => r.json());
    setItems(data.items ?? []);
    setRemaining(data.remaining ?? null);
    setKept(new Set());
    setLoading(false);
  }, [selection]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const onKeptChange = (ratingKey: string, isKept: boolean) =>
    setKept((prev) => {
      const next = new Set(prev);
      if (isKept) next.add(ratingKey);
      else next.delete(ratingKey);
      return next;
    });

  async function next() {
    const toSkip = shown.map((i) => i.ratingKey).filter((rk) => !kept.has(rk));
    setLoading(true);
    await fetch('/api/skip-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratingKeys: toSkip }),
    }).catch(() => {});
    await loadFeed();
  }

  const triage = remaining != null; // 'largest' is a fixed ranking, not triage
  const keptSize = shown
    .filter((i) => kept.has(i.ratingKey))
    .reduce((a, i) => a + i.sizeBytes, 0);

  const chip = (value: Selection, label: string) => (
    <button
      key={value}
      onClick={() => choose(value)}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        selection === value
          ? 'bg-slate-700 text-white'
          : 'text-slate-400 hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header + filters (under the top search bar) */}
      <div className="shrink-0 px-6 pt-5 pb-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold">What should we keep?</h1>
          <p className="text-sm text-slate-400">
            {triage
              ? 'Tap anything you want to keep — everything else gets marked “I don’t care.”'
              : 'Your biggest titles by size on disk.'}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1 rounded-lg bg-rail p-1">
          {chip('all', 'For you')}
          {libraries.map((l) => chip(l.id, l.title))}
          {chip('largest', 'Largest')}
        </div>
      </div>

      {/* Grid (fills) + totals column */}
      <div className="flex-1 min-h-0 px-6 flex gap-4">
        <div ref={gridWrap} className="flex-1 min-w-0 overflow-hidden">
          {loading && shown.length === 0 ? (
            <p className="text-slate-500 pt-10 text-center">Loading…</p>
          ) : shown.length === 0 ? (
            <div className="pt-10 text-center text-slate-400">
              You’re all caught up here. Try another library above.
            </div>
          ) : (
            <div className={`${CARD_GRID_CLASS} content-start`}>
              {shown.map((item) => (
                <MediaCard key={item.ratingKey} item={item} onKeptChange={onKeptChange} />
              ))}
            </div>
          )}
        </div>

        <aside className="w-52 shrink-0 hidden lg:flex flex-col gap-3 py-1">
          <div className="rounded-lg border border-slate-800 bg-panel p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Library total
            </div>
            <div className="text-xl font-bold">
              {totals ? formatSize(totals.total) : '—'}
            </div>
            <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">
              Free space
            </div>
            <div className="text-lg font-semibold text-brand">
              {totals ? formatSize(totals.free) : '—'}
              {totals && totals.total > 0 && (
                <span className="ml-1 text-xs text-slate-500">
                  ({Math.round((totals.free / totals.total) * 100)}%)
                </span>
              )}
            </div>
          </div>
          {triage && remaining != null && (
            <div className="rounded-lg border border-slate-800 bg-panel p-3 text-sm text-slate-400">
              <span className="text-white font-semibold">{remaining}</span> unprocessed
              by you
            </div>
          )}
        </aside>
      </div>

      {/* Bottom bar (inside the column — never overlaps the rail) */}
      <div className="shrink-0 border-t border-slate-800 bg-rail px-6 py-3 flex items-center gap-4">
        <span className="text-sm text-slate-400">
          <span className="text-white font-semibold">{kept.size}</span> kept ·{' '}
          {formatSize(keptSize)}
        </span>
        {triage ? (
          <button
            onClick={next}
            disabled={loading}
            className="ml-auto rounded-lg bg-brand hover:bg-brand-light text-slate-900 font-semibold px-6 py-2.5 disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Next →'}
          </button>
        ) : (
          <button
            onClick={loadFeed}
            disabled={loading}
            className="ml-auto rounded-lg border border-slate-700 hover:border-slate-500 px-6 py-2.5 disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
}
