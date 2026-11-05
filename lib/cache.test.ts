import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Redirect the poster cache into a temp dir (paths only - the files are real).
// IMAGE_DIR is captured at module load, so ./config must be mocked BEFORE
// ./cache is imported (same pattern as backup.test.ts).
const { TMP } = vi.hoisted(() => ({
  TMP: `${process.env.TMP ?? process.env.TEMP ?? '/tmp'}/keeparr-cache-test-${process.pid}`,
}));
vi.mock('./config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./config')>();
  return { ...orig, DATA_DIR: TMP };
});

import {
  clearImageCache,
  imageCacheStats,
  readImageCache,
  writeImageCache,
} from './cache';

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('poster disk cache', () => {
  it('write/read round-trip preserves body and content type', () => {
    writeImageCache('/library/metadata/1/thumb?w=300', Buffer.from('png-bytes'), 'image/png');
    const hit = readImageCache('/library/metadata/1/thumb?w=300');
    expect(hit).not.toBeNull();
    expect(hit!.body.toString()).toBe('png-bytes');
    expect(hit!.contentType).toBe('image/png');
  });

  it('misses return null (no throw on an absent dir)', () => {
    expect(readImageCache('never-written')).toBeNull();
  });

  it('defaults to image/jpeg when the type sidecar is missing', () => {
    writeImageCache('key-a', Buffer.from('x'), 'image/webp');
    // Simulate an older cache entry without a sidecar.
    const files = fs.readdirSync(`${TMP}/cache/images`);
    const sidecar = files.find((f) => f.endsWith('.type'))!;
    fs.rmSync(`${TMP}/cache/images/${sidecar}`);
    expect(readImageCache('key-a')?.contentType).toBe('image/jpeg');
  });

  it('clearImageCache removes everything, counting only image files', () => {
    writeImageCache('key-a', Buffer.from('aa'), 'image/png');
    writeImageCache('key-b', Buffer.from('bbb'), 'image/png');
    expect(clearImageCache()).toBe(2); // .type sidecars not counted
    expect(readImageCache('key-a')).toBeNull();
    expect(imageCacheStats()).toEqual({ count: 0, bytes: 0 });
  });

  it('imageCacheStats sums image files, excluding sidecars', () => {
    writeImageCache('key-a', Buffer.from('aa'), 'image/png');
    writeImageCache('key-b', Buffer.from('bbb'), 'image/png');
    expect(imageCacheStats()).toEqual({ count: 2, bytes: 5 });
  });
});
