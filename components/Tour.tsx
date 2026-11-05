'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { availableSteps, type TourPlacement, type TourStep } from '@/lib/tour';
import { DELETE_BTN_IDLE_CLASS, WatchedBadge } from './MediaCard';

const PAD = 8; // spotlight breathing room around the target
const GAP = 14; // distance between spotlight and popup
const MARGIN = 12; // keep the popup this far inside the viewport
const POPUP_W = 340;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTarget(target: string | null): HTMLElement | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  // display:none (e.g. the totals column below the lg breakpoint) has no boxes.
  return el && el.getClientRects().length > 0 ? el : null;
}

function spotlightRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  // Clip to the viewport so a tall target (the scrolling totals column) never
  // pushes its ring off-screen.
  const top = Math.max(r.top - PAD, MARGIN / 2);
  const left = Math.max(r.left - PAD, MARGIN / 2);
  const bottom = Math.min(r.bottom + PAD, window.innerHeight - MARGIN / 2);
  const right = Math.min(r.right + PAD, window.innerWidth - MARGIN / 2);
  return { top, left, width: right - left, height: bottom - top };
}

/** Popup position: the preferred side if it fits, else the opposite, else any
 *  side that fits, else centered; always clamped inside the viewport. */
function placePopup(
  spot: Rect | null,
  size: { w: number; h: number },
  preferred: TourPlacement
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, MARGIN), Math.max(MARGIN, max - MARGIN));
  if (!spot) return { top: clamp((vh - size.h) / 2, vh - size.h), left: clamp((vw - size.w) / 2, vw - size.w) };

  const opposite: Record<TourPlacement, TourPlacement> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const order = [preferred, opposite[preferred], 'right', 'bottom', 'left', 'top'] as TourPlacement[];
  const at = (p: TourPlacement) => {
    switch (p) {
      case 'top':
        return { top: spot.top - GAP - size.h, left: spot.left + spot.width / 2 - size.w / 2 };
      case 'bottom':
        return { top: spot.top + spot.height + GAP, left: spot.left + spot.width / 2 - size.w / 2 };
      case 'left':
        return { top: spot.top + spot.height / 2 - size.h / 2, left: spot.left - GAP - size.w };
      case 'right':
        return { top: spot.top + spot.height / 2 - size.h / 2, left: spot.left + spot.width + GAP };
    }
  };
  const fits = (p: TourPlacement) => {
    const pos = at(p);
    if (p === 'top') return pos.top >= MARGIN;
    if (p === 'bottom') return pos.top + size.h <= vh - MARGIN;
    if (p === 'left') return pos.left >= MARGIN;
    return pos.left + size.w <= vw - MARGIN;
  };
  const chosen = order.find(fits);
  const pos = chosen ? at(chosen) : { top: (vh - size.h) / 2, left: (vw - size.w) / 2 };
  return { top: clamp(pos.top, vh - size.h), left: clamp(pos.left, vw - size.w) };
}

/**
 * Full-screen guided tour. Dims the page, rings one `data-tour` target per
 * step and explains it in a popup. The page underneath is not clickable while
 * the tour is open: a stray poster click would record a real keep.
 */
export default function Tour({ steps: allSteps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  // Resolved once at open: steps whose target isn't on screen are dropped.
  const [steps] = useState(() =>
    availableSteps(
      allSteps,
      new Set(allSteps.map((s) => s.target).filter((t): t is string => !!t && !!findTarget(t)))
    )
  );
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    const nextSpot = el ? spotlightRect(el) : null;
    setSpot(nextSpot);
    const popup = popupRef.current;
    if (popup) {
      setPos(placePopup(nextSpot, { w: popup.offsetWidth, h: popup.offsetHeight }, step.placement));
    }
  }, [step]);

  // New step: bring the target into view, then measure.
  useLayoutEffect(() => {
    if (!step) return;
    findTarget(step.target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
  }, [step, measure]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);

  useEffect(() => {
    if (!step) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const el = findTarget(step.target);
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    if (popupRef.current) ro.observe(popupRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      ro.disconnect();
    };
  }, [step, measure]);

  const next = useCallback(() => {
    if (last) onDone();
    else setIndex((i) => i + 1);
  }, [last, onDone]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Capture phase so AppShell's global keys (`/`, `?`) don't fire mid-tour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Tab') return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, back, onDone]);

  if (!step) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="presentation">
      {/* Click shield. Dims the page itself only when nothing is spotlighted;
          otherwise the spotlight's shadow does the dimming. */}
      <div
        className={`absolute inset-0 ${spot ? '' : 'bg-black/65'}`}
        onClick={(e) => e.stopPropagation()}
      />
      {spot && (
        <div
          aria-hidden
          // outline, not Tailwind's ring: ring is a box-shadow and the dimming
          // shadow below would replace it.
          className="pointer-events-none absolute rounded-lg outline outline-2 outline-brand transition-all duration-200"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.65)',
          }}
        />
      )}
      <div
        ref={popupRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="absolute rounded-xl border border-slate-700 bg-panel p-4 text-sm text-slate-300 shadow-2xl"
        style={{
          width: POPUP_W,
          maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
          {index + 1} of {steps.length}
        </div>
        <h2 id="tour-title" className="mb-2 text-base font-semibold text-slate-200">
          {step.title}
        </h2>
        <div className="space-y-2">
          {step.body.map((p, i) =>
            typeof p === 'string' ? (
              <p key={i}>{p}</p>
            ) : (
              <p key={i}>
                <strong className="font-semibold text-slate-200">{p.term}</strong> - {p.text}
              </p>
            )
          )}
          {step.hints?.map((h) => (
            <div key={h.badge} className="flex items-center gap-2 rounded-md bg-slate-800/60 px-2 py-1.5">
              {h.badge === 'watched' ? (
                <WatchedBadge />
              ) : (
                <span
                  aria-hidden
                  className={`shrink-0 rounded border px-2 py-1 text-[11px] ${DELETE_BTN_IDLE_CLASS}`}
                >
                  OK to delete
                </span>
              )}
              <span>{h.text}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <button
              type="button"
              onClick={onDone}
              className="mr-auto text-xs text-slate-500 hover:text-slate-300"
            >
              Skip tour
            </button>
          )}
          {last && <span className="mr-auto" />}
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              className="rounded-md border border-slate-700 px-3 py-1.5 hover:border-slate-500"
            >
              Back
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            onClick={next}
            className="rounded-md bg-brand px-4 py-1.5 font-semibold text-ink hover:bg-brand-light"
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
