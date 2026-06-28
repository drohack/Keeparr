'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MediaCardData } from '@/lib/types';
import { formatSize } from '@/lib/format';
import {
  StackedBar,
  LegendRow,
  Donut,
  compositionSegmentsSplit,
  libColor,
  libStroke,
  pct,
  TONE,
  type Overview,
} from './breakdown';

type View = 'largest' | 'reclaimable';

interface Summary {
  totalItems: number;
  totalBytes: number;
  keptItems: number;
  keptBytes: number;
  reclaimableBytes: number;
}

export default function StatsView() {
  const [view, setView] = useState<View>('largest');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<MediaCardData[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);

  const load = useCallback(
    async (v: View, reset: boolean) => {
      setLoading(true);
      const off = reset ? 0 : offset;
      const data = await fetch(`/api/stats?view=${v}&offset=${off}`).then((r) => r.json());
      setSummary(data.summary);
      setHasMore(data.hasMore);
      setOffset(data.nextOffset);
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
      setLoading(false);
    },
    [offset]
  );

  useEffect(() => {
    load(view, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    fetch('/api/overview')
      .then((r) => r.json())
      .then((d) => setOverview(d))
      .catch(() => {});
  }, []);

  let cumulative = 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Big Picture</h1>
        <p className="mt-1 text-sm text-slate-400">
          What’s on your server, what’s safe to keep, and how much space you could
          win back.
        </p>
      </div>

      {overview && <StorageHero overview={overview} />}
      {overview && <ReviewProgress overview={overview} />}
      {overview && <LibraryGrid overview={overview} />}

      {/* Ranked drill-down tables */}
      <div>
        <div className="flex gap-2 mb-4">
          {(['largest', 'reclaimable'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-2 text-sm ${
                view === v ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {v === 'largest' ? 'Largest on disk' : 'Not kept by anyone'}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-rail text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-3 py-2 w-8">#</th>
                <th className="text-left font-medium px-3 py-2">Title</th>
                <th className="text-right font-medium px-3 py-2">Size</th>
                {view === 'reclaimable' ? (
                  <th className="text-right font-medium px-3 py-2">Cumulative</th>
                ) : (
                  <th className="text-right font-medium px-3 py-2">Kept</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                cumulative += item.sizeBytes;
                return (
                  <tr key={item.ratingKey} className="border-t border-slate-800 hover:bg-slate-900/60">
                    <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{item.title}</span>
                      {item.year && <span className="text-slate-500"> ({item.year})</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatSize(item.sizeBytes)}</td>
                    {view === 'reclaimable' ? (
                      <td className="px-3 py-2 text-right font-mono text-slate-400">
                        {formatSize(cumulative)}
                      </td>
                    ) : (
                      <td className="px-3 py-2 text-right">
                        {item.kept ? (
                          <span className="text-brand">✓</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div className="text-center mt-6">
            <button
              onClick={() => load(view, false)}
              disabled={loading}
              className="rounded-md border border-slate-700 hover:border-slate-500 px-5 py-2 text-sm disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Big headline number + label, with a color dot tying it to the disk bar. */
function BigStat({
  value,
  label,
  tone,
  dot,
  sub,
}: {
  value: string;
  label: string;
  tone?: string;
  dot?: keyof typeof TONE;
  sub?: string;
}) {
  return (
    <div>
      <div className={`text-3xl font-bold leading-none ${tone ?? ''}`}>{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
        {dot && <span className={`h-2.5 w-2.5 rounded-sm ${TONE[dot].dot}`} />}
        {label}
      </div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** The signature: one honest disk gauge (fills up; the empty part is free space)
 *  + headline numbers + legend. */
function StorageHero({ overview }: { overview: Overview }) {
  const { totals, storage, mediaUsedBytes } = overview;
  const configured = storage.configured;
  const otherBytes = configured ? Math.max(0, storage.usedBytes - mediaUsedBytes) : 0;
  const denom = configured ? storage.totalBytes : totals.bytes || 1;
  const keptOtherBytes = Math.max(0, totals.keptBytes - totals.keptByMeBytes);
  const keptOtherItems = Math.max(0, totals.keptItems - totals.keptByMeItems);

  // Filled segments only — the unfilled remainder of the bar IS the free space.
  const segments = [
    { tone: 'kept' as const, value: totals.keptByMeBytes, label: 'Kept by you' },
    { tone: 'keptOther' as const, value: keptOtherBytes, label: 'Kept by others' },
    { tone: 'dontcare' as const, value: totals.dontcareBytes, label: 'You don’t care' },
    { tone: 'undecided' as const, value: totals.undecidedBytes, label: 'Undecided' },
    ...(configured ? [{ tone: 'other' as const, value: otherBytes, label: 'Other files' }] : []),
  ];

  return (
    <section className="rounded-xl border border-slate-800 bg-panel p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Storage at a glance
      </h2>
      <div className="mt-3 flex flex-wrap gap-x-10 gap-y-4">
        {configured && (
          <BigStat
            value={formatSize(storage.freeBytes)}
            label="Free"
            tone="text-emerald-400"
            sub={`of ${formatSize(storage.totalBytes)} · ${pct(
              storage.usedBytes,
              storage.totalBytes
            )}% full`}
          />
        )}
        <BigStat
          value={formatSize(totals.keptByMeBytes)}
          label="Kept by you"
          tone="text-brand"
          dot="kept"
          sub={`${totals.keptByMeItems} titles`}
        />
        <BigStat
          value={formatSize(keptOtherBytes)}
          label="Kept by others"
          tone="text-brand-dark"
          dot="keptOther"
          sub={`${keptOtherItems} titles`}
        />
        <BigStat
          value={formatSize(totals.dontcareBytes)}
          label="You don’t care"
          tone="text-rose-400"
          dot="dontcare"
          sub={`${totals.dontcareItems} titles`}
        />
        <BigStat
          value={formatSize(totals.undecidedBytes)}
          label="Undecided"
          tone="text-blue-400"
          dot="undecided"
          sub={`${totals.undecidedItems} titles you’ve yet to review`}
        />
      </div>

      <div className="mt-5">
        <StackedBar height="h-6" segments={segments} max={configured ? storage.totalBytes : undefined} />
      </div>

      {/* Legend: filled categories + free (the empty part of the bar). */}
      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        {segments.map((s) => (
          <LegendRow
            key={s.tone}
            tone={s.tone}
            label={s.label}
            value={formatSize(s.value)}
            sub={`${pct(s.value, denom)}%`}
            muted={s.value <= 0}
          />
        ))}
        {configured && (
          <LegendRow
            dotClass="bg-slate-700"
            label="Free (empty)"
            value={formatSize(storage.freeBytes)}
            sub={`${pct(storage.freeBytes, denom)}%`}
          />
        )}
      </div>
    </section>
  );
}

/** Personal triage progress across all libraries (counts, not bytes). */
function ReviewProgress({ overview }: { overview: Overview }) {
  const { totals } = overview;
  const decided = totals.keptByMeItems + totals.dontcareItems;
  const reviewable = decided + totals.undecidedItems;
  const reviewedPct = pct(decided, reviewable);

  // Where most of your unreviewed space sits — a neutral next step, not a claim
  // about what "should" be deleted.
  const topToReview = [...overview.libraries]
    .map((l) => ({ l, undecided: l.undecidedBytes }))
    .sort((a, b) => b.undecided - a.undecided)[0];

  return (
    <section className="rounded-xl border border-slate-800 bg-panel p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Your review progress
      </h2>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
        <div className="flex items-center gap-6">
          <Donut
            segments={[
              { tone: 'kept', value: totals.keptByMeItems },
              { tone: 'dontcare', value: totals.dontcareItems },
              { tone: 'undecided', value: totals.undecidedItems },
            ]}
            center={`${reviewedPct}%`}
            centerSub="reviewed"
          />
          <div className="w-64 space-y-2">
            <p className="mb-3 text-sm text-slate-400">
              Decided on{' '}
              <span className="font-semibold text-white">{decided.toLocaleString()}</span> of{' '}
              <span className="font-semibold text-white">{reviewable.toLocaleString()}</span>{' '}
              titles.
            </p>
            <LegendRow
              tone="kept"
              label="Kept by you"
              value={`${totals.keptByMeItems}`}
              sub={formatSize(totals.keptByMeBytes)}
            />
            <LegendRow
              tone="dontcare"
              label="You don’t care"
              value={`${totals.dontcareItems}`}
              sub={formatSize(totals.dontcareBytes)}
            />
            <LegendRow
              tone="undecided"
              label="Undecided (yours)"
              value={`${totals.undecidedItems}`}
              sub={formatSize(totals.undecidedBytes)}
            />
          </div>
        </div>

        {topToReview && topToReview.undecided > 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 lg:ml-auto lg:max-w-xs">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Most left to review
            </div>
            <div className="mt-1 text-lg font-semibold">{topToReview.l.title}</div>
            <div className="mt-0.5 text-sm">
              <span className="font-mono text-blue-400">
                {formatSize(topToReview.undecided)}
              </span>{' '}
              <span className="text-slate-400">you haven’t decided on yet</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Per-library composition cards. */
function LibraryGrid({ overview }: { overview: Overview }) {
  const libs = [...overview.libraries].sort((a, b) => b.bytes - a.bytes);
  if (libs.length === 0) return null;

  const storage = overview.storage;
  const totalBytes = overview.totals.bytes;
  // Per-library bars share one scale (the biggest library) so their lengths are
  // directly comparable — a horizontal bar chart, not 4 full bars.
  const maxLib = Math.max(1, ...libs.map((l) => l.bytes));

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        By library
      </h2>
      <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
        {/* Share of the whole — a donut + library key. */}
        <div className="rounded-xl border border-slate-800 bg-panel p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
            Where your space goes
          </div>
          <div className="flex justify-center py-2">
            <Donut
              size={168}
              thickness={22}
              max={storage.configured ? storage.totalBytes : undefined}
              center={
                storage.configured
                  ? `${pct(storage.usedBytes, storage.totalBytes)}%`
                  : formatSize(totalBytes)
              }
              centerSub={storage.configured ? 'full' : 'total'}
              segments={libs.map((l, i) => ({
                value: l.bytes,
                stroke: libStroke(i),
                dot: libColor(i),
                label: l.title,
              }))}
            />
          </div>
          <div className="mt-2 space-y-1.5">
            {libs.map((l, i) => (
              <div key={l.id} className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${libColor(i)}`} />
                <span className="min-w-0 flex-1 truncate text-slate-300">{l.title}</span>
                <span className="shrink-0 font-mono text-slate-300">
                  {formatSize(l.bytes)}
                </span>
                <span className="shrink-0 min-w-[2.75rem] text-right font-mono text-xs text-slate-500">
                  {pct(l.bytes, storage.configured ? storage.totalBytes : totalBytes)}%
                </span>
              </div>
            ))}
            {storage.configured && (
              <div className="flex items-center gap-2 border-t border-slate-800 pt-1.5 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-slate-700" />
                <span className="min-w-0 flex-1 truncate text-slate-400">Free</span>
                <span className="shrink-0 font-mono text-emerald-400">
                  {formatSize(storage.freeBytes)}
                </span>
                <span className="shrink-0 min-w-[2.75rem] text-right font-mono text-xs text-slate-500">
                  {pct(storage.freeBytes, storage.totalBytes)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Per-library composition — bars share one scale (proportional to size). */}
        <div className="space-y-3">
          {libs.map((l, i) => {
            const keptOther = Math.max(0, l.keptBytes - l.keptByMeBytes);
            const keptOtherItems = Math.max(0, l.keptItems - l.keptByMeItems);
            return (
              <div key={l.id} className="rounded-xl border border-slate-800 bg-panel p-4">
                <div className="flex items-baseline gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${libColor(i)}`} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{l.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{l.items} titles</span>
                  <span className="shrink-0 font-mono text-slate-200">
                    {formatSize(l.bytes)}
                  </span>
                </div>

                {/* The bar's WIDTH is proportional to library size (vs the biggest
                    library); it's fully filled, so there's no empty "free" track. */}
                <div className="mt-2.5">
                  <div
                    className="min-w-[10px]"
                    style={{ width: `${(l.bytes / maxLib) * 100}%` }}
                  >
                    <StackedBar height="h-3" segments={compositionSegmentsSplit(l)} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat tone="kept" label="Kept by you" bytes={l.keptByMeBytes} items={l.keptByMeItems} />
                  <MiniStat tone="keptOther" label="Kept by others" bytes={keptOther} items={keptOtherItems} />
                  <MiniStat
                    tone="dontcare"
                    label="You don’t care"
                    bytes={l.dontcareBytes}
                    items={l.dontcareItems}
                  />
                  <MiniStat
                    tone="undecided"
                    label="Undecided"
                    bytes={l.undecidedBytes}
                    items={l.undecidedItems}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MiniStat({
  tone,
  label,
  bytes,
  items,
}: {
  tone: keyof typeof TONE;
  label: string;
  bytes: number;
  items: number;
}) {
  return (
    <div className="rounded-lg bg-slate-900/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-sm ${TONE[tone].dot}`} />
        <span className="text-[11px] text-slate-400">{label}</span>
      </div>
      <div className="mt-1 font-mono text-sm">{formatSize(bytes)}</div>
      <div className="text-[11px] text-slate-500">{items} titles</div>
    </div>
  );
}
