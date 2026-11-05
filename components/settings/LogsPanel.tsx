'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { formatRelative } from '@/lib/format';
import { useToast } from '../Toaster';
import { Card, btnGhost, inputCls } from './ui';

interface LogRow {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}
const LEVELS = ['all', 'info', 'warn', 'error'] as const;

const logLine = (l: LogRow) =>
  `${new Date(l.ts * 1000).toISOString()} ${l.level.toUpperCase()} [${l.source}] ${l.message}`;

export default function LogsPanel() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [auto, setAuto] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();

  // Debounce the search box -> query param.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ level });
    if (debouncedQ) params.set('q', debouncedQ);
    const d = await fetch(`/api/admin/logs?${params}`).then((r) => r.json());
    setLogs(d.logs ?? []);
  }, [level, debouncedQ]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 5s while enabled (Seerr-style, with a pause toggle).
  useEffect(() => {
    if (auto) {
      autoRef.current = setInterval(load, 5000);
      return () => {
        if (autoRef.current) clearInterval(autoRef.current);
        autoRef.current = null;
      };
    }
  }, [auto, load]);

  async function clear() {
    await fetch('/api/admin/logs', { method: 'DELETE' });
    toast('Log cleared.', 'success');
    load();
  }

  async function copyRow(l: LogRow) {
    if (await copyText(logLine(l))) {
      setCopiedId(l.id);
      setTimeout(() => setCopiedId(null), 1200);
    }
  }

  /** Export the full retained log (up to 1000 rows) as a .txt download. */
  async function download() {
    const params = new URLSearchParams({ level, limit: '1000' });
    if (debouncedQ) params.set('q', debouncedQ);
    const d = await fetch(`/api/admin/logs?${params}`).then((r) => r.json());
    const rows: LogRow[] = d.logs ?? [];
    const blob = new Blob([rows.map(logLine).join('\n') + '\n'], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keeparr-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const color = (l: string) =>
    l === 'error' ? 'text-red-400' : l === 'warn' ? 'text-amber-400' : 'text-slate-400';

  return (
    <Card title="Logs">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`rounded-md px-3 py-1 text-xs ${
              level === l ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {l}
          </button>
        ))}
        <input
          className={`${inputCls} !w-56 text-xs`}
          placeholder="Search message / source..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          onClick={() => setAuto((a) => !a)}
          className={`${btnGhost} ml-auto text-xs`}
          title="Refresh every 5 seconds"
        >
          {auto ? '⏸ Pause' : '▶ Auto-refresh'}
        </button>
        <button onClick={load} className={`${btnGhost} text-xs`}>
          Refresh
        </button>
        <button onClick={download} className={`${btnGhost} text-xs`}>
          Download
        </button>
        <button onClick={clear} className={`${btnGhost} text-xs`}>
          Clear
        </button>
      </div>
      {logs.length === 0 ? (
        <p className="text-sm text-slate-500">
          {debouncedQ ? 'No log entries match the search.' : 'No log entries.'}
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-2 font-mono text-xs">
          {logs.map((l) => (
            <div key={l.id} className="group flex gap-2 py-0.5">
              <span
                className="w-20 shrink-0 text-slate-600"
                title={new Date(l.ts * 1000).toLocaleString()}
              >
                {formatRelative(l.ts)}
              </span>
              <span className={`w-10 shrink-0 uppercase ${color(l.level)}`}>{l.level}</span>
              <span className="w-28 shrink-0 text-slate-500">{l.source}</span>
              <span className="min-w-0 flex-1 text-slate-300">{l.message}</span>
              <button
                onClick={() => copyRow(l)}
                className="shrink-0 text-slate-600 opacity-0 hover:text-white group-hover:opacity-100"
                title="Copy this line"
              >
                {copiedId === l.id ? '✓' : '⧉'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
