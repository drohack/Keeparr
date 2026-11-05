'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Shared form chrome for the Settings panels. */
export const inputCls =
  'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand';
export const btnCls =
  'rounded-md bg-brand hover:bg-brand-light text-ink font-semibold px-4 py-2 text-sm disabled:opacity-60';
export const btnGhost =
  'rounded-md border border-slate-700 hover:border-slate-500 px-4 py-2 text-sm disabled:opacity-60';

/**
 * At-a-glance connection state, so a page of cards doesn't require clicking
 * "Test" on each one to learn which are actually set up.
 *
 * `ok` means CONFIGURED (credentials stored), not "reachable right now" -
 * proving reachability would mean firing a request per service on every page
 * load. Test is still the thing that proves it works; this only answers "have I
 * filled this in".
 */
export function StatusPill({
  state,
  label,
}: {
  state: 'ok' | 'off' | 'warn';
  label: string;
}) {
  const tone =
    state === 'ok'
      ? 'border-emerald-700 bg-emerald-950 text-emerald-300'
      : state === 'warn'
        ? 'border-amber-700 bg-amber-950 text-amber-300'
        : 'border-slate-700 bg-slate-900 text-slate-400';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

export function Card({
  title,
  status,
  children,
}: {
  title: string;
  /** Optional right-aligned badge, e.g. <StatusPill/>. */
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 break-inside-avoid rounded-xl border border-slate-800 bg-panel p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-lg">{title}</h2>
        {status}
      </div>
      {children}
    </section>
  );
}

/**
 * Single full-width column of stacked cards. (Multi-column reflow jumps around on
 * resize.) Cards carry their own bottom margin, so they just stack. Jobs & Cache
 * opts out with its own 2-column grid.
 */
export function CardColumns({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

const TABS = [
  { href: '/settings/general', label: 'General' },
  { href: '/settings/users', label: 'Users' },
  { href: '/settings/connections', label: 'Connections' },
  { href: '/settings/jobs', label: 'Jobs & Cache' },
  { href: '/settings/logs', label: 'Logs' },
  { href: '/settings/about', label: 'About' },
];

/** Settings shell: a horizontal sub-tab nav + the active panel. */
export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="px-6 py-6">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                active
                  ? 'border-brand text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
