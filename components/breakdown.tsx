'use client';

import { useState } from 'react';
import { formatSize } from '@/lib/format';

/**
 * Shared visual language for "what's kept vs what you don't care about" across
 * the Keep totals column and the Big Picture dashboard. One palette, used
 * everywhere, so colors mean the same thing on every screen.
 *
 * Undecided is deliberately BLUE (not gray) so it never blends into the empty
 * "free space" track of a fill bar.
 */
export const TONE = {
  // "Kept by you" (bright brand gold) vs "Kept by others" (the brand's darker
  // gold) — same protected family, two clean shades (not a muddy brown).
  kept: { bar: 'bg-brand', dot: 'bg-brand', text: 'text-brand', stroke: 'stroke-brand' },
  keptOther: { bar: 'bg-brand-dark', dot: 'bg-brand-dark', text: 'text-brand-dark', stroke: 'stroke-brand-dark' },
  dontcare: { bar: 'bg-rose-500', dot: 'bg-rose-500', text: 'text-rose-400', stroke: 'stroke-rose-500' },
  undecided: { bar: 'bg-blue-500', dot: 'bg-blue-500', text: 'text-blue-400', stroke: 'stroke-blue-500' },
  other: { bar: 'bg-slate-600', dot: 'bg-slate-600', text: 'text-slate-400', stroke: 'stroke-slate-600' },
  free: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-400', stroke: 'stroke-emerald-500' },
} as const;

export type ToneKey = keyof typeof TONE;

/** Categorical palette for "by library" — alternating violet & teal shades.
 *  Both hues sit far from the status palette (amber / rose / blue) so a library
 *  color can never be mistaken for a keep/don't-care/undecided color. */
export const LIB_BAR = [
  'bg-violet-500',
  'bg-teal-400',
  'bg-violet-300',
  'bg-teal-600',
  'bg-violet-700',
  'bg-teal-300',
  'bg-violet-400',
  'bg-teal-500',
] as const;
export const LIB_STROKE = [
  'stroke-violet-500',
  'stroke-teal-400',
  'stroke-violet-300',
  'stroke-teal-600',
  'stroke-violet-700',
  'stroke-teal-300',
  'stroke-violet-400',
  'stroke-teal-500',
] as const;
export const libColor = (i: number) => LIB_BAR[i % LIB_BAR.length];
export const libStroke = (i: number) => LIB_STROKE[i % LIB_STROKE.length];

export interface Segment {
  value: number; // bytes (or any unit; only ratios matter)
  tone?: ToneKey;
  bar?: string; // overrides the TONE bar class (for categorical colors)
  stroke?: string; // overrides the TONE stroke class (donut)
  dot?: string; // overrides the tooltip dot class
  label?: string; // tooltip
}

const segBar = (s: Segment) => s.bar ?? (s.tone ? TONE[s.tone].bar : 'bg-slate-600');
const segStroke = (s: Segment) =>
  s.stroke ?? (s.tone ? TONE[s.tone].stroke : 'stroke-slate-600');
const segDot = (s: Segment) =>
  s.dot ?? s.bar ?? (s.tone ? TONE[s.tone].dot : 'bg-slate-600');

interface HoverState {
  i: number;
  x: number;
  y: number;
}

