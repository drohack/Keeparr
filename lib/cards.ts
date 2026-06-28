import type { MediaCardData, MediaItem } from './types';

/** Build the browser-facing poster URL (proxied; never exposes the Plex token). */
export function thumbUrl(thumb: string | null): string | null {
  if (!thumb) return null;
  return `/api/image?path=${encodeURIComponent(thumb)}&w=300&h=450`;
}

/** Map a stored media row (+ kept flags) into the UI card shape. */
export function toCard(
  item: MediaItem,
  kept: boolean,
  keptByMe?: boolean,
  skipped?: boolean
): MediaCardData {
  return {
    ratingKey: item.rating_key,
    sectionId: item.section_id,
    libraryKind: item.library_kind,
    title: item.title,
    year: item.year,
    thumbUrl: thumbUrl(item.thumb),
    sizeBytes: item.size_bytes,
    kept,
    keptByMe: !!keptByMe,
    skipped: !!skipped,
  };
}
