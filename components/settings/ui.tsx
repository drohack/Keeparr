'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Shared form chrome for the Settings panels. */
export const inputCls =
  'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand';
export const btnCls =
  'rounded-md bg-brand hover:bg-brand-light text-slate-900 font-semibold px-4 py-2 text-sm disabled:opacity-60';
export const btnGhost =
  'rounded-md border border-slate-700 hover:border-slate-500 px-4 py-2 text-sm disabled:opacity-60';

export function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 break-inside-avoid rounded-xl border border-slate-800 bg-panel p-5">
      <h2 className="font-semibold text-lg mb-3">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Card container that flows cards into responsive columns to use the full width.
 * Cards `break-inside-avoid`, so each stays intact within a column.
 */
export function CardColumns({ children }: { children: React.ReactNode }) {
  return <div className="columns-1 gap-5 lg:columns-2 2xl:columns-3">{children}</div>;
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
