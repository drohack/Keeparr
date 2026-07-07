/**
 * Tiny in-memory sliding-window rate limiter. Enough for a single-process
 * self-hosted app (Keeparr runs one Node process); it is NOT shared across
 * replicas. Used to throttle credential login attempts (brute-force defense).
 */

interface Window {
  hits: number[]; // timestamps (ms) within the window
}

const buckets = new Map<string, Window>();

/**
 * Record an attempt for `key` and report whether it's now over `limit` within
 * the trailing `windowMs`. Call once per attempt; returns `{limited, retryAfterMs}`.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): { limited: boolean; retryAfterMs: number } {
  const cutoff = now - windowMs;
  const w = buckets.get(key) ?? { hits: [] };
  // Drop timestamps outside the window.
  w.hits = w.hits.filter((t) => t > cutoff);
  w.hits.push(now);
  buckets.set(key, w);

  // Opportunistic cleanup so the map can't grow unbounded from unique keys.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }

  if (w.hits.length > limit) {
    const oldest = w.hits[0];
    return { limited: true, retryAfterMs: Math.max(0, oldest + windowMs - now) };
  }
  return { limited: false, retryAfterMs: 0 };
}

/** Test helper: clear all windows. */
export function __resetRateLimits(): void {
  buckets.clear();
}
