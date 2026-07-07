import { beforeEach, describe, expect, it } from 'vitest';
import { rateLimit, __resetRateLimits } from './rate-limit';

beforeEach(() => __resetRateLimits());

describe('rateLimit', () => {
  it('allows up to the limit, then blocks', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 1000, t).limited).toBe(false);
    }
    const r = rateLimit('k', 3, 1000, t); // 4th within the window
    expect(r.limited).toBe(true);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('is per-key', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit('a', 3, 1000, t);
    expect(rateLimit('a', 3, 1000, t).limited).toBe(true);
    expect(rateLimit('b', 3, 1000, t).limited).toBe(false); // different key unaffected
  });

  it('forgets attempts once they age out of the window', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit('k', 3, 1000, t);
    expect(rateLimit('k', 3, 1000, t).limited).toBe(true);
    // Well past the window — old hits dropped, counter effectively resets.
    expect(rateLimit('k', 3, 1000, t + 2000).limited).toBe(false);
  });
});
