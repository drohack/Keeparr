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
  isKept,
  isKeptByUser,
  isSkipped,
  upsertMediaBatch,
  upsertUser,
  type UpsertMediaInput,
} from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { POST as keepPost, DELETE as keepDelete } from '@/app/api/keep/route';
import { POST as skipPost } from '@/app/api/skip/route';
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

describe('keep + don’t-care are mutually exclusive', () => {
  beforeEach(() => {
    upsertMediaBatch([media('1')]);
  });

  it('keeping clears my don’t-care', async () => {
    await loginAs('userA');
    await skipPost(jsonReq({ ratingKey: '1' }));
    expect(isSkipped('userA', '1')).toBe(true);
    await keepPost(jsonReq({ ratingKey: '1' }));
    expect(isKeptByUser('userA', '1')).toBe(true);
    expect(isSkipped('userA', '1')).toBe(false);
  });

  it('don’t-care clears my keep', async () => {
    await loginAs('userA');
    await keepPost(jsonReq({ ratingKey: '1' }));
    expect(isKeptByUser('userA', '1')).toBe(true);
    await skipPost(jsonReq({ ratingKey: '1' }));
    expect(isSkipped('userA', '1')).toBe(true);
    expect(isKeptByUser('userA', '1')).toBe(false);
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
