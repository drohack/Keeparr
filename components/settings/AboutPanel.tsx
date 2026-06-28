'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';

export default function AboutPanel() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    fetch('/api/about')
      .then((r) => r.json())
      .then((d) => setVersion(d.version ?? ''))
      .catch(() => {});
  }, []);

  return (
    <Card title="About Keeparr">
      <p className="text-sm text-slate-300">
        Keeparr helps everyone with access to your Plex server decide what’s worth{' '}
        <strong>keeping</strong>, and surfaces what could be deleted to reclaim space.
      </p>
      <p className="mt-3 text-sm text-amber-400">
        Keeparr never deletes anything — it only tags and reports. You delete in Plex /
        Sonarr / Radarr.
      </p>
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-slate-500">Version</dt>
        <dd>{version || '—'}</dd>
        <dt className="text-slate-500">Keep</dt>
        <dd>Global — if anyone keeps a title, it’s kept for all.</dd>
        <dt className="text-slate-500">Don’t care</dt>
        <dd>Per-user — hides a title from your own triage only.</dd>
        <dt className="text-slate-500">Stack</dt>
        <dd>Next.js · SQLite · Plex / Tautulli / Overseerr</dd>
      </dl>
    </Card>
  );
}
