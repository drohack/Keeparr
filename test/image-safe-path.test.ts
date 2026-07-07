import { describe, expect, it } from 'vitest';
import { isSafeImagePath } from '@/lib/image-path';

describe('image proxy isSafeImagePath (SSRF guard)', () => {
  describe('plex', () => {
    const ok = (p: string) => expect(isSafeImagePath('plex', p)).toBe(true);
    const bad = (p: string) => expect(isSafeImagePath('plex', p)).toBe(false);

    it('accepts real Plex thumb/art paths', () => {
      ok('/library/metadata/12345/thumb/1700000000');
      ok('/library/metadata/12345/art/1700000000');
      ok('/library/parts/999/file.jpg');
    });

    it('rejects SSRF / traversal attempts', () => {
      bad('http://169.254.169.254/latest/meta-data'); // absolute URL
      bad('/library/../../etc/passwd'); // traversal
      bad('//evil.com/x'); // protocol-relative
      bad('/library/metadata/1/thumb?url=http://evil'); // embedded URL (? and : excluded)
      bad('https://plex.tv/foo'); // has ://
      bad('/photo/:/transcode?url=http://evil'); // not under /library/
      bad('/status/sessions'); // other Plex endpoint
    });
  });

  describe('jellyfin/emby', () => {
    it('accepts opaque item ids only', () => {
      expect(isSafeImagePath('jellyfin', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')).toBe(true);
      expect(isSafeImagePath('emby', 'abc-123-def')).toBe(true);
    });

    it('rejects anything with a path/scheme', () => {
      expect(isSafeImagePath('jellyfin', '../secret')).toBe(false);
      expect(isSafeImagePath('jellyfin', 'http://evil/x')).toBe(false);
      expect(isSafeImagePath('jellyfin', 'a/b')).toBe(false);
      expect(isSafeImagePath('jellyfin', '')).toBe(false);
    });
  });
});
