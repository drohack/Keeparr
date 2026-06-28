import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { __setTestDbToMemory, __closeDb } from './db';
import {
  addKeep,
  addSkips,
  addSkip,
  removeSkip,
  isSkipped,
  countFeedRemaining,
  getFeed,
  isKept,
  isKeptByUser,
  largestItems,
  librarySummary,
  listUsers,
  queryLibrary,
  reclaimableItems,
  reclaimableTotalBytes,
  libraryStats,
  removeKeep,
  setUserAdmin,
  upsertMediaBatch,
  upsertUser,
  getUser,
  tombstoneStale,
  getJobState,
  setJobState,
  isJobRunning,
  getAllJobState,
  setUserEnabled,
  recordJobRun,
  recentJobRuns,
  logEvent,
  recentLogs,
  clearLogs,
  replaceSeerrRequests,
  clearSeerrRequests,
  seerrRequestKeys,
  upsertWatchBatch,
  clearWatchHistory,
  existingShowSizes,
  showRatingKeys,
  updateItemSize,
  type UpsertMediaInput,
} from './queries';

const GB = 1024 ** 3;

function media(
  ratingKey: string,
  overrides: Partial<UpsertMediaInput> = {}
): UpsertMediaInput {
  return {
    ratingKey,
    sectionId: '1',
    libraryKind: 'movie',
    title: `Title ${ratingKey}`,
    year: 2020,
    thumb: `/library/metadata/${ratingKey}/thumb`,
    sizeBytes: 1 * GB,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
    ...overrides,
  };
}

beforeEach(() => {
  __setTestDbToMemory();
});

afterAll(() => {
  __closeDb();
});

function user(plexUserId: string, isAdmin = false) {
  upsertUser({
    plexUserId,
    username: `user${plexUserId}`,
    email: `${plexUserId}@example.com`,
    thumb: null,
    isAdmin,
  });
}

describe('users: listUsers + setUserAdmin', () => {
  it('lists all users, admins first', () => {
    user('regular');
    user('owner', true);
    const rows = listUsers();
    expect(rows.map((r) => r.plexUserId)).toEqual(['owner', 'regular']);
    expect(rows[0].isAdmin).toBe(true);
    expect(rows[1].isAdmin).toBe(false);
  });

  it('setUserAdmin promotes a regular user', () => {
    user('regular');
    expect(getUser('regular')?.isAdmin).toBe(false);
    setUserAdmin('regular', true);
    expect(getUser('regular')?.isAdmin).toBe(true);
  });

  it('setUserAdmin demotes an admin (bypasses the one-way upsert MAX)', () => {
    user('admin', true);
    // upsertUser can never lower is_admin...
    upsertUser({
      plexUserId: 'admin',
      username: 'admin',
      email: null,
      thumb: null,
      isAdmin: false,
    });
    expect(getUser('admin')?.isAdmin).toBe(true);
    // ...but setUserAdmin can.
    setUserAdmin('admin', false);
    expect(getUser('admin')?.isAdmin).toBe(false);
  });
});

describe('users: enabled flag', () => {
  function mkUser(id: string, enabled?: boolean) {
    upsertUser({
      plexUserId: id,
      username: id,
      email: null,
      thumb: null,
      isAdmin: false,
      enabled,
    });
  }

  it('defaults to enabled and round-trips via setUserEnabled', () => {
    mkUser('u');
    expect(getUser('u')?.enabled).toBe(true);
    setUserEnabled('u', false);
    expect(getUser('u')?.enabled).toBe(false);
  });

  it('preserves enabled across a re-upsert (e.g. next login)', () => {
    mkUser('u');
    setUserEnabled('u', false);
    mkUser('u'); // simulates a subsequent login upsert
    expect(getUser('u')?.enabled).toBe(false);
  });

  it('can be imported as disabled', () => {
    mkUser('imported', false);
    expect(getUser('imported')?.enabled).toBe(false);
  });
});

