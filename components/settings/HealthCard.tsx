'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';

interface HealthIssue {
  id: string;
  severity: 'warning' | 'error';
  message: string;
  docSlug: string;
}

const DOCS_BASE = 'https://github.com/drohack/Keeparr#';

/** Standing health warnings (Servarr System -> Status style), with fix-it links. */
export default function HealthCard() {
  const [issues, setIssues] = useState<HealthIssue[] | null>(null);

  useEffect(() => {
    fetch('/api/admin/health')
      .then((r) => r.json())
      .then((d) => setIssues(Array.isArray(d.issues) ? d.issues : []))
      .catch(() => setIssues([]));
  }, []);

  if (issues === null) return null; // no flash while loading

  return (
    <Card title="Health">
      {issues.length === 0 ? (
        <p className="text-sm text-emerald-400">✓ No issues — everything looks healthy.</p>
      ) : (
        <div className="space-y-2">
          {issues.map((i) => (
            <div
              key={i.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                i.severity === 'error'
                  ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              <span aria-hidden className="mt-0.5 shrink-0">
                {i.severity === 'error' ? '✕' : '⚠'}
              </span>
              <span className="min-w-0 flex-1">{i.message}</span>
              <a
                href={`${DOCS_BASE}${i.docSlug}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs underline opacity-80 hover:opacity-100"
              >
                More info
              </a>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
