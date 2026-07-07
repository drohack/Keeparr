'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MediaCardData } from '@/lib/types';
import { formatSize } from '@/lib/format';
import MediaCard, { CARD_MIN_W } from './MediaCard';
import {
  StackedBar,
  LegendRow,
  Donut,
  compositionSegments,
  libColor,
  libStroke,
  pct,
  type Overview,
} from './breakdown';
import { useToast } from './Toaster';

interface Library {
  id: string;
  title: string;
  sizeBytes: number;
}
type Selection = 'all' | 'largest' | string; // string = section id

const STORAGE_KEY = 'keeparr.feedSelection';
const GAP = 12; // matches gap-3 on the grid
const LABEL_H = 56; // title + size row + padding below the 2:3 poster
// A card showing the "OK to delete" action button is ~this much taller. It's
// budgeted into EVERY row so any row can be full of OK-to-delete cards without
// overflowing the no-scroll grid.
const ACTION_H = 34;
// Cards match the shared Browse size (CARD_MIN_W) by default, but on a big/tall
// screen we allow them to shrink down to this floor to fit another whole row
// (e.g. 3 rows on a 4K panel). Never smaller — that gets hard to read.
const CARD_FLOOR_W = 150;
// Fetch a generous batch up front; the measured grid only controls how many of
// these we *display*, so a first-load mis-measure never causes an under-fetch.
const FETCH_LIMIT = 96;

/**
 * cols×rows that fill a w×h area with no scroll. Each row is budgeted at the
 * TALLEST card (poster + label + OK-to-delete button) so any row can be full of
 * OK-to-delete cards without clipping. Cards default to the shared Browse size;
 * they only shrink (more columns, down to CARD_FLOOR_W) when that buys another
 * whole row — so 1080p keeps big cards / 2 rows while a 4K panel gets 3 rows
 * with slightly smaller cards.
 */
function dimsFor(w: number, h: number): { cols: number; rows: number } {
  const budgetedH = (cardW: number) => cardW * 1.5 + LABEL_H + ACTION_H;
  const fit = (cols: number) => {
    const cardW = (w - (cols - 1) * GAP) / cols;
    return { cols, cardW, rows: Math.max(1, Math.floor((h + GAP) / (budgetedH(cardW) + GAP))) };
  };
  let best = fit(Math.max(1, Math.floor((w + GAP) / (CARD_MIN_W + GAP)))); // Browse size
  const maxCols = Math.floor((w + GAP) / (CARD_FLOOR_W + GAP));
  for (let c = best.cols + 1; c <= maxCols; c++) {
    const cand = fit(c);
    if (cand.cardW < CARD_FLOOR_W) break;
    if (cand.rows > best.rows) best = cand; // only shrink if it gains a row
  }
  return { cols: best.cols, rows: best.rows };
}

/** Rough cols×rows from the window, before the grid is measured (no-SSR guard). */
function estimateDims(): { cols: number; rows: number } {
  if (typeof window === 'undefined') return { cols: 8, rows: 3 };
  const w = window.innerWidth - 240 - 300 - 48; // rail + totals col + padding
  const h = window.innerHeight - 56 - 130 - 64; // top bar + header + bottom bar
  return dimsFor(w, h);
}

