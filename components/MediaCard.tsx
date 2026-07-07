'use client';

import type { MediaCardData } from '@/lib/types';
import { formatGB } from '@/lib/format';
import { useKeepState } from './useKeepState';

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
  /** Called after a successful "OK to delete" toggle. */
  onDeleteChange?: (ratingKey: string, markedForDelete: boolean) => void;
  /** Optional "you requested this" badge (from Seerr). */
  requested?: boolean;
}

export default function MediaCard({
  item,
  interactive = true,
  onKeptChange,
  skippable = false,
  onSkipChange,
  onDeleteChange,
  requested,
}: Props) {
  // Per user: keptByMe / skipped / markedForDelete / neither (shared logic). An
  // item can also be "kept by others" (item.kept true while not mine) —
  // protected, but their keep is never ours to remove. Snapshot fixed at load.
  const keptByOthers = item.kept && !item.keptByMe;
  const {
    keptByMe,
    skipped,
    markedForDelete,
    skipBusy,
    deleteBusy,
    toggleKeep,
    toggleSkip,
    toggleDelete,
  } = useKeepState({
    ratingKey: item.ratingKey,
    initialKeptByMe: item.keptByMe,
    initialSkipped: item.skipped,
    initialMarkedForDelete: item.markedForDeleteByMe,
    onKeptChange,
    onSkipChange,
    onDeleteChange,
  });
  // Someone else released it (the by-anyone view) — name-less badge; my own
  // mark is shown by its own badge/button.
  const releasedByOther = !!item.markedForDeleteAny && !markedForDelete;

  const toggle = () => {
    if (interactive) void toggleKeep();
  };
  const onSkipClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleSkip();
  };
  const onDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleDelete();
  };

  // Only "don't care" greys the card out. "OK to delete" stays full-color with a
  // rose ring (a deliberate flag, not a dismissal) so the two read differently.
  const dimmed = skipped;

  function onKeyDown(e: React.KeyboardEvent) {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  // Border encodes the decision: my keep = bold amber frame; my "OK to delete" =
  // bold rose frame; someone else released it = muted rose edge; others' keep =
  // muted amber edge. (Grey/dim is reserved for "don't care".)
  // Use a real 2px border (not a ring): an outward ring gets clipped by the Keep
  // page's overflow-hidden grid, and an inset ring hides behind the poster
  // image. A border frames the card, so it's always fully visible. With
  // box-border (Tailwind default) the 1px↔2px change causes no layout shift.
  const borderCls = keptByMe
    ? 'border-2 border-brand'
    : markedForDelete
      ? 'border-2 border-rose-500'
      : releasedByOther && !skipped
        ? 'border border-rose-800/60'
        : keptByOthers && !skipped
          ? 'border border-amber-700/60'
          : 'border border-slate-800 hover:border-slate-600';

  return (
    <div
      role="button"
      aria-pressed={keptByMe}
      tabIndex={interactive ? 0 : -1}
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={`group relative block w-full overflow-hidden rounded-lg text-left transition-all ${borderCls} ${
        interactive ? 'cursor-pointer' : 'cursor-default'
      } ${dimmed ? 'opacity-50 grayscale' : ''}`}
    >
      <div className="relative aspect-[2/3] w-full bg-slate-800">
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
        {/* Watched marker: small, neutral, bottom-left — never collides with the
            keep/don't-care badges (top corners) or their highlights. */}
        {item.watched && (
          <div
            title="You’ve watched this"
            aria-label="Watched"
            className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-slate-900/75 text-slate-200 ring-1 ring-black/30"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </div>
        )}
        {/* Sonarr/Radarr quality — small, muted, bottom-right (opposite the
            watched eye). Subordinate to the keep/don't-care badges. */}
        {item.quality && (
          <div
            title={
              item.qualityKind === 'profile'
                ? `Quality profile: ${item.quality}`
                : `Quality: ${item.quality}`
            }
            className="absolute bottom-1 right-1 max-w-[80%] truncate rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] text-slate-300 ring-1 ring-black/30"
          >
            {item.quality}
          </div>
        )}
      </div>

      {/* Status badge: my keep wins, then my "OK to delete", then don't care,
          then released-by-someone-else (name-less), then kept-by-others. */}
      {keptByMe ? (
        <div className="absolute right-2 top-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-ink">
          ✓ Keep
        </div>
      ) : markedForDelete ? (
        <div className="absolute right-2 top-2 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-paper">
          🗑 OK to delete
        </div>
      ) : skipped ? (
        <div className="absolute right-2 top-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
          Don&apos;t care
        </div>
      ) : releasedByOther ? (
        <div className="absolute right-2 top-2 rounded-full bg-rose-900/70 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
          OK to delete
        </div>
      ) : keptByOthers ? (
        <div className="absolute right-2 top-2 rounded-full bg-amber-900/80 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
          Kept
        </div>
      ) : null}
      {requested && (
        <div className="absolute left-2 top-2 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-paper">
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
            onClick={onSkipClick}
            disabled={skipBusy}
            className="mt-1.5 w-full rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-60"
          >
            {skipped ? '↺ I care after all' : "I don't care"}
          </button>
        )}
        {/* "OK to delete" — on titles you requested on Seerr (you're the original
            requester signing off). Also shown once marked, so you can always undo. */}
        {(item.requestedByMe || markedForDelete) && (
          <button
            type="button"
            onClick={onDeleteClick}
            disabled={deleteBusy}
            className={`mt-1.5 w-full rounded border px-2 py-1 text-[11px] disabled:opacity-60 ${
              markedForDelete
                ? 'border-rose-700 bg-rose-800/80 font-semibold text-rose-100'
                : 'border-rose-900/70 text-rose-300 hover:border-rose-700 hover:text-rose-200'
            }`}
          >
            {markedForDelete ? '↺ Never mind' : 'OK to delete'}
          </button>
        )}
      </div>
    </div>
  );
}
