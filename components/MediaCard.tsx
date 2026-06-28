'use client';

import { useState } from 'react';
import type { MediaCardData } from '@/lib/types';
import { formatGB } from '@/lib/format';

// Shared so every page sizes its cards identically. CARD_MIN_W must match the
// px in CARD_GRID_CLASS (kept as a literal so Tailwind's scanner sees it).
export const CARD_MIN_W = 170;
export const CARD_GRID_CLASS =
  'grid gap-3 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]';

interface Props {
  item: MediaCardData;
  /** Show the kept state as a toggle the user can flip. */
  interactive?: boolean;
  /** Called after a successful keep toggle (parent may update its list). */
  onKeptChange?: (ratingKey: string, kept: boolean) => void;
  /** Show a per-item "don't care" toggle (library / search / results). */
  skippable?: boolean;
  /** Called after a successful skip toggle. */
  onSkipChange?: (ratingKey: string, skipped: boolean) => void;
  /** Optional "you requested this" badge (from Seerr). */
  requested?: boolean;
}

export default function MediaCard({
  item,
  interactive = true,
  onKeptChange,
  skippable = false,
  onSkipChange,
  requested,
}: Props) {
  // Tri-state, per user: keptByMe / skipped / neither. An item can also be
  // "kept by others" (item.kept true while not mine) — protected, but their
  // keep is never ours to remove. That snapshot is fixed at load.
  const keptByOthers = item.kept && !item.keptByMe;
  const [keptByMe, setKeptByMe] = useState(!!item.keptByMe);
  const [skipped, setSkipped] = useState(!!item.skipped);
  const [busy, setBusy] = useState(false);
  const [skipBusy, setSkipBusy] = useState(false);

  // Add/remove only MY keep. Adding one clears my "don't care" (mutually
  // exclusive); the server does the same atomically.
  async function toggle() {
    if (!interactive || busy) return;
    const next = !keptByMe;
    setKeptByMe(next); // optimistic
    if (next) setSkipped(false);
    setBusy(true);
    try {
      const res = await fetch('/api/keep', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratingKey: item.ratingKey }),
      });
      if (!res.ok) throw new Error('failed');
      onKeptChange?.(item.ratingKey, next);
      if (next) onSkipChange?.(item.ratingKey, false);
    } catch {
      setKeptByMe(!next); // revert
    } finally {
      setBusy(false);
    }
  }

  // "Don't care" clears my keep (mutually exclusive).
  async function toggleSkip(e: React.MouseEvent) {
    e.stopPropagation();
    if (skipBusy) return;
    const next = !skipped;
    setSkipped(next); // optimistic
    if (next) setKeptByMe(false);
    setSkipBusy(true);
    try {
      const res = await fetch('/api/skip', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratingKey: item.ratingKey }),
      });
      if (!res.ok) throw new Error('failed');
      onSkipChange?.(item.ratingKey, next);
      if (next) onKeptChange?.(item.ratingKey, false);
    } catch {
      setSkipped(!next); // revert
    } finally {
      setSkipBusy(false);
    }
  }

  const dimmed = skipped;

  function onKeyDown(e: React.KeyboardEvent) {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  // Border: my keep = full amber ring; others' keep = muted amber edge.
  const borderCls = keptByMe
    ? 'border-brand ring-2 ring-brand'
    : keptByOthers && !skipped
      ? 'border-amber-700/60'
      : 'border-slate-800 hover:border-slate-600';

  return (
    <div
      role="button"
      aria-pressed={keptByMe}
      tabIndex={interactive ? 0 : -1}
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={`group relative block w-full overflow-hidden rounded-lg border text-left transition-all ${borderCls} ${
        interactive ? 'cursor-pointer' : 'cursor-default'
      } ${dimmed ? 'opacity-50 grayscale' : ''}`}
    >
      <div className="aspect-[2/3] w-full bg-slate-800">
        {item.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbUrl}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-slate-500">
            {item.title}
          </div>
        )}
      </div>

      {/* Status badge: my keep wins, then don't care, then kept-by-others. */}
      {keptByMe ? (
        <div className="absolute right-2 top-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-slate-900">
          ✓ Keep
        </div>
      ) : skipped ? (
        <div className="absolute right-2 top-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
          Don&apos;t care
        </div>
      ) : keptByOthers ? (
        <div className="absolute right-2 top-2 rounded-full bg-amber-900/80 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
          Kept
        </div>
      ) : null}
      {requested && (
        <div className="absolute left-2 top-2 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white">
          Requested
        </div>
      )}

      <div className="p-2">
        <div className="truncate text-sm font-medium" title={item.title}>
          {item.title}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-xs text-slate-400">
          <span>{item.year ?? ''}</span>
          <span className="font-mono">{formatGB(item.sizeBytes)}</span>
        </div>
        {skippable && (
          <button
            type="button"
            onClick={toggleSkip}
            disabled={skipBusy}
            className="mt-1.5 w-full rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-60"
          >
            {skipped ? '↺ I care after all' : "Don't care"}
          </button>
        )}
      </div>
    </div>
  );
}