describe('job_runs activity log', () => {
  function run(jobId: string, startedAt: number, status = 'ok') {
    recordJobRun({
      jobId,
      startedAt,
      endedAt: startedAt + 1,
      status,
      message: `${jobId} ${status}`,
      durationMs: 1000,
      result: 1,
    });
  }

  it('returns most-recent first', () => {
    run('library', 100);
    run('sizes', 300);
    run('watch', 200);
    const rows = recentJobRuns(10);
    expect(rows.map((r) => r.jobId)).toEqual(['sizes', 'watch', 'library']);
  });

  it('prunes to the most recent 100', () => {
    for (let i = 0; i < 110; i++) run('library', i);
    const rows = recentJobRuns(1000);
    expect(rows.length).toBe(100);
    expect(rows[0].startedAt).toBe(109); // newest kept
  });
});

describe('logs', () => {
  it('appends, filters by level, and clears', () => {
    logEvent('info', 'job:library', 'ok');
    logEvent('error', 'job:sizes', 'boom');
    expect(recentLogs().length).toBe(2);
    const errs = recentLogs({ level: 'error' });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toBe('boom');
    clearLogs();
    expect(recentLogs()).toHaveLength(0);
  });
});

describe('cache clears', () => {
  it('clears seerr requests + watch history', () => {
    replaceSeerrRequests('userA', ['1', '2']);
    upsertWatchBatch([
      { plexUserId: 'userA', ratingKey: '1', plays: 1, lastWatched: 1 },
    ]);
    expect(seerrRequestKeys('userA')).toHaveLength(2);
    expect(clearSeerrRequests()).toBe(2);
    expect(seerrRequestKeys('userA')).toHaveLength(0);
    expect(clearWatchHistory()).toBe(1);
  });
});

describe('job state', () => {
  it('defaults to never for an unknown job', () => {
    const s = getJobState('library');
    expect(s.lastStatus).toBe('never');
    expect(s.lastRun).toBeNull();
  });

  it('upserts and merges partial updates', () => {
    setJobState('library', { lastStatus: 'running', lastMessage: 'go' });
    expect(isJobRunning('library')).toBe(true);
    setJobState('library', { lastStatus: 'ok', lastRun: 123, lastResult: 7 });
    const s = getJobState('library');
    expect(s.lastStatus).toBe('ok');
    expect(s.lastRun).toBe(123);
    expect(s.lastResult).toBe(7);
    expect(s.lastMessage).toBe('go'); // preserved across the partial update
    expect(isJobRunning('library')).toBe(false);
  });

  it('lists all job rows', () => {
    setJobState('library', { lastStatus: 'ok' });
    setJobState('requests', { lastStatus: 'error' });
    expect(getAllJobState().map((j) => j.jobId).sort()).toEqual([
      'library',
      'requests',
    ]);
  });
});

describe('seerr request cache', () => {
  it('replaces a user\'s keys atomically and is per-user', () => {
    replaceSeerrRequests('userA', ['1', '2', '3']);
    replaceSeerrRequests('userB', ['9']);
    expect(seerrRequestKeys('userA').sort()).toEqual(['1', '2', '3']);
    expect(seerrRequestKeys('userB')).toEqual(['9']);
    // Replace fully swaps the set.
    replaceSeerrRequests('userA', ['4']);
    expect(seerrRequestKeys('userA')).toEqual(['4']);
    expect(seerrRequestKeys('userB')).toEqual(['9']); // untouched
  });
});

