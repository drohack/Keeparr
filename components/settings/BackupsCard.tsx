'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatRelative, formatSize } from '@/lib/format';
import { useToast } from '../Toaster';
import { Card, btnCls, btnGhost } from './ui';

interface BackupRow {
  name: string;
  sizeBytes: number;
  createdAt: number;
}

const ctrl =
  'rounded-md bg-slate-800 border border-slate-700 px-2 py-2 text-sm focus:outline-none focus:border-brand';

/**
 * Database backups: create/list/download/delete/restore + the retention
 * setting. Backups run on the scheduled 'backup' job too (Scheduled jobs card).
 */
export default function BackupsCard() {
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [retention, setRetention] = useState(14);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    const d = await fetch('/api/admin/backups').then((r) => r.json());
    setBackups(Array.isArray(d.backups) ? d.backups : []);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.backupRetention === 'number') setRetention(d.backupRetention);
      })
      .catch(() => {});
  }, [load]);

  async function backupNow() {
    setBusy(true);
    setMsg('Backing up...');
    try {
      await fetch('/api/admin/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      });
      // The route awaits the backup job, so the list is current once this resolves.
      await new Promise((res) => setTimeout(res, 1200));
      await load();
      setMsg('Backup created.');
      toast('Backup created.', 'success');
    } finally {
      setBusy(false);
    }
  }

  async function restore(name: string) {
    if (
      !window.confirm(
        `Restore ${name}?\n\nThe current database is snapshotted first (pre-restore), then replaced. Everyone's keeps/settings revert to this backup.`
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg('Restoring...');
    try {
      const r = await fetch('/api/admin/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', name }),
      });
      if (r.ok) {
        setMsg('Restored - reloading...');
        window.location.reload();
      } else {
        const d = await r.json().catch(() => ({}));
        setMsg(`Restore failed: ${d.error ?? r.status}`);
        toast(`Restore failed: ${d.error ?? r.status}`, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    await fetch('/api/admin/backups', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await load();
  }

  async function saveRetention() {
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupRetention: retention }),
    });
    setMsg('Retention saved.');
  }

  return (
    <Card title="Backups">
      <p className="text-sm text-slate-400">
        Snapshots of the whole database (keeps, users, settings). The scheduled{' '}
        <span className="text-slate-300">Backup</span> job runs daily; old backups are
        pruned past the retention count.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={backupNow} disabled={busy} className={btnCls}>
          Backup now
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-400">
          Keep
          <input
            className={`${ctrl} w-16`}
            type="number"
            min={1}
            value={retention}
            onChange={(e) => setRetention(Math.max(1, Number(e.target.value) || 1))}
            onBlur={saveRetention}
          />
          backups
        </label>
      </div>

      {backups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No backups yet.</p>
      ) : (
        <div className="mt-3 divide-y divide-slate-800 text-sm">
          {backups.map((b) => (
            <div key={b.name} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">{b.name}</div>
                <div
                  className="text-[11px] text-slate-500"
                  title={new Date(b.createdAt * 1000).toLocaleString()}
                >
                  {formatRelative(b.createdAt)} · {formatSize(b.sizeBytes)}
                </div>
              </div>
              <a
                className="shrink-0 text-xs text-slate-400 underline hover:text-white"
                href={`/api/admin/backups/download?name=${encodeURIComponent(b.name)}`}
              >
                Download
              </a>
              <button
                onClick={() => restore(b.name)}
                disabled={busy}
                className="shrink-0 text-xs text-amber-400 underline hover:text-amber-300 disabled:opacity-50"
              >
                Restore
              </button>
              <button
                onClick={() => remove(b.name)}
                disabled={busy}
                className="shrink-0 text-xs text-red-400 underline hover:text-red-300 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-slate-400">{msg}</p>}
    </Card>
  );
}
