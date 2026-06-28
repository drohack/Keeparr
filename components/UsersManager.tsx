'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminUserRow } from '@/lib/types';

function fmtDate(epochSeconds: number | null): string {
  if (!epochSeconds) return '—';
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

function initials(u: AdminUserRow): string {
  const s = u.username ?? u.email ?? '?';
  return s.slice(0, 2).toUpperCase();
}

export default function UsersManager() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [openSignin, setOpenSignin] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const d = await fetch('/api/admin/users').then((r) => r.json());
    setUsers(d.users ?? []);
    setOpenSignin(d.openSignin !== false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Optimistically patch one user; revert on failure.
  async function patchUser(
    target: AdminUserRow,
    patch: Partial<Pick<AdminUserRow, 'isAdmin' | 'enabled'>>
  ) {
    setError('');
    setBusy(target.plexUserId);
    setUsers((prev) =>
      prev
        ? prev.map((u) =>
            u.plexUserId === target.plexUserId ? { ...u, ...patch } : u
          )
        : prev
    );
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plexUserId: target.plexUserId, ...patch }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setError(`Couldn't update ${target.username ?? target.plexUserId}.`);
      setUsers((prev) =>
        prev
          ? prev.map((u) =>
              u.plexUserId === target.plexUserId ? { ...target } : u
            )
          : prev
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleOpenSignin(next: boolean) {
    setOpenSignin(next); // optimistic
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ openSignin: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setOpenSignin(!next);
      setError("Couldn't change the sign-in setting.");
    }
  }

  async function importUsers() {
    setImporting(true);
    setMsg('');
    setError('');
    try {
      const res = await fetch('/api/admin/users/import', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? String(res.status));
      setMsg(`Imported ${d.imported} user(s) from Plex.`);
      await load();
    } catch {
      setError('Import failed — is a Plex server connected?');
    } finally {
      setImporting(false);
    }
  }

  if (users === null) {
    return <p className="text-sm text-slate-500">Loading users…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Access controls */}
      <div className="rounded-xl border border-slate-800 bg-panel p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={openSignin}
            onChange={(e) => toggleOpenSignin(e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          <span>
            <span className="font-medium">Open sign-in</span>
            <span className="text-slate-500">
              {' '}
              — anyone with access to your Plex server can sign in. Turn off to
              allow only the accounts you’ve enabled below.
            </span>
          </span>
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={importUsers}
            disabled={importing}
            className="rounded-md border border-slate-700 hover:border-slate-500 px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {importing ? 'Importing…' : 'Import users from Plex'}
          </button>
          {msg && <span className="text-sm text-slate-400">{msg}</span>}
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-950/30 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {users.length === 0 ? (
        <p className="text-sm text-slate-500">
          No users yet. They appear after their first Plex sign-in, or import
          them above.
        </p>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-panel divide-y divide-slate-800">
          {users.map((u) => (
            <div key={u.plexUserId} className="flex items-center gap-3 px-4 py-3">
              {u.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={u.thumb}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover bg-slate-800"
                />
              ) : (
                <div className="h-9 w-9 rounded-full bg-slate-800 grid place-items-center text-xs text-slate-400">
                  {initials(u)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {u.username ?? u.email ?? u.plexUserId}
                  </span>
                  {u.isOwner && (
                    <span className="rounded bg-brand/20 text-brand text-xs px-1.5 py-0.5">
                      Owner
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {u.email ?? '—'} · last seen {fmtDate(u.lastLogin)}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm shrink-0">
                <span className="text-slate-400">Enabled</span>
                <input
                  type="checkbox"
                  checked={u.enabled}
                  disabled={u.isOwner || busy === u.plexUserId}
                  onChange={(e) => patchUser(u, { enabled: e.target.checked })}
                  className="h-4 w-4 accent-brand disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-2 text-sm shrink-0">
                <span className="text-slate-400">Admin</span>
                <input
                  type="checkbox"
                  checked={u.isAdmin}
                  disabled={u.isOwner || busy === u.plexUserId}
                  onChange={(e) => patchUser(u, { isAdmin: e.target.checked })}
                  className="h-4 w-4 accent-brand disabled:opacity-50"
                />
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
