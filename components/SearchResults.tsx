'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaCardData } from '@/lib/types';
import MediaCard, { CARD_GRID_CLASS } from './MediaCard';
import { useToast } from './Toaster';

export default function SearchResults({ query }: { query: string }) {
  const [items, setItems] = useState<MediaCardData[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const toast = useToast();
  // Guards against out-of-order responses: only the latest request may commit
  // state (a slow old response must not clobber a newer one).
  const fetchSeq = useRef(0);

  // Load Seerr requested keys once (for the "Requested" badge).
  useEffect(() => {
    fetch('/api/requests')
      .then((r) => r.json())
      .then((d) => setRequested(new Set<string>(d.ratingKeys ?? [])))
      .catch(() => {});
  }, []);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      const seq = ++fetchSeq.current; // also invalidates in-flight fetches on clear
      if (!query.trim()) {
        setItems([]);
        setHasMore(false);
        return;
      }
      setLoading(true);
      const off = reset ? 0 : offset;
      const params = new URLSearchParams({ q: query, offset: String(off) });
      try {
        const data = await fetch(`/api/search?${params}`).then((r) => r.json());
        if (seq !== fetchSeq.current) return; // superseded - drop it
        // An error response (e.g. a 500) has no `items` - guard so the view
        // doesn't crash on a spread/map of undefined.
        const list = Array.isArray(data.items) ? data.items : [];
        setHasMore(!!data.hasMore);
        if (typeof data.nextOffset === 'number') setOffset(data.nextOffset);
        setItems((prev) => (reset ? list : [...prev, ...list]));
      } catch {
        if (seq !== fetchSeq.current) return; // superseded - don't toast for it
        toast("Couldn't load search results - is the server reachable?", 'error');
      } finally {
        if (seq === fetchSeq.current) setLoading(false);
      }
    },
    [query, offset, toast]
  );

  // Reset + reload when the query changes.
  useEffect(() => {
    setOffset(0);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Infinite scroll: load more as a sentinel nears the viewport.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading) fetchPage(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, fetchPage]);

  if (!query.trim()) {
    return <p className="text-slate-400 py-12 text-center">Type something to search.</p>;
  }

  return (
    <div>
      {items.length === 0 && !loading ? (
        <p className="text-slate-400 py-12 text-center">
          No matches for “{query}”.
        </p>
      ) : (
        <div className={CARD_GRID_CLASS}>
          {items.map((item) => (
            <MediaCard
              key={item.ratingKey}
              item={item}
              skippable
              requested={requested.has(item.ratingKey)}
            />
          ))}
        </div>
      )}

      <div ref={sentinel} className="h-8" />
      {loading && <p className="text-center text-slate-500 text-sm">Loading…</p>}
    </div>
  );
}
