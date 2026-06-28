'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '@/lib/types';
import SearchBox from './SearchBox';

interface Library {
  id: string;
  title: string;
  kind: string;
  sizeBytes: number;
  itemCount: number;
}

function initials(u: SessionUser): string {
  const s = u.username ?? u.email ?? '?';
  return s.slice(0, 2).toUpperCase();
}

// Module-level cache so the rail renders instantly on every client-side
// navigation (AppShell remounts per page) instead of flashing + refetching.
const shellCache: {
  user: SessionUser | null;
  appTitle: string;
  libraries: Library[];
} = { user: null, appTitle: 'Keeparr', libraries: [] };

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<SessionUser | null>(shellCache.user);
  const [appTitle, setAppTitle] = useState(shellCache.appTitle);
  const [libraries, setLibraries] = useState<Library[]>(shellCache.libraries);
  const [browseOpen, setBrowseOpen] = useState(pathname.startsWith('/library'));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user);
        shellCache.user = d.user;
        if (d.appTitle) {
          setAppTitle(d.appTitle);
          shellCache.appTitle = d.appTitle;
        }
      })
      .catch(() => {});
    fetch('/api/sections')
      .then((r) => r.json())
      .then((d) => {
        setLibraries(d.sections ?? []);
        shellCache.libraries = d.sections ?? [];
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const onLibrary = pathname.startsWith('/library');
  const selected = new Set(
    onLibrary ? (searchParams.get('sections') || '').split(',').filter(Boolean) : []
  );

  function browseTo(sectionIds: string[]) {
    const qs = sectionIds.length ? `?sections=${sectionIds.join(',')}` : '';
    router.push(`/library${qs}`);
  }
  function toggleLibrary(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    browseTo([...next]);
  }

  const navItem = (
    href: string,
    label: string,
    active: boolean,
    icon: string
  ) => (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-slate-800 text-white border-l-2 border-brand pl-[10px]'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-white border-l-2 border-transparent'
      }`}
    >
      <span aria-hidden className="w-4 text-center">{icon}</span>
      {label}
    </Link>
  );

  return (
    <div className="h-screen overflow-hidden bg-app text-slate-200 flex">
      {/* Left rail */}
      <aside className="w-60 shrink-0 bg-rail border-r border-slate-800 flex flex-col">
        <Link
          href="/"
          className="flex items-center gap-2 h-14 px-4 border-b border-slate-800 shrink-0"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-slate-900 font-black">
            K
          </span>
          <span className="text-lg font-bold text-brand truncate">{appTitle}</span>
        </Link>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {navItem('/', 'Keep', pathname === '/', '✦')}

          {/* Browse (expandable libraries) */}
          <div>
            <div
              className={`flex items-center rounded-md text-sm ${
                onLibrary
                  ? 'bg-slate-800 text-white border-l-2 border-brand'
                  : 'text-slate-400 border-l-2 border-transparent'
              }`}
            >
              <Link
                href="/library"
                className="flex items-center gap-3 px-3 py-2 flex-1 hover:text-white"
              >
                <span aria-hidden className="w-4 text-center">▦</span>
                Browse
              </Link>
              <button
                onClick={() => setBrowseOpen((o) => !o)}
                aria-label={browseOpen ? 'Collapse libraries' : 'Expand libraries'}
                className="px-2 py-2 text-slate-500 hover:text-white"
              >
                {browseOpen ? '▾' : '▸'}
              </button>
            </div>
            {browseOpen && (
              <div className="mt-1 ml-3 space-y-0.5 border-l border-slate-800 pl-2">
                <button
                  onClick={() => browseTo([])}
                  className={`block w-full text-left rounded px-2 py-1 text-xs ${
                    onLibrary && selected.size === 0
                      ? 'text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All libraries
                </button>
                {libraries.map((l) => {
                  const on = selected.size === 0 || selected.has(l.id);
                  return (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleLibrary(l.id)}
                        className="h-3 w-3 accent-brand"
                      />
                      <span className="truncate">{l.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {navItem('/stats', 'Big Picture', pathname.startsWith('/stats'), '◴')}
          {user?.isAdmin &&
            navItem(
              '/settings/general',
              'Settings',
              pathname.startsWith('/settings'),
              '⚙'
            )}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-rail border-b border-slate-800 flex items-center gap-4 px-4">
          <div className="flex-1 min-w-0">
            <SearchBox />
          </div>
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full hover:bg-slate-800 p-1 pr-2"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-700 text-xs font-semibold">
                {user ? initials(user) : '…'}
              </span>
            </button>
            {menuOpen && user && (
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-700 bg-panel shadow-xl p-3 text-sm z-30">
                <div className="font-medium truncate">{user.username ?? 'User'}</div>
                <div className="text-xs text-slate-500 truncate">
                  {user.email ?? '—'}
                </div>
                {user.isAdmin && (
                  <div className="mt-1 inline-block rounded bg-brand/20 text-brand text-[10px] px-1.5 py-0.5">
                    Admin
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  Profile is managed by your Plex account.
                </p>
                <button
                  onClick={logout}
                  className="mt-2 w-full rounded-md border border-slate-700 px-3 py-1.5 text-left hover:border-slate-500"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
