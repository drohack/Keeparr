import type { LibraryKind } from '../types';

/**
 * The read seam every media-server backend implements for the sync engine. Auth
 * lives in the per-backend clients (lib/plex.ts, lib/jellyfin.ts) called from the
 * login routes; this interface is just the library/item/size reads that
 * `lib/sync.ts` orchestrates identically for Plex / Jellyfin / Emby.
 */
export interface BackendSection {
  id: string;
  title: string;
  kind: LibraryKind;
  /** On-disk folders the server reports (Plex only; [] for Jellyfin/Emby). */
  paths: string[];
}

/** A media row ready to map into `UpsertMediaInput`. Movies carry their size;
 *  shows come back with `sizeBytes: 0` and are sized via `showSize()`. */
export interface BackendItem {
  ratingKey: string;
  title: string;
  year: number | null;
  /** Backend image reference for the poster proxy (Plex relative path; Jellyfin item id). */
  thumb: string | null;
  addedAt: number | null;
  guidTmdb: string | null;
  guidTvdb: string | null;
  guidImdb: string | null;
  sizeBytes: number;
  /** The item's on-disk folder name (server-side basename) — feeds the disk
   *  scan's known-name set. Null when the backend didn't report a path. */
  dirName: string | null;
  /** Movie file basename (covers loose files in the library root); null for shows. */
  fileName: string | null;
  /** FULL server-side path of the item's folder (as the media server sees it) —
   *  shown on the Problems page so problems can be located on disk. */
  dirPath: string | null;
}

/** One watch-history row (movies by item id; episodes rolled up to their series). */
export interface WatchRow {
  plexUserId: string;
  ratingKey: string;
  plays: number;
  lastWatched: number | null;
}

export interface MediaBackend {
  /** All movie/show libraries on the server. */
  listSections(): Promise<BackendSection[]>;
  /** All items in a section. Movies include size; shows need `showSize()`. */
  listSectionItems(sectionId: string, kind: LibraryKind): Promise<BackendItem[]>;
  /** Newest items in a section (cheap incremental scan). */
  recentItems(sectionId: string, kind: LibraryKind, limit: number): Promise<BackendItem[]>;
  /** Total on-disk size for one series (episode sum, counting each file once). */
  showSize(ratingKey: string): Promise<number>;
  /**
   * Native watch history, or `null` if the backend has none of its own (Plex —
   * watch comes from Tautulli instead). Jellyfin/Emby return their own UserData.
   */
  getWatchData(): Promise<WatchRow[] | null>;
}
