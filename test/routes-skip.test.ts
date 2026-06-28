import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

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
  isSkipped,
  upsertMediaBatch,
  upsertUser,
  type UpsertMediaInput,
} from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { POST as skipPost, DELETE as skipDelete } from '@/app/api/skip/route';

function media(rk: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
  return {
    ratingKey: rk,
    sectionId: '1',
    libraryKind: 'movie',
    title: `Title ${rk}`,
    year: 2020,
    thumb: null,
    sizeBytes: 1024 ** 3,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
    ...over,
  };
}

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://localhost/api/skip', {
    method,
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

describe('skip route (per-user)', () => {
  it('401 without a session', async () => {
    upsertMediaBatch([media('1')]);
    const res = await skipPost(jsonReq({ ratingKey: '1' }));
    expect(res.status).toBe(401);
  });

  it('POST marks an item don\'t-care for this user only', async () => {
    upsertMediaBatch([media('1')]);
    await loginAs('userA');
    const res = await skipPost(jsonReq({ ratingKey: '1' }));
    expect(res.status).toBe(200);
    expect(isSkipped('userA', '1')).toBe(true);
    expect(isSkipped('userB', '1')).toBe(false);
  });

  it('404 for an unknown item', async () => {
    await loginAs('userA');
    const res = await skipPost(jsonReq({ ratingKey: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('DELETE clears the skip', async () => {
    upsertMediaBatch([media('1')]);
    await loginAs('userA');
    await skipPost(jsonReq({ ratingKey: '1' }));
    const res = await skipDelete(jsonReq({ ratingKey: '1' }, 'DELETE'));
    expect(res.status).toBe(200);
    expect(isSkipped('userA', '1')).toBe(false);
  });
});
