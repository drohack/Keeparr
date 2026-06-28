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
import { GET as libraryGet } from '@/app/api/library/route';

function media(rk: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
  return {
    ratingKey: rk,
    sectionId: '1',
    libraryKind: 'movie',
    title: `Title ${rk}`,
    year: 2000 + Number(rk),
    thumb: null,
    sizeBytes: Number(rk) * 1024 ** 3,
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

function req(qs: string) {
  return new Request(`http://localhost/api/library?${qs}`);
}

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
  upsertMediaBatch([media('1'), media('2'), media('3')]);
});
afterAll(() => {
  __closeDb();
});

describe('GET /api/library', () => {
  it('401 without a session', async () => {
    const res = await libraryGet(req('sort=size'));
    expect(res.status).toBe(401);
  });

  it('year sort respects direction', async () => {
    await loginAs('userA');
    const asc = await libraryGet(req('sort=year&dir=asc')).then((r) => r.json());
    expect(asc.items.map((i: { year: number }) => i.year)).toEqual([2001, 2002, 2003]);
    const desc = await libraryGet(req('sort=year&dir=desc')).then((r) => r.json());
    expect(desc.items.map((i: { year: number }) => i.year)).toEqual([2003, 2002, 2001]);
  });

  it('kept + skip filters', async () => {
    await loginAs('userA');
    addKeep('userA', '1');
    addSkip('userA', '2');

    const keptOnly = await libraryGet(req('kept=kept')).then((r) => r.json());
    expect(keptOnly.items.map((i: { ratingKey: string }) => i.ratingKey)).toEqual(['1']);

    const skipOnly = await libraryGet(req('skip=skipped')).then((r) => r.json());
    expect(skipOnly.items.map((i: { ratingKey: string }) => i.ratingKey)).toEqual(['2']);
    expect(skipOnly.items[0].skipped).toBe(true);
  });

  it('requestedByMe with Seerr unconfigured returns nothing', async () => {
    await loginAs('userA');
    const res = await libraryGet(req('requestedByMe=1')).then((r) => r.json());
    expect(res.items).toHaveLength(0);
  });

  it('filters by multiple selected libraries', async () => {
    // items 1-3 are in section '1'; add some in '2' and '3'.
    upsertMediaBatch([
      media('10', { sectionId: '2' }),
      media('20', { sectionId: '3' }),
    ]);
    await loginAs('userA');
    const res = await libraryGet(req('sections=2,3')).then((r) => r.json());
    const keys = res.items.map((i: { ratingKey: string }) => i.ratingKey).sort();
    expect(keys).toEqual(['10', '20']);
  });
});
