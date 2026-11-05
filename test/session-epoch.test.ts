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
import { upsertUser, getUserEpoch, setUserEnabled } from '@/lib/queries';
import { getSessionUser, setSessionCookie } from '@/lib/auth';

async function loginAs(id: string) {
  upsertUser({ plexUserId: id, username: id, email: null, thumb: null, isAdmin: false });
  await setSessionCookie(id);
}

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
});
afterAll(() => __closeDb());

describe('session epoch revocation', () => {
  it('disabling a user invalidates their existing tokens immediately', async () => {
    await loginAs('userB');
    expect((await getSessionUser())?.plexUserId).toBe('userB');
    setUserEnabled('userB', false);
    // Both the enabled check AND the epoch bump now reject the old token.
    expect(await getSessionUser()).toBeNull();
    expect(getUserEpoch('userB')).toBe(1);
  });

  it('re-enabling does not revive a token minted before the disable', async () => {
    await loginAs('userA');
    setUserEnabled('userA', false);
    setUserEnabled('userA', true);

    // The account is enabled again, but the old cookie carries the old epoch.
    expect(await getSessionUser()).toBeNull();

    // Signing in again mints a token at the new epoch and works.
    await setSessionCookie('userA');
    expect((await getSessionUser())?.plexUserId).toBe('userA');
  });
});
