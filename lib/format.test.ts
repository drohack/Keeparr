import { describe, expect, it } from 'vitest';
import { formatGB, formatRelative, formatSize } from './format';

const GB = 1024 ** 3;
const TB = 1024 ** 4;

describe('formatGB / formatSize', () => {
  it('formats GB with two decimals', () => {
    expect(formatGB(1.5 * GB)).toBe('1.50 GB');
  });

  it('formatSize switches to TB at 1 TB', () => {
    expect(formatSize(0.99 * TB)).toMatch(/GB$/);
    expect(formatSize(2.5 * TB)).toBe('2.50 TB');
  });
});

describe('formatRelative', () => {
  // Fixed clock: 2026-07-06 12:00:00 UTC (in ms).
  const NOW = Date.UTC(2026, 6, 6, 12, 0, 0);
  const at = (secondsAgo: number) => Math.floor(NOW / 1000) - secondsAgo;

  it('under a minute -> "just now"', () => {
    expect(formatRelative(at(0), NOW)).toBe('just now');
    expect(formatRelative(at(59), NOW)).toBe('just now');
  });

  it('minutes and hours', () => {
    expect(formatRelative(at(60), NOW)).toBe('1m ago');
    expect(formatRelative(at(59 * 60), NOW)).toBe('59m ago');
    expect(formatRelative(at(3600), NOW)).toBe('1h ago');
    expect(formatRelative(at(23 * 3600), NOW)).toBe('23h ago');
  });

  it('yesterday, then days', () => {
    expect(formatRelative(at(30 * 3600), NOW)).toBe('yesterday');
    expect(formatRelative(at(3 * 24 * 3600), NOW)).toBe('3d ago');
    expect(formatRelative(at(29 * 24 * 3600), NOW)).toBe('29d ago');
  });

  it('past ~30 days -> locale date (contains the year)', () => {
    expect(formatRelative(at(45 * 24 * 3600), NOW)).toContain('2026');
  });

  it('future timestamps fall back to the absolute form (no negative ages)', () => {
    const future = formatRelative(at(-3600), NOW);
    expect(future).not.toContain('ago');
    expect(future).toContain('2026');
  });
});
