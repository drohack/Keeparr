import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Mock ONLY the cookie jar (next/headers). The database stays real (in-memory).
const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

import { __setTestDbToMemory, __closeDb } from '@/lib/db';
import {
  addDelete,
  isKept,
  isKeptByUser,
  isMarkedForDelete,
  isSkipped,
  replaceSeerrRequests,
  tombstoneStale,
  upsertMediaBatch,
  upsertUser,
  type UpsertMediaInput,
} from '@/lib/queries';
import { errorResponse } from '@/lib/route-helpers';
import { setSessionCookie } from '@/lib/auth';
import { POST as keepPost, DELETE as keepDelete } from '@/app/api/keep/route';
import { POST as skipPost } from '@/app/api/skip/route';
import { POST as markPost } from '@/app/api/mark-delete/route';
import { POST as skipBatch } from '@/app/api/skip-batch/route';
import { GET as feedRandom } from '@/app/api/feed/random/route';

const GB = 1024 ** 3;

function media(rk: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
  return {
    ratingKey: rk,
    sectionId: '1',
    libraryKind: 'movie',
    title: `Title ${rk}`,
    year: 2020,
    thumb: null,
    sizeBytes: GB,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
    ...over,
  };
}

function jsonReq(body: unknown) {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function loginAs(plexUserId: string) {
  upsertUser({
    plexUserId,
    username: `user${plexUserId}`,
    email: null,
    thumb: null,
    isAdmin: false,
  });
  await setSessionCookie(plexUserId);
}

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
});
afterAll(() => {
  __closeDb();
});