describe('size-split helpers', () => {
  beforeEach(() =>
    upsertMediaBatch([
      media('mv', { libraryKind: 'movie', sizeBytes: 1 * GB }),
      media('sh1', { libraryKind: 'show', sizeBytes: 2 * GB }),
      media('sh2', { libraryKind: 'show', sizeBytes: 3 * GB }),
    ])
  );

  it('existingShowSizes returns only shows with their current sizes', () => {
    const m = existingShowSizes();
    expect(m.get('sh1')).toBe(2 * GB);
    expect(m.get('sh2')).toBe(3 * GB);
    expect(m.has('mv')).toBe(false);
  });

  it('showRatingKeys + updateItemSize recompute sizes', () => {
    expect(showRatingKeys().sort()).toEqual(['sh1', 'sh2']);
    updateItemSize('sh1', 10 * GB);
    expect(existingShowSizes().get('sh1')).toBe(10 * GB);
  });
});

describe('feed by library + weighting', () => {
  beforeEach(() => {
    upsertMediaBatch([
      media('mov1', { libraryKind: 'movie', sectionId: '1' }),
      media('show1', { libraryKind: 'show', sectionId: '2' }),
      media('show2', { libraryKind: 'show', sectionId: '2' }),
      media('show3', { libraryKind: 'show', sectionId: '3' }),
    ]);
  });

  it('limits the feed to a single Plex library', () => {
    const keys = getFeed('userA', 10, { sectionId: '2' })
      .map((r) => r.rating_key)
      .sort();
    expect(keys).toEqual(['show1', 'show2']);
  });

  it('the mixed feed always includes a movie via the reserve quota', () => {
    // The single movie must always appear given the reserved movie slots.
    for (let i = 0; i < 8; i++) {
      const keys = getFeed('userA', 4).map((r) => r.rating_key);
      expect(keys).toContain('mov1');
    }
  });

  it('countFeedRemaining respects the section filter', () => {
    expect(countFeedRemaining('userA', { sectionId: '1' })).toBe(1);
    expect(countFeedRemaining('userA', { sectionId: '2' })).toBe(2);
    expect(countFeedRemaining('userA')).toBe(4);
  });
});

describe('per-item skips (don\'t care)', () => {
  beforeEach(() => upsertMediaBatch([media('1'), media('2')]));

  it('addSkip is idempotent per user', () => {
    expect(addSkip('userA', '1')).toBe(true);
    expect(addSkip('userA', '1')).toBe(false); // already there
    expect(isSkipped('userA', '1')).toBe(true);
  });

  it('removeSkip clears only when present', () => {
    expect(removeSkip('userA', '1')).toBe(false); // nothing to remove
    addSkip('userA', '1');
    expect(removeSkip('userA', '1')).toBe(true);
    expect(isSkipped('userA', '1')).toBe(false);
  });

  it('is scoped per user', () => {
    addSkip('userA', '1');
    expect(isSkipped('userA', '1')).toBe(true);
    expect(isSkipped('userB', '1')).toBe(false);
  });

  it('excludes the item from that user\'s feed only', () => {
    addSkip('userA', '1');
    const a = getFeed('userA', 10).map((r) => r.rating_key);
    const b = getFeed('userB', 10).map((r) => r.rating_key);
    expect(a).not.toContain('1');
    expect(b).toContain('1');
  });
});

describe('media upsert + tombstone', () => {
  it('inserts then updates on conflict', () => {
    upsertMediaBatch([media('1', { sizeBytes: 1 * GB })]);
    upsertMediaBatch([media('1', { sizeBytes: 5 * GB, title: 'Renamed' })]);
    const stats = libraryStats();
    expect(stats.totalItems).toBe(1);
    expect(stats.totalBytes).toBe(5 * GB);
  });

  it('tombstones items not seen in the latest sync', () => {
    // First sync at t=1000 touches both items.
    upsertMediaBatch([media('1'), media('2')], 1000);
    // Second sync at t=2000 only re-touches item 1.
    upsertMediaBatch([media('1')], 2000);
    const removed = tombstoneStale(2000); // anything older than this sync
    expect(removed).toBe(1); // item 2 tombstoned
    expect(libraryStats().totalItems).toBe(1);
  });
});

