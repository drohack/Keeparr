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

vi.mock('@/lib/plex', () => ({
  createPin: vi.fn(async () => ({ id: 4242, code: 'abcd' })),
  buildAuthUrl: vi.fn(() => 'https://app.plex.tv/auth#?code=abcd'),
  checkPin: vi.fn(async () => null),
  getPlexAccount: vi.fn(async () => ({
    id: '10000001',
    uuid: 'u',
    username: 'serverowner',
    email: 'owner@example.com',
    title: null,
    thumb: null,
  })),
}));

import { __setTestDbToMemory, __closeDb } from '@/lib/db';
import { upsertUser } from '@/lib/queries';
import { readSetting, writeSetting } from '@/lib/settings';
import { setSessionCookie } from '@/lib/auth';
import { checkPin } from '@/lib/plex';
import { GET as authGet, POST as authPost } from '@/app/api/admin/plex-auth/route';

const ADMIN = '3629986';

async function signInAsAdmin() {
  upsertUser({
    plexUserId: ADMIN,
    username: 'drohack',
    email: null,
    thumb: null,
    isAdmin: true,
  });
  await setSessionCookie(ADMIN);
}

beforeEach(async () => {
  __setTestDbToMemory();
  cookieJar.clear();
  vi.clearAllMocks();
  writeSetting('plex_admin_token', 'stale-token-from-first-run');
});
afterAll(() => __closeDb());

describe('POST/GET /api/admin/plex-auth (re-auth the stored Plex token)', () => {
  it('requires an admin', async () => {
    const res = await authPost();
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('starts a PIN and returns an auth URL', async () => {
    await signInAsAdmin();
    const res = await authPost();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 4242, authUrl: expect.stringContaining('plex.tv') });
  });

  it('reports pending while the user has not authorised yet', async () => {
    await signInAsAdmin();
    const res = await authGet(new Request('http://localhost/api/admin/plex-auth?id=4242'));
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('replaces the stored admin token and names the account once authorised', async () => {
    await signInAsAdmin();
    vi.mocked(checkPin).mockResolvedValueOnce('owner-token');
    const res = await authGet(new Request('http://localhost/api/admin/plex-auth?id=4242'));
    expect(await res.json()).toEqual({ status: 'authorized', username: 'serverowner' });
    // The whole point: the first-run token is gone, replaced by the owner's.
    expect(readSetting('plex_admin_token')).not.toBe('stale-token-from-first-run');
  });

  it('does NOT change who is signed in', async () => {
    // Signing in as the server owner here must not turn the current admin INTO
    // that person; this only swaps a stored service credential.
    await signInAsAdmin();
    const before = cookieJar.get('keeparr_session');
    vi.mocked(checkPin).mockResolvedValueOnce('owner-token');
    await authGet(new Request('http://localhost/api/admin/plex-auth?id=4242'));
    expect(cookieJar.get('keeparr_session')).toBe(before);
  });

  it('rejects a missing or junk pin id', async () => {
    await signInAsAdmin();
    const res = await authGet(new Request('http://localhost/api/admin/plex-auth?id=nope'));
    expect(res.status).toBe(400);
  });
});
