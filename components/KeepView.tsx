'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MediaCardData } from '@/lib/types';
import { arrangeForTour, buildTourSteps, showsDeleteButton, tourStart } from '@/lib/tour';
import { formatSize } from '@/lib/format';
import MediaCard from './MediaCard';
import { DESKTOP_GRID, MOBILE_GRID, dimsFor } from '@/lib/keepgrid';
import { isMobileNow, useIsMobile } from './useIsMobile';
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
import Tour from './Tour';

interface Library {
  id: string;
  title: string;
  sizeBytes: number;
}
type Selection = 'all' | 'largest' | string; // string = section id

const STORAGE_KEY = 'keeparr.feedSelection';
// Fetch a generous batch up front; the measured grid only controls how many of
// these we *display*, so a first-load mis-measure never causes an under-fetch.
const FETCH_LIMIT = 96;

/** Rough cols x rows from the window, before the grid is measured (no-SSR guard). */
function estimateDims(): { cols: number; rows: number } {
  if (typeof window === 'undefined') return { cols: 8, rows: 3 };
  if (isMobileNow()) {
    // side padding; top bar + filter chips + Next bar
    return dimsFor(window.innerWidth - 24, window.innerHeight - 153, MOBILE_GRID);
  }
  const w = window.innerWidth - 240 - 300 - 48; // rail + totals col + padding
  const h = window.innerHeight - 56 - 130 - 64; // top bar + header + bottom bar
  return dimsFor(w, h, DESKTOP_GRID);
}

