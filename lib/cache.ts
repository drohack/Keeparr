import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';

/**
 * On-disk cache for transcoded Plex posters. Lets the image proxy serve repeat
 * requests without hitting Plex, and gives admins a "clear" control so cover art
 * re-fetches. Node-only. Best-effort: any FS error degrades to a cache miss.
 */
const IMAGE_DIR = path.join(DATA_DIR, 'cache', 'images');

function keyFile(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex');
  return path.join(IMAGE_DIR, `${hash}`);
}

/** Read a cached image (bytes + content-type) or null on miss. */
export function readImageCache(
  key: string
): { body: Buffer; contentType: string } | null {
  try {
    const file = keyFile(key);
    const body = fs.readFileSync(file);
    let contentType = 'image/jpeg';
    try {
      contentType = fs.readFileSync(`${file}.type`, 'utf8') || contentType;
    } catch {
      /* default */
    }
    return { body, contentType };
  } catch {
    return null;
  }
}

/** Write an image to the cache (best-effort). */
export function writeImageCache(key: string, body: Buffer, contentType: string): void {
  try {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    const file = keyFile(key);
    fs.writeFileSync(file, body);
    fs.writeFileSync(`${file}.type`, contentType);
  } catch {
    /* ignore — caching is optional */
  }
}

/** Delete every cached image. Returns the number of files removed. */
export function clearImageCache(): number {
  try {
    const files = fs.readdirSync(IMAGE_DIR);
    for (const f of files) fs.rmSync(path.join(IMAGE_DIR, f), { force: true });
    return files.filter((f) => !f.endsWith('.type')).length;
  } catch {
    return 0;
  }
}

/** Count + total bytes of the cached images. */
export function imageCacheStats(): { count: number; bytes: number } {
  try {
    const files = fs.readdirSync(IMAGE_DIR);
    let bytes = 0;
    let count = 0;
    for (const f of files) {
      if (f.endsWith('.type')) continue;
      count++;
      bytes += fs.statSync(path.join(IMAGE_DIR, f)).size;
    }
    return { count, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