describe('keeps are per-user (protected if anyone keeps)', () => {
  it('a user keeps once; their second keep is a no-op', () => {
    upsertMediaBatch([media('1')]);
    expect(addKeep('userA', '1')).toBe(true);
    expect(addKeep('userA', '1')).toBe(false);
    expect(isKept('1')).toBe(true);
    expect(isKeptByUser('userA', '1')).toBe(true);
  });

  it('two users keep the same item independently', () => {
    upsertMediaBatch([media('1')]);
    expect(addKeep('userA', '1')).toBe(true);
    expect(addKeep('userB', '1')).toBe(true);
    expect(isKeptByUser('userA', '1')).toBe(true);
    expect(isKeptByUser('userB', '1')).toBe(true);
  });

  it("removeKeep only removes the caller's keep; item stays protected", () => {
    upsertMediaBatch([media('1')]);
    addKeep('userA', '1');
    addKeep('userB', '1');
    expect(removeKeep('userA', '1')).toBe(true);
    expect(isKeptByUser('userA', '1')).toBe(false);
    expect(isKeptByUser('userB', '1')).toBe(true);
    expect(isKept('1')).toBe(true); // still kept by B
    expect(removeKeep('userB', '1')).toBe(true);
    expect(isKept('1')).toBe(false); // now kept by nobody
  });
});

describe('feed excludes kept + per-user skipped', () => {
  beforeEach(() => {
    upsertMediaBatch([media('1'), media('2'), media('3'), media('4')]);
  });

  it('excludes globally-kept items for everyone', () => {
    addKeep('userA', '1');
    const feedB = getFeed('userB', 10).map((m) => m.rating_key);
    expect(feedB).not.toContain('1');
    expect(feedB.sort()).toEqual(['2', '3', '4']);
  });

  it('skips are per-user only', () => {
    addSkips('userA', ['2', '3']);
    const feedA = getFeed('userA', 10).map((m) => m.rating_key).sort();
    const feedB = getFeed('userB', 10).map((m) => m.rating_key).sort();
    expect(feedA).toEqual(['1', '4']); // A skipped 2 & 3
    expect(feedB).toEqual(['1', '2', '3', '4']); // B unaffected
  });

  it('countFeedRemaining reflects keeps + skips', () => {
    addKeep('userA', '1');
    addSkips('userA', ['2']);
    expect(countFeedRemaining('userA')).toBe(2); // 3 & 4 remain
    expect(countFeedRemaining('userB')).toBe(3); // only keep removes 1
  });

  it('respects the limit', () => {
    expect(getFeed('userA', 2)).toHaveLength(2);
  });
});

