'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, btnGhost } from './ui';

interface LogRow {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}
const LEVELS = ['all', 'info', 'warn', 'error'] as const;

export default function LogsPanel() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');

  const load = useCallback(async () => {
    const d = await fetch(`/api/admin/logs?level=${level}`).then((r) => r.json());
    setLogs(d.logs ?? []);
  }, [level]);

  useEffect(() => {
    load();
  }, [load]);

  async function clear() {
    await fetch('/api/admin/logs', { method: 'DELETE' });
    load();
  }

  const color = (l: string) =>
    l === 'error' ? 'text-red-400' : l === 'warn' ? 'text-amber-400' : 'text-slate-400';

  return (
    <Card title="Logs">
      <div className="mb-3 flex items-center gap-2">
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
        <button onClick={load} className={`${btnGhost} ml-auto text-xs`}>
          Refresh
        </button>
        <button onClick={clear} className={`${btnGhost} text-xs`}>
          Clear
        </button>
      </div>
      {logs.length === 0 ? (
        <p className="text-sm text-slate-500">No log entries.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-2 font-mono text-xs">
          {logs.map((l) => (
            <div key={l.id} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-slate-600">
                {new Date(l.ts * 1000).toLocaleString()}
              </span>
              <span className={`shrink-0 w-10 uppercase ${color(l.level)}`}>{l.level}</span>
              <span className="shrink-0 w-28 text-slate-500">{l.source}</span>
              <span className="min-w-0 text-slate-300">{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
