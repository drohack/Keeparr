'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Suggestion {
  ratingKey: string;
  title: string;
  year: number | null;
  thumbUrl: string | null;
  kept: boolean;
  skipped: boolean;
}

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Debounced typeahead.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((d) => {
          setSuggestions(d.suggestions ?? []);
          setOpen(true);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function go(term: string) {
    const t = term.trim();
    if (!t) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(t)}`);
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go(q);
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search…"
        className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:border-brand"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-700 bg-panel shadow-xl">
          {/* Suggestions scroll; the "See all" row stays pinned below them. */}
          <div className="max-h-80 overflow-auto">
            {suggestions.map((s) => (
              <button
                key={s.ratingKey}
                onClick={() => go(s.title)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-800"
              >
                <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-slate-800">
                  {s.thumbUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.thumbUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{s.title}</span>
                  <span className="text-xs text-slate-500">
                    {s.year ?? ''}
                    {s.kept ? ' · kept' : s.skipped ? ' · don’t care' : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => go(q)}
            className="block w-full border-t border-slate-800 bg-panel px-3 py-2 text-left text-xs text-brand hover:bg-slate-800"
          >
            See all results for “{q.trim()}” →
          </button>
        </div>
      )}
    </div>
  );
}