/** A small cursor-following tooltip used by the interactive charts. */
function ChartTooltip({
  x,
  y,
  dot,
  label,
  value,
  share,
}: {
  x: number;
  y: number;
  dot: string;
  label: string;
  value: string;
  share: number;
}) {
  return (
    <div
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-xs shadow-xl"
      style={{ left: x, top: y - 10 }}
    >
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-sm ${dot}`} />
        <span className="text-slate-200">{label}</span>
        <span className="font-mono text-white">{value}</span>
        <span className="text-slate-400">{share}%</span>
      </span>
    </div>
  );
}

/**
 * A stacked bar. With `max` set, the segments only fill `sum/max` of the width
 * and the remaining track shows through — i.e. the empty part IS the free space
 * (a fuel gauge). Without `max`, segments fill the whole bar (a composition).
 */
export function StackedBar({
  segments,
  height = 'h-2.5',
  track = 'bg-slate-800',
  rounded = true,
  max,
}: {
  segments: Segment[];
  height?: string;
  track?: string;
  rounded?: boolean;
  max?: number;
}) {
  const sum = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const total = (max && max > sum ? max : sum) || 1;
  const [hover, setHover] = useState<HoverState | null>(null);
  const hs = hover && segments[hover.i] ? segments[hover.i] : null;
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div
        className={`flex w-full overflow-hidden ${height} ${track} ${
          rounded ? 'rounded-full' : 'rounded'
        }`}
      >
        {segments.map((s, i) =>
          s.value > 0 ? (
            <div
              key={i}
              onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
              className={`${segBar(s)} h-full cursor-default transition-[filter,opacity] duration-150 ${
                hover && hover.i !== i ? 'opacity-40' : ''
              } ${hover?.i === i ? 'brightness-125' : ''}`}
              style={{ width: `${(s.value / total) * 100}%`, minWidth: '3px' }}
            />
          ) : null
        )}
      </div>
      {hs && (
        <ChartTooltip
          x={hover!.x}
          y={hover!.y}
          dot={segDot(hs)}
          label={hs.label ?? ''}
          value={formatSize(hs.value)}
          share={Math.round((hs.value / total) * 100)}
        />
      )}
    </div>
  );
}

/**
 * A donut for "share of a whole". With `max`, the arcs only cover `sum/max` and
 * the rest of the ring (the track) reads as free/remaining.
 */
export function Donut({
  segments,
  size = 128,
  thickness = 16,
  center,
  centerSub,
  max,
}: {
  segments: Segment[];
  size?: number;
  thickness?: number;
  center?: string;
  centerSub?: string;
  max?: number;
}) {
  const sum = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const total = (max && max > sum ? max : sum) || 1;
  // Reserve room so a hovered slice can grow (POP px) without clipping the SVG.
  const POP = 6;
  const r = (size - thickness - POP) / 2;
  const c = 2 * Math.PI * r;
  const [hover, setHover] = useState<HoverState | null>(null);
  const hs = hover && segments[hover.i] ? segments[hover.i] : null;
  let offset = 0;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      onMouseLeave={() => setHover(null)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          className="stroke-slate-800"
        />
        {segments.map((s, i) => {
          const len = (Math.max(0, s.value) / total) * c;
          if (len <= 0) return null;
          const active = hover?.i === i;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              // hovered slice pops out (thicker) and brightens; others dim
              strokeWidth={active ? thickness + POP : thickness}
              className={`${segStroke(s)} cursor-default transition-[stroke-width,opacity,filter] duration-150 ${
                active ? 'brightness-125' : hover ? 'opacity-50' : ''
              }`}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {(center || centerSub) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {center && <span className="text-xl font-bold leading-none">{center}</span>}
          {centerSub && (
            <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              {centerSub}
            </span>
          )}
        </div>
      )}
      {hs && (
        <ChartTooltip
          x={hover!.x}
          y={hover!.y}
          dot={segDot(hs)}
          label={hs.label ?? ''}
          value={formatSize(hs.value)}
          share={Math.round((hs.value / total) * 100)}
        />
      )}
    </div>
  );
}

/** A legend / breakdown row: colored dot, label, value, optional secondary. */
export function LegendRow({
  tone,
  dotClass,
  label,
  value,
  sub,
  muted,
}: {
  tone?: ToneKey;
  dotClass?: string;
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  const dot = dotClass ?? (tone ? TONE[tone].dot : 'bg-slate-600');
  return (
    <div className={`flex items-center gap-2 text-sm ${muted ? 'opacity-70' : ''}`}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-slate-300">{label}</span>
      <span className="shrink-0 font-mono text-slate-200">{value}</span>
      {sub && (
        <span className="shrink-0 min-w-[2.75rem] text-right font-mono text-xs text-slate-500">
          {sub}
        </span>
      )}
    </div>
  );
}

export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

export interface LibraryBreakdown {
  id: string;
  title: string;
  kind: string;
  items: number;
  bytes: number;
  keptItems: number;
  keptBytes: number;
  keptByMeItems: number;
  keptByMeBytes: number;
  dontcareItems: number;
  dontcareBytes: number;
  undecidedItems: number;
  undecidedBytes: number;
}

export type OverviewTotals = Omit<LibraryBreakdown, 'id' | 'title' | 'kind'>;

export interface Overview {
  storage:
    | { configured: true; totalBytes: number; freeBytes: number; usedBytes: number }
    | { configured: false };
  mediaUsedBytes: number;
  libraries: LibraryBreakdown[];
  totals: OverviewTotals;
}

/** The three composition segments (kept / don't care / undecided) for a row. */
export function compositionSegments(b: {
  keptBytes: number;
  dontcareBytes: number;
  undecidedBytes: number;
}): Segment[] {
  return [
    { tone: 'kept', value: b.keptBytes, label: 'Kept' },
    { tone: 'dontcare', value: b.dontcareBytes, label: 'You don’t care' },
    { tone: 'undecided', value: b.undecidedBytes, label: 'Undecided' },
  ];
}

/** Four-way split that separates your keeps from everyone else's. The bytes
 *  partition the row total: keptByMe + (kept−keptByMe) + dontcare + undecided. */
export function compositionSegmentsSplit(b: {
  keptBytes: number;
  keptByMeBytes: number;
  dontcareBytes: number;
  undecidedBytes: number;
}): Segment[] {
  return [
    { tone: 'kept', value: b.keptByMeBytes, label: 'Kept by you' },
    { tone: 'keptOther', value: Math.max(0, b.keptBytes - b.keptByMeBytes), label: 'Kept by others' },
    { tone: 'dontcare', value: b.dontcareBytes, label: 'You don’t care' },
    { tone: 'undecided', value: b.undecidedBytes, label: 'Undecided (yours to review)' },
  ];
}