export default function KeepView({
  libraries,
  isAdmin,
  tutorialDone,
}: {
  libraries: Library[];
  isAdmin: boolean;
  /** False until this account finishes or skips the tour (auto-starts it once). */
  tutorialDone: boolean;
}) {
  const [selection, setSelection] = useState<Selection>('all');
  const [items, setItems] = useState<MediaCardData[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  // Items the user released ("OK to delete") this batch - like `kept`, excluded
  // from the skip-the-rest batch so we don't also mark them "don't care".
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [dims, setDims] = useState(estimateDims);
  const [overview, setOverview] = useState<Overview | null>(null);

  const gridWrap = useRef<HTMLDivElement | null>(null);
  const mobile = useIsMobile();

  // Guided tour: auto-runs once per account, or on demand via `/?tour=1` (the
  // user menu's "Show the tour"). Waits for the feed so the poster steps have
  // cards to point at.
  const router = useRouter();
  const replay = useSearchParams().get('tour') === '1';
  // 'arranging' = the batch was just reordered for the tour and must reach the
  // screen before the Tour opens (it picks its steps from what is rendered).
  const [tourPhase, setTourPhase] = useState<'closed' | 'arranging' | 'open'>('closed');
  const [tourDone, setTourDone] = useState(tutorialDone);
  const tourSteps = useMemo(() => buildTourSteps({ isAdmin }), [isAdmin]);

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

  // Measure the grid area -> exact cols x rows that fit (no scroll).
  useLayoutEffect(() => {
    const el = gridWrap.current;
    if (!el) return;
    const profile = mobile ? MOBILE_GRID : DESKTOP_GRID;
    const measure = () => {
      const { cols, rows } = dimsFor(el.clientWidth, el.clientHeight, profile);
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
  }, [mobile]);

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

  // How many cards actually fit (display only - independent of how many we fetch).
  const visible = dims.cols * dims.rows;
  const shown = items.slice(0, visible);

  // Guards against out-of-order responses: only the latest request may commit
  // state (a slow old response must not clobber a newer one - worse here than
  // elsewhere, since a stale batch would be silently mass-skipped by "Next").
  const feedSeq = useRef(0);

  const loadFeed = useCallback(async () => {
    const seq = ++feedSeq.current;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(FETCH_LIMIT) });
    if (selection === 'largest') params.set('largest', '1');
    else if (selection !== 'all') params.set('section', selection);
    try {
      const data = await fetch(`/api/feed/random?${params}`).then((r) => r.json());
      if (seq !== feedSeq.current) return; // superseded - drop it
      setItems(data.items ?? []);
      setRemaining(data.remaining ?? null);
      setKept(new Set());
      setDeleted(new Set());
    } catch {
      if (seq !== feedSeq.current) return; // superseded - don't toast for it
      toast("Couldn't load the feed - is the server reachable?", 'error');
    } finally {
      if (seq === feedSeq.current) setLoading(false);
    }
  }, [selection, toast]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // One open per `?tour=1` arrival: closing strips the param, but the effect
  // re-runs before the URL updates and would otherwise reopen the tour.
  const replayHandled = useRef(false);
  useEffect(() => {
    if (!replay) replayHandled.current = false;
  }, [replay]);
  useEffect(() => {
    if (tourPhase !== 'closed' || loading) return;
    // Read the media query now: the hook is still false on the first render.
    const onPhone = isMobileNow();
    if (onPhone && replay) {
      router.replace('/');
      return;
    }
    const start = tourStart({
      replay,
      replayHandled: replayHandled.current,
      tourDone,
      mobile: onPhone,
    });
    if (!start) return;
    if (start === 'replay') replayHandled.current = true;
    setItems((prev) => arrangeForTour(prev));
    setTourPhase('arranging');
  }, [replay, tourDone, loading, tourPhase, router]);
  useEffect(() => {
    if (tourPhase === 'arranging') setTourPhase('open');
  }, [tourPhase]);
  // Shrunk to phone width mid-tour: close it, but it doesn't count as seen.
  useEffect(() => {
    if (mobile && tourPhase !== 'closed') {
      setTourPhase('closed');
      if (replay) router.replace('/');
    }
  }, [mobile, tourPhase, replay, router]);

  function closeTour() {
    setTourPhase('closed');
    if (!tourDone) {
      setTourDone(true);
      fetch('/api/tutorial', { method: 'POST' }).catch(() => {});
    }
    if (replay) router.replace('/');
  }

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
    try {
      const res = await fetch('/api/skip-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratingKeys: toSkip }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      // Stay on the current batch - advancing would silently drop the marks.
      toast("Couldn't save this batch - nothing was marked.", 'error');
      setLoading(false);
      return;
    }
    await loadFeed();
    loadOverview();
  }

  const triage = remaining != null; // 'largest' is a fixed ranking, not triage
  // The tour points "OK to delete" at the second card (arrangeForTour puts one
  // there), else the first card that shows the button.
  const tourDeleteIndex =
    shown[1] && showsDeleteButton(shown[1]) ? 1 : shown.findIndex(showsDeleteButton);
  const keptSize = shown
    .filter((i) => kept.has(i.ratingKey))
    .reduce((a, i) => a + i.sizeBytes, 0);

  const chip = (value: Selection, label: string) => (
    <button
      key={value}
      onClick={() => choose(value)}
      className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-sm transition-colors md:py-1.5 ${
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
          the no-scroll grid. On a phone only the filter chips stay: every pixel
          of height decides whether a third row of posters fits. */}
      <div className="shrink-0 px-3 pt-2 pb-2 md:px-6 md:pt-4">
        <div className="hidden items-baseline justify-between gap-4 md:flex">
          <h1 className="text-2xl font-bold">What should we keep?</h1>
          <p className="text-sm text-slate-400">
            {triage
              ? 'Tap anything you want to keep - everything else gets marked \u201cI don\u2019t care.\u201d'
              : 'Your biggest titles by size on disk.'}
          </p>
        </div>
        {/* One scrolling row on a phone, so many libraries don't eat the grid's
            height; wraps on desktop. */}
        <div
          data-tour="feed-filters"
          className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg bg-rail p-1 md:mt-2 md:flex-wrap md:overflow-visible"
        >
          {chip('all', 'For you')}
          {libraries.map((l) => chip(l.id, l.title))}
          {chip('largest', 'Largest')}
        </div>
      </div>

      {/* Grid (fills) + totals column */}
      <div className="flex-1 min-h-0 px-3 flex gap-4 md:px-6">
        <div ref={gridWrap} className="flex-1 min-w-0 overflow-hidden">
          {loading && shown.length === 0 ? (
            <p className="text-slate-500 pt-10 text-center">Loading...</p>
          ) : shown.length === 0 ? (
            <div className="pt-10 text-center text-slate-400">
              You&rsquo;re all caught up here. Try another library above.
            </div>
          ) : (
            <div
              className="grid content-start"
              style={{
                gridTemplateColumns: `repeat(${dims.cols}, minmax(0, 1fr))`,
                gap: (mobile ? MOBILE_GRID : DESKTOP_GRID).gap,
              }}
            >
              {shown.map((item, i) => {
                const card = (
                  <MediaCard
                    key={item.ratingKey}
                    item={item}
                    compact={mobile}
                    onKeptChange={onKeptChange}
                    onDeleteChange={onDeleteChange}
                    tourDeleteTarget={i === tourDeleteIndex}
                  />
                );
                return i === 0 ? (
                  <div key={item.ratingKey} data-tour="feed-card">
                    {card}
                  </div>
                ) : (
                  card
                );
              })}
            </div>
          )}
        </div>

        <aside
          data-tour="keep-totals"
          className="w-72 shrink-0 hidden lg:flex flex-col gap-3 py-1 overflow-y-auto"
        >
          {overview && <KeepTotals overview={overview} />}
        </aside>
      </div>

      {/* Bottom bar. The action + its explanation align with the GRID, not the
          totals column - a matching spacer keeps them out from under the aside. */}
      <div className="shrink-0 border-t border-slate-800 bg-rail px-3 py-1.5 flex items-center gap-4 md:px-6 md:py-2">
        <div className="flex flex-1 items-center gap-4">
          <span className="text-sm text-slate-400">
            {mobile && triage && kept.size === 0 ? (
              'Tap a poster to keep it'
            ) : (
              <>
                <span className="text-white font-semibold">{kept.size}</span> kept &middot;{' '}
                {formatSize(keptSize)}
              </>
            )}
          </span>
          {triage ? (
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-right text-xs text-slate-500 sm:block max-w-xs">
                Marks everything you didn&rsquo;t keep as{' '}
                <span className="text-rose-400">&ldquo;I don&rsquo;t care&rdquo;</span> and loads a
                fresh set.
              </span>
              <button
                data-tour="feed-next"
                onClick={next}
                disabled={loading}
                className="shrink-0 rounded-lg bg-brand hover:bg-brand-light text-ink font-semibold px-6 py-2 md:py-2.5 disabled:opacity-60"
              >
                {loading ? 'Loading...' : <>Next &rarr;</>}
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
                className="shrink-0 rounded-lg border border-slate-700 hover:border-slate-500 px-6 py-2 md:py-2.5 disabled:opacity-60"
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          )}
        </div>
        {/* spacer matching the totals column so the button isn't beneath it */}
        <div className="hidden w-72 shrink-0 lg:block" />
      </div>
      {tourPhase === 'open' && <Tour steps={tourSteps} onDone={closeTour} />}
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
      {/* Disk space - the headline, on top. Free = the empty part of the bar. */}
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
                { tone: 'kept', value: totals.keptBytes, label: 'Kept (by anyone)' },
                { tone: 'dontcare', value: totals.dontcareBytes, label: "I don't care (you)" },
                { tone: 'undecided', value: totals.undecidedBytes, label: 'Undecided (you)' },
                { tone: 'other', value: otherBytes, label: 'Other files' },
              ]}
            />
          </div>
          <div className="mt-3 space-y-1.5">
            <LegendRow tone="kept" label="Kept (by anyone)" value={formatSize(totals.keptBytes)} />
            <LegendRow
              tone="dontcare"
              label="I don't care (you)"
              value={formatSize(totals.dontcareBytes)}
            />
            <LegendRow
              tone="undecided"
              label="Undecided (you)"
              value={formatSize(totals.undecidedBytes)}
            />
            {otherBytes > 0 && (
              <LegendRow tone="other" label="Other files" value={formatSize(otherBytes)} />
            )}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Kept counts everyone&apos;s keeps: anything someone keeps is safe. The
            other two are only your choices, on titles nobody has kept.
          </p>
        </div>
      )}

      {/* By library - donut for share of the whole, then per-library composition. */}
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
            <span className="h-2 w-2 rounded-sm bg-brand" /> Kept (by anyone)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-rose-500" /> I don&apos;t care (you)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-blue-500" /> Undecided (you)
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
              { tone: 'dontcare', value: totals.dontcareItems, label: "I don't care" },
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
            label="I don't care"
            value={String(totals.dontcareItems)}
          />
          <LegendRow
            tone="undecided"
            label="Undecided"
            value={String(totals.undecidedItems)}
          />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Only your own choices. Titles someone else already keeps are safe, so
          they aren&apos;t counted as left to review.
        </p>
      </div>
    </>
  );
}
