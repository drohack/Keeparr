'use client';

import type { MediaCardData } from '@/lib/types';
import { formatGB } from '@/lib/format';
import { useKeepState } from './useKeepState';

/** One row of Browse's List view - the dense, quality/tags-forward counterpart
 *  to MediaCard. Reuses `useKeepState` for keep / "I don't care" / "OK to delete". */
export default function MediaRow({
  item,
  sectionTitle,
}: {
  item: MediaCardData;
  sectionTitle: string;
}) {
  const keptByOthers = item.kept && !item.keptByMe;
  const {
    keptByMe,
    skipped,
    markedForDelete,
    busy,
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
  });
  // Someone else released it (the by-anyone view) - show a name-less tag. My own
  // mark is conveyed by the button, so don't double up.
  const releasedByOther = !!item.markedForDeleteAny && !markedForDelete;

  // A left-edge status stripe + faint tint encodes the decision, mirroring the
  // grid card's color language: amber = keep, rose = OK to delete, grey = don't
  // care. My own decision wins; otherwise reflect others' keep / release.
  const rowAccent = keptByMe
    ? 'border-l-2 border-l-brand bg-brand/10'
    : markedForDelete
      ? 'border-l-2 border-l-rose-500 bg-rose-950/40'
      : skipped
        ? 'border-l-2 border-l-slate-600 opacity-50'
        : releasedByOther
          ? 'border-l-2 border-l-rose-800/70 bg-rose-950/20'
          : keptByOthers
            ? 'border-l-2 border-l-amber-700/70 bg-amber-900/10'
            : 'border-l-2 border-l-transparent';

  return (
    <tr
      className={`border-t border-slate-800 hover:bg-slate-900/60 ${rowAccent}`}
    >
      {/* Tiny poster, capped to the row height (h-9) so rows don't grow. */}
      <td className="py-1 pl-3 pr-0">
        <div className="h-9 w-6 overflow-hidden rounded bg-slate-800">
          {item.thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <span className="font-medium">{item.title}</span>
        {item.year && <span className="text-slate-500"> ({item.year})</span>}
        {releasedByOther && (
          <span className="ml-2 rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
            OK to delete
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-400">{sectionTitle}</td>
      <td className="px-3 py-2 text-right font-mono">
        {item.sizeMismatch && (
          <span
            className="mr-1 cursor-help text-amber-400"
            title={`Server ${formatGB(item.sizeBytes)} vs *arr ${
              item.arrSizeBytes != null ? formatGB(item.arrSizeBytes) : '—'
            } - possible partial/broken file`}
          >
            ⚠
          </span>
        )}
        {formatGB(item.sizeBytes)}
      </td>
      <td className="px-3 py-2">
        {item.quality ? (
          <span>
            <span className="text-slate-200">{item.quality}</span>
            {item.qualityKind === 'profile' && (
              <span className="ml-1 text-[10px] uppercase text-slate-500">target</span>
            )}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {item.tags && item.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <span key={t} className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                {t}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-400">
        {item.status ? <span className="capitalize">{item.status}</span> : <span className="text-slate-600">—</span>}
        {item.monitored === false && (
          <span className="ml-1 text-[10px] uppercase text-slate-600">unmonitored</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {item.watched ? <span className="text-slate-300">✓</span> : <span className="text-slate-600">—</span>}
      </td>
      <td className="px-3 py-2">
        {/* Fixed-width buttons so toggling a label never reflows the column /
            table. The "OK to delete" button only shows on items you requested. */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void toggleKeep()}
            disabled={busy}
            title={keptByOthers && !keptByMe ? 'Kept by someone else - keep it yourself too' : undefined}
            className={`w-16 shrink-0 rounded px-2 py-1 text-center text-[11px] disabled:opacity-60 ${
              keptByMe
                ? 'bg-brand font-semibold text-ink'
                : keptByOthers
                  ? 'border border-amber-700/60 text-amber-200'
                  : 'border border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {keptByMe ? '✓ Keep' : keptByOthers ? 'Kept' : 'Keep'}
          </button>
          <button
            type="button"
            onClick={() => void toggleSkip()}
            disabled={skipBusy}
            className={`w-24 shrink-0 rounded px-2 py-1 text-center text-[11px] disabled:opacity-60 ${
              skipped
                ? 'bg-slate-700 text-slate-200'
                : 'border border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {skipped ? '↺ Care' : "I don't care"}
          </button>
          {(item.requestedByMe || markedForDelete) && (
            <button
              type="button"
              onClick={() => void toggleDelete()}
              disabled={deleteBusy}
              title="You requested this - mark it OK to delete"
              className={`w-28 shrink-0 whitespace-nowrap rounded px-2 py-1 text-center text-[11px] disabled:opacity-60 ${
                markedForDelete
                  ? 'bg-rose-800 font-semibold text-rose-100'
                  : 'border border-rose-900/70 text-rose-300 hover:border-rose-700'
              }`}
            >
              {markedForDelete ? '✓ OK to delete' : 'OK to delete'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
