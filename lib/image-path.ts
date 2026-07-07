import type { MediaServerType } from './settings';

/**
 * Validate a poster `path` before it's handed to the upstream media server.
 * This matters most for Plex, whose /photo/:/transcode endpoint fetches an
 * arbitrary `url` server-side with the privileged token — so a crafted `path`
 * could otherwise turn the media server into an SSRF pivot. Plex thumbs are
 * always relative paths under /library/; Jellyfin/Emby `path` is an opaque
 * item id (no slashes/dots/colons/query).
 */
export function isSafeImagePath(type: MediaServerType, path: string): boolean {
  if (path.includes('://') || path.includes('..') || path.startsWith('//')) {
    return false;
  }
  if (type === 'plex') {
    return /^\/library\/[A-Za-z0-9/_.\-]+$/.test(path);
  }
  // Jellyfin/Emby item id: hex guid, optionally dashed.
  return /^[A-Za-z0-9-]+$/.test(path);
}
