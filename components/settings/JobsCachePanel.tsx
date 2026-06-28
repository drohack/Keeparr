'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSize } from '@/lib/format';
import { Card, CardColumns, btnCls, btnGhost, inputCls } from './ui';

type JobSchedule =
  | { type: 'interval'; minutes: number }
  | { type: 'daily'; hour: number; minute: number };

interface JobRow {
  jobId: string;
  label: string;
  lastStatus: string;
  lastMessage: string | null;
  lastRun: number | null;
  schedule: JobSchedule;
}
interface RunRow {
  id: number;
  jobId: string;
  startedAt: number;
  status: string | null;
  message: string | null;
}

function hhmm(s: JobSchedule): string {
  if (s.type !== 'daily') return '03:00';
  return `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
}

export default function JobsCachePanel() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [recent, setRecent] = useState<RunRow[]>([]);
  const [schedules, setSchedules] = useState<Record<string, JobSchedule>>({});
  const [images, setImages] = useState<{ count: number; bytes: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [cacheMsg, setCacheMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    const d = await fetch('/api/admin/jobs').then((r) => r.json());
    const rows: JobRow[] = d.jobs ?? [];
    setJobs(rows);
    setRecent(d.recent ?? []);
    setSchedules((prev) =>
      Object.keys(prev).length ? prev : Object.fromEntries(rows.map((j) => [j.jobId, j.schedule]))
    );
    return rows;
  }, []);

  const loadCache = useCallback(async () => {
    const d = await fetch('/api/admin/cache').then((r) => r.json());
    setImages(d.images ?? null);
  }, []);

  useEffect(() => {
    loadJobs();
    loadCache();
  }, [loadJobs, loadCache]);

  const anyRunning = jobs.some((j) => j.lastStatus === 'running');
  useEffect(() => {
    if (anyRunning && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const rows = await loadJobs();
        if (!rows.some((j) => j.lastStatus === 'running') && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [anyRunning, loadJobs]);

  function setSchedule(jobId: string, s: JobSchedule) {
    setSchedules((m) => ({ ...m, [jobId]: s }));
  }

  async function saveSchedules() {
    setSaving(true);
    setMsg('');
    try {
      await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobSchedules: schedules }),
      });
      setMsg('Saved.');
    } finally {
      setSaving(false);
    }
  }

  async function runJob(job: string) {
    await fetch('/api/admin/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job }),
    });
    await loadJobs();
  }

  async function clearCache(target: string) {
    setCacheMsg('Clearing…');
    const r = await fetch('/api/admin/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    }).then((x) => x.json());
    setCacheMsg(r.message ?? 'Done.');
    loadCache();
  }

  return (
    <CardColumns>
      <Card title="Scheduled jobs">
        <p className="text-sm text-slate-400 mb-3">
          Each job runs on an interval or once daily (server local time). Run any now.
        </p>
        <div className="space-y-3">
          {jobs.map((j) => {
            const s = schedules[j.jobId] ?? j.schedule;
            return (
              <div
                key={j.jobId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
              >
                <div className="min-w-[12rem]">
                  <div className="text-sm font-medium">{j.label}</div>
                  <div className="text-xs text-slate-500">
                    {j.lastStatus === 'running'
                      ? 'Running…'
                      : j.lastStatus === 'never'
                        ? 'Never run'
                        : `${j.lastStatus}${j.lastMessage ? ` — ${j.lastMessage}` : ''}`}
                  </div>
                </div>
                <select
                  className={`${inputCls} w-28`}
                  value={s.type}
                  onChange={(e) =>
                    setSchedule(
                      j.jobId,
                      e.target.value === 'daily'
                        ? { type: 'daily', hour: 3, minute: 0 }
                        : { type: 'interval', minutes: 60 }
                    )
                  }
                >
                  <option value="interval">Every…</option>
                  <option value="daily">Daily at…</option>
                </select>
                {s.type === 'interval' ? (
                  <label className="flex items-center gap-1 text-xs text-slate-400">
                    <input
                      className={`${inputCls} w-20`}
                      type="number"
                      min={0}
                      value={s.minutes}
                      onChange={(e) =>
                        setSchedule(j.jobId, { type: 'interval', minutes: Number(e.target.value) })
                      }
                    />
                    min
                  </label>
                ) : (
                  <input
                    className={`${inputCls} w-28`}
                    type="time"
                    value={hhmm(s)}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(':').map(Number);
                      setSchedule(j.jobId, { type: 'daily', hour: h || 0, minute: m || 0 });
                    }}
                  />
                )}
                <button
                  onClick={() => runJob(j.jobId)}
                  disabled={j.lastStatus === 'running'}
                  className={`${btnGhost} ml-auto`}
                >
                  {j.lastStatus === 'running' ? 'Running…' : 'Run now'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={saveSchedules} disabled={saving} className={btnCls}>
            {saving ? 'Saving…' : 'Save schedules'}
          </button>
          <button onClick={() => runJob('all')} disabled={anyRunning} className={btnGhost}>
            Run all now
          </button>
          {msg && <span className="text-sm text-slate-300">{msg}</span>}
        </div>
      </Card>

      <Card title="Cache">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-40">Poster images</span>
            <span className="text-slate-500">
              {images ? `${images.count} files · ${formatSize(images.bytes)}` : '—'}
            </span>
            <button onClick={() => clearCache('images')} className={`${btnGhost} ml-auto`}>
              Clear
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-40">Seerr requests</span>
            <span className="text-slate-500">rebuilt by the Seerr job</span>
            <button onClick={() => clearCache('requests')} className={`${btnGhost} ml-auto`}>
              Clear
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-40">Watch history</span>
            <span className="text-slate-500">rebuilt by the Tautulli job</span>
            <button onClick={() => clearCache('watch')} className={`${btnGhost} ml-auto`}>
              Clear
            </button>
          </div>
        </div>
        {cacheMsg && <p className="mt-2 text-xs text-slate-400">{cacheMsg}</p>}
        <p className="mt-2 text-[11px] text-slate-500">
          Library titles/metadata refresh on the next scan — clearing posters makes cover
          art re-fetch from Plex.
        </p>
      </Card>

      <Card title="Recent activity">
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500">No job runs yet.</p>
        ) : (
          <div className="divide-y divide-slate-800 text-sm">
            {recent.map((r) => (
              <div key={r.id} className="flex items-baseline gap-3 py-1.5">
                <span className="w-40 shrink-0 text-xs text-slate-500">
                  {new Date(r.startedAt * 1000).toLocaleString()}
                </span>
                <span
                  className={`w-14 shrink-0 text-xs ${
                    r.status === 'error' ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {r.status}
                </span>
                <span className="w-28 shrink-0 text-slate-400">{r.jobId}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{r.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </CardColumns>
  );
}
