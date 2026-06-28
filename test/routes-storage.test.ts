import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import os from 'node:os';

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
import { upsertMediaBatch, upsertUser, type UpsertMediaInput } from '@/lib/queries';
import { setStorageMappings } from '@/lib/settings';
import { setSessionCookie } from '@/lib/auth';
import { GET as storageGet } from '@/app/api/storage/route';

function media(rk: string): UpsertMediaInput {
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
  };
}

async function loginAs(plexUserId: string) {
  upsertUser({
    plexUserId,
    username: plexUserId,
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

describe('GET /api/storage', () => {
  it('401 without a session', async () => {
    const res = await storageGet();
    expect(res.status).toBe(401);
  });

  it('reports unconfigured when no mappings exist', async () => {
    await loginAs('userA');
    const body = await storageGet().then((r) => r.json());
    expect(body.report.configured).toBe(false);
  });

  it('reports totals when a real path is mapped', async () => {
    upsertMediaBatch([media('1')]);
    setStorageMappings([{ sectionId: '1', path: os.tmpdir() }]);
    await loginAs('userA');
    const body = await storageGet().then((r) => r.json());
    expect(body.report.configured).toBe(true);
    expect(body.report.totals.totalBytes).toBeGreaterThan(0);
  });
});