describe('reclaimable + library views', () => {
  beforeEach(() => {
    upsertMediaBatch([
      media('1', { sizeBytes: 10 * GB }),
      media('2', { sizeBytes: 5 * GB }),
      media('3', { sizeBytes: 1 * GB }),
    ]);
  });

  it('reclaimable excludes kept and sorts by size desc', () => {
    addKeep('userA', '1'); // largest is kept
    const items = reclaimableItems(10, 0).map((m) => m.rating_key);
    expect(items).toEqual(['2', '3']);
    expect(reclaimableTotalBytes()).toBe(6 * GB);
  });

  it('largestItems includes kept flags and full ordering', () => {
    addKeep('userA', '2');
    addKeep('userB', '3');
    const items = largestItems(10, 0, 'userA');
    expect(items.map((m) => m.rating_key)).toEqual(['1', '2', '3']);
    expect(items.find((m) => m.rating_key === '2')?.kept).toBe(1);
    expect(items.find((m) => m.rating_key === '2')?.kept_by_me).toBe(1);
    // kept by another user → protected but not mine
    expect(items.find((m) => m.rating_key === '3')?.kept).toBe(1);
    expect(items.find((m) => m.rating_key === '3')?.kept_by_me).toBe(0);
    expect(items.find((m) => m.rating_key === '1')?.kept).toBe(0);
  });

  it('queryLibrary search + hideKept', () => {
    addKeep('userA', '1');
    const kept = queryLibrary({ plexUserId: 'userA', limit: 10, offset: 0 });
    expect(kept).toHaveLength(3);
    expect(kept.find((m) => m.rating_key === '1')?.kept_by_me).toBe(1);
    const hidden = queryLibrary({
      plexUserId: 'userA',
      limit: 10,
      offset: 0,
      hideKept: true,
    });
    expect(hidden.map((m) => m.rating_key)).toEqual(['2', '3']);
    const searched = queryLibrary({
      plexUserId: 'userA',
      limit: 10,
      offset: 0,
      search: 'Title 2',
    });
    expect(searched.map((m) => m.rating_key)).toEqual(['2']);
  });

  it('queryLibrary filters by skip + year sort + requestedKeys', () => {
    addSkip('userA', '2');
    // skip filters are per-user
    const skipped = queryLibrary({
      plexUserId: 'userA',
      limit: 10,
      offset: 0,
      skipFilter: 'skipped',
    });
    expect(skipped.map((m) => m.rating_key)).toEqual(['2']);
    expect(skipped[0].skipped).toBe(1);
    const otherUser = queryLibrary({
      plexUserId: 'userB',
      limit: 10,
      offset: 0,
      skipFilter: 'skipped',
    });
    expect(otherUser).toHaveLength(0);

    // year sort, ascending
    const byYearAsc = queryLibrary({
      plexUserId: 'userA',
      limit: 10,
      offset: 0,
      sort: 'year',
      dir: 'asc',
    });
    const years = byYearAsc.map((m) => m.year);
    expect(years).toEqual([...years].sort((a, b) => (a ?? 0) - (b ?? 0)));

    // requestedKeys restricts; empty = nothing
    const restricted = queryLibrary({
      plexUserId: 'userA',
      limit: 10,
      offset: 0,
      requestedKeys: ['3'],
    });
    expect(restricted.map((m) => m.rating_key)).toEqual(['3']);
    const none = queryLibrary({
      plexUserId: 'userA',
      limit: 10,
      offset: 0,
      requestedKeys: [],
    });
    expect(none).toHaveLength(0);
  });

  it('libraryStats totals (a multi-keeper item counts once)', () => {
    addKeep('userA', '1');
    addKeep('userB', '1'); // same item, second keeper — must not double-count
    const s = libraryStats();
    expect(s.totalItems).toBe(3);
    expect(s.totalBytes).toBe(16 * GB);
    expect(s.keptItems).toBe(1);
    expect(s.keptBytes).toBe(10 * GB);
    expect(s.reclaimableBytes).toBe(6 * GB);
  });

  it('librarySummary partitions bytes into kept / dontcare / undecided per user', () => {
    // items 1 (10GB), 2 (5GB), 3 (1GB), all in section '1'.
    addKeep('userB', '1'); // protected by someone else (not me)
    addKeep('userA', '2'); // protected by me
    addSkip('userA', '3'); // I don't care about the smallest

    const [row] = librarySummary('userA');
    expect(row.section_id).toBe('1');
    expect(row.items).toBe(3);
    expect(row.bytes).toBe(16 * GB);

    // kept = protected by anyone (items 1 and 2)
    expect(row.kept_items).toBe(2);
    expect(row.kept_bytes).toBe(15 * GB);
    // of which only item 2 is my own keep
    expect(row.kept_by_me_items).toBe(1);
    expect(row.kept_by_me_bytes).toBe(5 * GB);
    // don't care = not protected AND skipped by me (item 3)
    expect(row.dontcare_items).toBe(1);
    expect(row.dontcare_bytes).toBe(1 * GB);
    // undecided = not protected AND not skipped (none left here)
    expect(row.undecided_items).toBe(0);
    expect(row.undecided_bytes).toBe(0);

    // buckets partition the total exactly
    expect(row.kept_bytes + row.dontcare_bytes + row.undecided_bytes).toBe(
      row.bytes
    );
  });
});