describe('keep route (global)', () => {
  it('401 without a session', async () => {
    upsertMediaBatch([media('1')]);
    const res = await keepPost(jsonReq({ ratingKey: '1' }));
    expect(res.status).toBe(401);
  });

  it('marks an item kept for everyone', async () => {
    upsertMediaBatch([media('1')]);
    await loginAs('userA');
    const res = await keepPost(jsonReq({ ratingKey: '1' }));
    expect(res.status).toBe(200);
    expect(isKept('1')).toBe(true);
  });

  it('404 for an unknown item', async () => {
    await loginAs('userA');
    const res = await keepPost(jsonReq({ ratingKey: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('404 for a tombstoned item (gone from the server)', async () => {
    upsertMediaBatch([media('1'), media('2')], 1000);
    upsertMediaBatch([media('1')], 2000);
    tombstoneStale(2000); // item 2 removed
    await loginAs('userA');
    const res = await keepPost(jsonReq({ ratingKey: '2' }));
    expect(res.status).toBe(404);
    expect(isKept('2')).toBe(false);
  });

  it('400 invalid_json for a malformed body', async () => {
    await loginAs('userA');
    const res = await keepPost(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('DELETE removes the keep', async () => {
    upsertMediaBatch([media('1')]);
    await loginAs('userA');
    await keepPost(jsonReq({ ratingKey: '1' }));
    const res = await keepDelete(
      new Request('http://localhost/x', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ratingKey: '1' }),
      })
    );
    expect(res.status).toBe(200);
    expect(isKept('1')).toBe(false);
  });

  it("DELETE removes only the caller's keep; another user's stays", async () => {
    upsertMediaBatch([media('1')]);
    await loginAs('userA');
    await keepPost(jsonReq({ ratingKey: '1' }));
    cookieJar.clear();
    await loginAs('userB');
    await keepPost(jsonReq({ ratingKey: '1' }));
    await keepDelete(
      new Request('http://localhost/x', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ratingKey: '1' }),
      })
    );
    expect(isKeptByUser('userB', '1')).toBe(false);
    expect(isKeptByUser('userA', '1')).toBe(true);
    expect(isKept('1')).toBe(true); // still protected by A
  });
});

describe("keep + don't-care are mutually exclusive", () => {
  beforeEach(() => {
    upsertMediaBatch([media('1')]);
  });

  it("keeping clears my don't-care", async () => {
    await loginAs('userA');
    await skipPost(jsonReq({ ratingKey: '1' }));
    expect(isSkipped('userA', '1')).toBe(true);
    await keepPost(jsonReq({ ratingKey: '1' }));
    expect(isKeptByUser('userA', '1')).toBe(true);
    expect(isSkipped('userA', '1')).toBe(false);
  });

  it("don't-care clears my keep", async () => {
    await loginAs('userA');
    await keepPost(jsonReq({ ratingKey: '1' }));
    expect(isKeptByUser('userA', '1')).toBe(true);
    await skipPost(jsonReq({ ratingKey: '1' }));
    expect(isSkipped('userA', '1')).toBe(true);
    expect(isKeptByUser('userA', '1')).toBe(false);
  });

  it('keeping clears my "OK to delete" mark (three-way exclusive)', async () => {
    await loginAs('userA');
    replaceSeerrRequests('userA', ['1']);
    await markPost(jsonReq({ ratingKey: '1' }));
    expect(isMarkedForDelete('userA', '1')).toBe(true);
    await keepPost(jsonReq({ ratingKey: '1' }));
    expect(isKeptByUser('userA', '1')).toBe(true);
    expect(isMarkedForDelete('userA', '1')).toBe(false);
  });
});

describe('feed + skip-batch', () => {
  beforeEach(() => {
    upsertMediaBatch([media('1'), media('2'), media('3'), media('4')]);
  });

  it('feed excludes kept items', async () => {
    await loginAs('userA');
    await keepPost(jsonReq({ ratingKey: '1' }));
    const res = await feedRandom(new Request('http://localhost/api/feed/random'));
    const body = await res.json();
    const keys = body.items.map((i: { ratingKey: string }) => i.ratingKey);
    expect(keys).not.toContain('1');
    expect(body.remaining).toBe(3);
  });

  it('skip-batch clears my keep + OK-to-delete on the skipped keys (exclusive)', async () => {
    await loginAs('userA');
    await keepPost(jsonReq({ ratingKey: '2' }));
    addDelete('userA', '3');
    const res = await skipBatch(jsonReq({ ratingKeys: ['2', '3'] }));
    expect(res.status).toBe(200);
    expect(isSkipped('userA', '2')).toBe(true);
    expect(isKeptByUser('userA', '2')).toBe(false);
    expect(isMarkedForDelete('userA', '3')).toBe(false);
  });

  it('skip-batch ignores unknown and tombstoned keys', async () => {
    upsertMediaBatch([media('4')], 1000); // re-stamp 4 as stale...
    tombstoneStale(1001); // ...and tombstone only it
    await loginAs('userA');
    const res = await skipBatch(jsonReq({ ratingKeys: ['4', 'ghost', '2'] }));
    expect(res.status).toBe(200);
    expect(isSkipped('userA', '2')).toBe(true);
    expect(isSkipped('userA', '4')).toBe(false);
    expect(isSkipped('userA', 'ghost')).toBe(false);
  });

  it('skip-batch rejects a non-array body with 400', async () => {
    await loginAs('userA');
    const res = await skipBatch(jsonReq({ ratingKeys: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad_request');
  });

  it('skip-batch rejects an oversized batch with 400', async () => {
    await loginAs('userA');
    const keys = Array.from({ length: 501 }, (_, i) => String(i));
    const res = await skipBatch(jsonReq({ ratingKeys: keys }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('too_many_items');
  });

  it('skip-batch hides items for this user and returns a fresh batch', async () => {
    await loginAs('userA');
    const res = await skipBatch(jsonReq({ ratingKeys: ['2', '3'] }));
    const body = await res.json();
    expect(body.remaining).toBe(2); // 1 & 4 remain for userA
    const keys = body.items.map((i: { ratingKey: string }) => i.ratingKey).sort();
    expect(keys).toEqual(['1', '4']);

    // userB is unaffected by userA's skips.
    cookieJar.clear();
    await loginAs('userB');
    const resB = await feedRandom(
      new Request('http://localhost/api/feed/random')
    );
    const bodyB = await resB.json();
    expect(bodyB.remaining).toBe(4);
  });

  it('largest=1 includes kept items and has null remaining', async () => {
    await loginAs('userA');
    await keepPost(jsonReq({ ratingKey: '1' }));
    const res = await feedRandom(
      new Request('http://localhost/api/feed/random?largest=1')
    );
    const body = await res.json();
    const keys = body.items.map((i: { ratingKey: string }) => i.ratingKey);
    expect(keys).toContain('1'); // kept items still appear in "largest"
    expect(body.remaining).toBeNull();
  });
});

describe('errorResponse shapes', () => {
  it('500 body never echoes the exception text', async () => {
    const res = errorResponse(new Error('secret /internal/path leaked'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal_error' }); // no message field
  });

  it('SyntaxError (malformed request body) -> 400 invalid_json', async () => {
    const res = errorResponse(new SyntaxError('Unexpected token'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });
});
