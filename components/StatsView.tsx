'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MediaCardData } from '@/lib/types';
import { formatSize } from '@/lib/format';

type View = 'largest' | 'reclaimable';

interface Summary {
  totalItems: number;
  totalBytes: number;
  keptItems: number;
  keptBytes: number;
  reclaimableBytes: number;
}
interface Library {
  id: string;
  title: string;
  kind: string;
  itemCount: number;
  sizeBytes: number;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${accent ? 'text-brand' : ''}`}>{value}</div>
    </div>
  );
}

export default function StatsView() {
  const [view, setView] = useState<View>('largest');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<MediaCardData[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [storage, setStorage] = useState<{ total: number; free: number } | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);

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
    fetch('/api/storage')
      .then((r) => r.json())
      .then((d) => {
        if (d.report?.totals)
          setStorage({ total: d.report.totals.totalBytes, free: d.report.totals.freeBytes });
      })
      .catch(() => {});
    fetch('/api/sections')
      .then((r) => r.json())
      .then((d) => setLibraries(d.sections ?? []))
      .catch(() => {});
  }, []);

  let cumulative = 0;
  const usedPct =
    storage && storage.total > 0
      ? Math.round(((storage.total - storage.free) / storage.total) * 100)
      : 0;
  const maxLib = Math.max(1, ...libraries.map((l) => l.sizeBytes));
  const orderedLibs = [...libraries].sort((a, b) => b.sizeBytes - a.sizeBytes);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Big Picture</h1>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Titles" value={String(summary.totalItems)} />
          <Stat label="Total on disk" value={formatSize(summary.totalBytes)} />
          <Stat label="Kept" value={`${summary.keptItems} · ${formatSize(summary.keptBytes)}`} />
          <Stat label="Reclaimable" value={formatSize(summary.reclaimableBytes)} accent />
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-6 items-start">
        {/* Left: the ranked table */}
        <div className="flex-1 min-w-0 w-full">
          <div className="flex gap-2 mb-4">
            {(['largest', 'reclaimable'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-4 py-2 text-sm ${
                  view === v ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {v === 'largest' ? 'Largest on disk' : 'Reclaimable (not kept)'}
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

        {/* Right: storage + per-library breakdown (fills the width) */}
        <aside className="w-full xl:w-80 shrink-0 space-y-4">
          <div className="rounded-lg border border-slate-800 bg-panel p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Storage</div>
            {storage ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-brand">{formatSize(storage.free)}</span>
                  <span className="text-sm text-slate-500">free</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-800">
                  <div className="h-full bg-brand" style={{ width: `${usedPct}%` }} />
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {usedPct}% used of {formatSize(storage.total)}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Storage not configured.</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-panel p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">By library</div>
            <div className="space-y-3">
              {orderedLibs.map((l) => (
                <div key={l.id}>
                  <div className="flex justify-between text-sm">
                    <span className="truncate">{l.title}</span>
                    <span className="font-mono text-slate-400">{formatSize(l.sizeBytes)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-800">
                    <div
                      className="h-full bg-brand/70"
                      style={{ width: `${Math.round((l.sizeBytes / maxLib) * 100)}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-600">{l.itemCount} titles</div>
                </div>
              ))}
              {orderedLibs.length === 0 && (
                <p className="text-sm text-slate-500">No libraries yet.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
