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
import { getUser, upsertUser } from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { POST as tutorialPost } from '@/app/api/tutorial/route';

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
});
afterAll(() => __closeDb());

describe('POST /api/tutorial', () => {
  it('requires a session', async () => {
    const res = await tutorialPost();
    expect(res.status).toBe(401);
  });

  it('marks only the calling user as done', async () => {
    upsertUser({ plexUserId: 'a', username: 'a', email: null, thumb: null, isAdmin: false });
    upsertUser({ plexUserId: 'b', username: 'b', email: null, thumb: null, isAdmin: false });
    expect(getUser('a')?.tutorialDone).toBe(false);
    await setSessionCookie('a');

    const res = await tutorialPost();
    expect(res.status).toBe(200);
    expect(getUser('a')?.tutorialDone).toBe(true);
    expect(getUser('b')?.tutorialDone).toBe(false);
  });
});
