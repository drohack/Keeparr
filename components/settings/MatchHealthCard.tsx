'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatSize } from '@/lib/format';
import { Card, btnGhost } from './ui';

interface Unmatched {
  sizeBytes: number;
}
interface Health {
  matched: number;
  unmatched: Unmatched[];
  missing: { shows: number; movies: number };
}

/** Sonarr/Radarr match health, as setup-time feedback next to the instance
 *  config: how many titles matched, plus problem counts. The full drill-down
 *  lists (titles downloaded in *arr but not in the media server, items with no
 *  external id) live on the admin Problems page — this card just summarizes
 *  and links. Admin-only. */
export default function MatchHealthCard() {
  const [data, setData] = useState<Health | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const d = await fetch('/api/admin/arr-health').then((r) => r.json());
    setData(d);
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  async function resync() {
    setResyncing(true);
    await fetch('/api/admin/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: 'arr' }),
    });
    // Poll the arr job until it finishes, then reload the health snapshot.
    pollRef.current = setInterval(async () => {
      const j = await fetch('/api/admin/jobs').then((r) => r.json());
      const arr = (j.jobs ?? []).find((x: { jobId: string }) => x.jobId === 'arr');
      if (arr && arr.lastStatus !== 'running') {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setResyncing(false);
        load();
      }
    }, 2000);
  }

  const missingTotal = (data?.missing?.shows ?? 0) + (data?.missing?.movies ?? 0);
  const unmatched = data?.unmatched ?? [];
  const unmatchedBytes = unmatched.reduce((a, u) => a + (u.sizeBytes || 0), 0);

  return (
    <Card title="Match health (Sonarr / Radarr)">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-300">
          <span className="font-semibold text-white">{data?.matched ?? '—'}</span> matched
        </span>
        <span className={missingTotal > 0 || unmatched.length > 0 ? 'text-amber-400' : 'text-slate-300'}>
          <span className="font-semibold">{data ? unmatched.length : '—'}</span> in *arr, not in
          the server
          {unmatchedBytes > 0 && (
            <span className="text-slate-500"> · {formatSize(unmatchedBytes)}</span>
          )}
        </span>
        <span className={missingTotal > 0 ? 'text-amber-400' : 'text-slate-300'}>
          <span className="font-semibold">{data ? missingTotal : '—'}</span> missing IDs
        </span>
        <button onClick={resync} disabled={resyncing} className={`${btnGhost} ml-auto`} type="button">
          {resyncing ? 'Resyncing…' : 'Resync'}
        </button>
      </div>
      {data && unmatched.length === 0 && missingTotal === 0 ? (
        <p className="text-sm text-slate-400">Everything lines up. 🎉</p>
      ) : (
        <p className="text-sm text-slate-400">
          The full lists (with sizes) are on the{' '}
          <Link href="/problems" className="text-brand hover:underline">
            Problems page
          </Link>
          .
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Titles match on their tvdb/tmdb/imdb ids. &ldquo;In *arr, not in the server&rdquo; means
        files exist on disk per Sonarr/Radarr but the media server can&apos;t see them;
        &ldquo;missing IDs&rdquo; items can never match until their metadata is fixed. Resync after
        changing instances.
      </p>
    </Card>
  );
}