export default function KeepView({ libraries }: { libraries: Library[] }) {
  const [selection, setSelection] = useState<Selection>('all');
  const [items, setItems] = useState<MediaCardData[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  // Items the user released ("OK to delete") this batch — like `kept`, excluded
  // from the skip-the-rest batch so we don't also mark them "don't care".
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [dims, setDims] = useState(estimateDims);
  const [overview, setOverview] = useState<Overview | null>(null);

  const gridWrap = useRef<HTMLDivElement | null>(null);

  // Restore last filter.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* localStorage can throw under strict privacy settings */
    }
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

  // Per-library breakdown + disk capacity for the right column. Refetched after
  // each "Next" so the numbers track the user's keeps/skips.
  const loadOverview = useCallback(() => {
    fetch('/api/overview')
      .then((r) => r.json())
      .then((d) => setOverview(d))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // How many cards actually fit (display only — independent of how many we fetch).
  const visible = dims.cols * dims.rows;
  const shown = items.slice(0, visible);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(FETCH_LIMIT) });
    if (selection === 'largest') params.set('largest', '1');
    else if (selection !== 'all') params.set('section', selection);
    try {
      const data = await fetch(`/api/feed/random?${params}`).then((r) => r.json());
      setItems(data.items ?? []);
      setRemaining(data.remaining ?? null);
      setKept(new Set());
      setDeleted(new Set());
    } catch {
      toast("Couldn't load the feed — is the server reachable?", 'error');
    } finally {
      setLoading(false);
    }
  }, [selection, toast]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const onKeptChange = (ratingKey: string, isKept: boolean) => {
    setKept((prev) => {
      const next = new Set(prev);
      if (isKept) next.add(ratingKey);
      else next.delete(ratingKey);
      return next;
    });
    loadOverview(); // keep the right-column progress live as you decide
  };

  const onDeleteChange = (ratingKey: string, isMarked: boolean) => {
    setDeleted((prev) => {
      const next = new Set(prev);
      if (isMarked) next.add(ratingKey);
      else next.delete(ratingKey);
      return next;
    });
    loadOverview();
  };

  async function next() {
    const toSkip = shown
      .map((i) => i.ratingKey)
      .filter((rk) => !kept.has(rk) && !deleted.has(rk));
    setLoading(true);
    await fetch('/api/skip-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratingKeys: toSkip }),
    }).catch(() => {});
    await loadFeed();
    loadOverview();
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
      {/* Header + filters (under the top search bar). Padding is kept tight so a
          bottom-row card with the taller "OK to delete" button isn't clipped in
          the no-scroll grid. */}
      <div className="shrink-0 px-6 pt-4 pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold">What should we keep?</h1>
          <p className="text-sm text-slate-400">
            {triage
              ? 'Tap anything you want to keep — everything else gets marked “I don’t care.”'
              : 'Your biggest titles by size on disk.'}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg bg-rail p-1">
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
            <div
              className="grid gap-3 content-start"
              style={{ gridTemplateColumns: `repeat(${dims.cols}, minmax(0, 1fr))` }}
            >
              {shown.map((item) => (
                <MediaCard
                  key={item.ratingKey}
                  item={item}
                  onKeptChange={onKeptChange}
                  onDeleteChange={onDeleteChange}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="w-72 shrink-0 hidden lg:flex flex-col gap-3 py-1 overflow-y-auto">
          {overview && <KeepTotals overview={overview} />}
        </aside>
      </div>

      {/* Bottom bar. The action + its explanation align with the GRID, not the
          totals column — a matching spacer keeps them out from under the aside. */}
      <div className="shrink-0 border-t border-slate-800 bg-rail px-6 py-2 flex items-center gap-4">
        <div className="flex flex-1 items-center gap-4">
          <span className="text-sm text-slate-400">
            <span className="text-white font-semibold">{kept.size}</span> kept ·{' '}
            {formatSize(keptSize)}
          </span>
          {triage ? (
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-right text-xs text-slate-500 sm:block max-w-xs">
                Marks everything you didn’t keep as{' '}
                <span className="text-rose-400">“I don’t care”</span> and loads a
                fresh set.
              </span>
              <button
                onClick={next}
                disabled={loading}
                className="shrink-0 rounded-lg bg-brand hover:bg-brand-light text-ink font-semibold px-6 py-2.5 disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Next →'}
              </button>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-right text-xs text-slate-500 sm:block max-w-xs">
                Loads a fresh set of your biggest titles.
              </span>
              <button
                onClick={loadFeed}
                disabled={loading}
                className="shrink-0 rounded-lg border border-slate-700 hover:border-slate-500 px-6 py-2.5 disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          )}
        </div>
        {/* spacer matching the totals column so the button isn't beneath it */}
        <div className="hidden w-72 shrink-0 lg:block" />
      </div>
    </div>
  );
}

/** The Keep page's right column: disk space (most important, on top), then a
 *  by-library donut + per-library kept/don't-care/undecided bars (largest first). */
function KeepTotals({ overview }: { overview: Overview }) {
  const { totals, storage, mediaUsedBytes } = overview;
  const libs = [...overview.libraries].sort((a, b) => b.bytes - a.bytes);
  const otherBytes = storage.configured
    ? Math.max(0, storage.usedBytes - mediaUsedBytes)
    : 0;
  const decided = totals.keptByMeItems + totals.dontcareItems;
  const reviewable = decided + totals.undecidedItems;
  const reviewedPct = pct(decided, reviewable);

  return (
    <>
      {/* Disk space — the headline, on top. Free = the empty part of the bar. */}
      {storage.configured && (
        <div className="rounded-lg border border-slate-800 bg-panel p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
            Disk space
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold leading-none text-emerald-400">
              {formatSize(storage.freeBytes)}
            </span>
            <span className="text-sm text-slate-400">free</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            of {formatSize(storage.totalBytes)} ·{' '}
            <span className="text-slate-300">
              {pct(storage.usedBytes, storage.totalBytes)}% full
            </span>
          </div>
          <div className="mt-3">
            <StackedBar
              height="h-3"
              max={storage.totalBytes}
              segments={[
                { tone: 'kept', value: totals.keptBytes, label: 'Kept' },
                { tone: 'dontcare', value: totals.dontcareBytes, label: 'I don’t care' },
                { tone: 'undecided', value: totals.undecidedBytes, label: 'Undecided' },
                { tone: 'other', value: otherBytes, label: 'Other files' },
              ]}
            />
          </div>
          <div className="mt-3 space-y-1.5">
            <LegendRow tone="kept" label="Kept" value={formatSize(totals.keptBytes)} />
            <LegendRow
              tone="dontcare"
              label="I don’t care"
              value={formatSize(totals.dontcareBytes)}
            />
            <LegendRow
              tone="undecided"
              label="Undecided"
              value={formatSize(totals.undecidedBytes)}
            />
            {otherBytes > 0 && (
              <LegendRow tone="other" label="Other files" value={formatSize(otherBytes)} />
            )}
          </div>
        </div>
      )}

      {/* By library — donut for share of the whole, then per-library composition. */}
      <div className="rounded-lg border border-slate-800 bg-panel p-3">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-500">
          By library
        </div>

        {storage.configured && libs.length > 0 && (
          <div className="mb-4 flex justify-center">
            <Donut
              size={128}
              thickness={16}
              max={storage.totalBytes}
              center={`${pct(storage.usedBytes, storage.totalBytes)}%`}
              centerSub="full"
              segments={libs.map((l, i) => ({
                value: l.bytes,
                stroke: libStroke(i),
                dot: libColor(i),
                label: l.title,
              }))}
            />
          </div>
        )}

        <div className="space-y-3">
          {libs.map((l, i) => (
            <div key={l.id}>
              <div className="flex items-center gap-1.5 text-sm">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${libColor(i)}`} />
                <span className="min-w-0 flex-1 truncate text-slate-200">{l.title}</span>
                <span className="shrink-0 font-mono text-slate-400">
                  {formatSize(l.bytes)}
                </span>
              </div>
              <div className="mt-1.5">
                <StackedBar height="h-1.5" segments={compositionSegments(l)} />
              </div>
            </div>
          ))}
          {libs.length === 0 && (
            <p className="text-sm text-slate-500">No libraries yet.</p>
          )}
        </div>

        {/* one shared key for the per-library composition colors */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-brand" /> Kept
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-rose-500" /> I don’t care
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-blue-500" /> Undecided
          </span>
        </div>
      </div>

      {/* Your review progress (personal) */}
      <div className="rounded-lg border border-slate-800 bg-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Your progress
          </span>
          <span className="text-xs text-slate-500">{reviewedPct}% reviewed</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold leading-none">
            {totals.undecidedItems}
          </span>
          <span className="text-sm text-slate-400">left to review</span>
        </div>
        <div className="mt-2.5">
          <StackedBar
            height="h-2"
            segments={[
              { tone: 'kept', value: totals.keptByMeItems, label: 'Kept by you' },
              { tone: 'dontcare', value: totals.dontcareItems, label: 'I don’t care' },
              { tone: 'undecided', value: totals.undecidedItems, label: 'Undecided' },
            ]}
          />
        </div>
        <div className="mt-2.5 space-y-1.5">
          <LegendRow
            tone="kept"
            label="Kept by you"
            value={String(totals.keptByMeItems)}
          />
          <LegendRow
            tone="dontcare"
            label="I don’t care"
            value={String(totals.dontcareItems)}
          />
          <LegendRow
            tone="undecided"
            label="Undecided"
            value={String(totals.undecidedItems)}
          />
        </div>
      </div>
    </>
  );
}
