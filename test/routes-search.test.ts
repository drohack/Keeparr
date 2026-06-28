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
  addKeep,
  addSkip,
  upsertMediaBatch,
  upsertUser,
  type UpsertMediaInput,
} from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { GET as searchGet } from '@/app/api/search/route';
import { GET as suggestGet } from '@/app/api/search/suggest/route';

function media(rk: string, title: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
  return {
    ratingKey: rk,
    sectionId: '1',
    libraryKind: 'movie',
    title,
    year: 2020,
    thumb: null,
    sizeBytes: 1024 ** 3,
    addedAt: 1000,
    guidTmdb: null,
    guidTvdb: null,
    ...over,
  };
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

function req(path: string) {
  return new Request(`http://localhost${path}`);
}

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
  upsertMediaBatch([
    media('1', 'Batman'),
    media('2', 'Batman Begins'),
    media('3', 'The Lego Batman Movie'),
    media('4', 'Superman'),
  ]);
});
afterAll(() => {
  __closeDb();
});

describe('GET /api/search', () => {
  it('401 without a session', async () => {
    const res = await searchGet(req('/api/search?q=batman'));
    expect(res.status).toBe(401);
  });

  it('ranks exact > prefix > substring', async () => {
    await loginAs('userA');
    const res = await searchGet(req('/api/search?q=batman'));
    const body = await res.json();
    const titles = body.items.map((i: { title: string }) => i.title);
    expect(titles[0]).toBe('Batman'); // exact
    expect(titles[1]).toBe('Batman Begins'); // prefix
    expect(titles).toContain('The Lego Batman Movie'); // substring, last
    expect(titles).not.toContain('Superman');
  });

  it('multi-token requires every token (AND)', async () => {
    await loginAs('userA');
    const res = await searchGet(req('/api/search?q=lego%20batman'));
    const titles = (await res.json()).items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(['The Lego Batman Movie']);
  });

  it('returns kept + per-user skipped flags', async () => {
    await loginAs('userA');
    addKeep('userB', '2'); // kept by someone else
    addSkip('userA', '3');
    const res = await searchGet(req('/api/search?q=batman'));
    const items = (await res.json()).items as {
      ratingKey: string;
      kept: boolean;
      skipped: boolean;
    }[];
    expect(items.find((i) => i.ratingKey === '2')?.kept).toBe(true);
    expect(items.find((i) => i.ratingKey === '3')?.skipped).toBe(true);
  });

  it('short query returns nothing', async () => {
    await loginAs('userA');
    const res = await searchGet(req('/api/search?q=a'));
    expect((await res.json()).items).toEqual([]);
  });
});

describe('GET /api/search/suggest', () => {
  it('returns at most 8 slim suggestions', async () => {
    await loginAs('userA');
    const res = await suggestGet(req('/api/search/suggest?q=batman'));
    const body = await res.json();
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions.length).toBeLessThanOrEqual(8);
    expect(body.suggestions[0]).toHaveProperty('thumbUrl');
    expect(body.suggestions[0]).toHaveProperty('title');
  });
});
