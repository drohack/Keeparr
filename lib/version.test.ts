import { beforeEach, describe, expect, it } from 'vitest';
import { compareSemver, getVersionInfo, __clearVersionCache } from './version';
import pkg from '../package.json';

describe('compareSemver', () => {
  it('orders plain versions', () => {
    expect(compareSemver('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('compares numerically, not lexically (0.10 > 0.9)', () => {
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0);
  });

  it('handles unequal segment counts (1.2 == 1.2.0)', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.2.1', '1.2')).toBeGreaterThan(0);
  });

  it('degrades non-numeric segments to 0 (no false updates)', () => {
    expect(compareSemver('abc', pkg.version)).toBeLessThanOrEqual(0);
  });
});

describe('getVersionInfo', () => {
  beforeEach(() => __clearVersionCache());

  it('flags an update when the latest release is newer', async () => {
    const v = await getVersionInfo(async () => ({
      tag_name: 'v99.0.0',
      html_url: 'https://github.com/drohack/Keeparr/releases/tag/v99.0.0',
    }));
    expect(v.current).toBe(pkg.version);
    expect(v.latest).toBe('99.0.0');
    expect(v.updateAvailable).toBe(true);
    expect(v.releaseUrl).toContain('/releases/tag/');
  });

  it('no update when latest equals current', async () => {
    const v = await getVersionInfo(async () => ({ tag_name: `v${pkg.version}` }));
    expect(v.updateAvailable).toBe(false);
    expect(v.latest).toBe(pkg.version);
  });

  it('never throws: fetch failure (e.g. no releases yet) -> latest unknown', async () => {
    const v = await getVersionInfo(async () => {
      throw new Error('GitHub releases -> HTTP 404');
    });
    expect(v.current).toBe(pkg.version);
    expect(v.latest).toBeNull();
    expect(v.updateAvailable).toBe(false);
  });

  it('caches: a later failing fetch serves the last good answer', async () => {
    await getVersionInfo(async () => ({ tag_name: 'v99.0.0' }));
    // Cache is warm - the failing fetcher must not even be consulted.
    const v = await getVersionInfo(async () => {
      throw new Error('down');
    });
    expect(v.latest).toBe('99.0.0');
    expect(v.updateAvailable).toBe(true);
  });
});
