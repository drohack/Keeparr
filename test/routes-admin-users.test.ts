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
import { getUser, upsertUser } from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { writeSetting } from '@/lib/settings';
import { GET as usersGet, PUT as usersPut } from '@/app/api/admin/users/route';

function putReq(body: unknown) {
  return new Request('http://localhost/api/admin/users', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq() {
  return new Request('http://localhost/api/admin/users');
}

async function loginAs(plexUserId: string, isAdmin: boolean) {
  upsertUser({
    plexUserId,
    username: `user${plexUserId}`,
    email: null,
    thumb: null,
    isAdmin,
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

describe('GET /api/admin/users', () => {
  it('401 without a session', async () => {
    const res = await usersGet();
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin user', async () => {
    await loginAs('regular', false);
    const res = await usersGet();
    expect(res.status).toBe(403);
  });

  it('returns all users with isOwner annotated for an admin', async () => {
    writeSetting('plex_owner_id', 'owner');
    await loginAs('owner', true);
    upsertUser({
      plexUserId: 'regular',
      username: 'regular',
      email: null,
      thumb: null,
      isAdmin: false,
    });

    const res = await usersGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: { plexUserId: string; isOwner: boolean; isAdmin: boolean }[];
    };
    const owner = body.users.find((u) => u.plexUserId === 'owner');
    const regular = body.users.find((u) => u.plexUserId === 'regular');
    expect(owner?.isOwner).toBe(true);
    expect(owner?.isAdmin).toBe(true);
    expect(regular?.isOwner).toBe(false);
    expect(regular?.isAdmin).toBe(false);
  });
});

describe('PUT /api/admin/users', () => {
  beforeEach(async () => {
    writeSetting('plex_owner_id', 'owner');
    await loginAs('owner', true);
  });

  it('promotes a regular user to admin', async () => {
    upsertUser({
      plexUserId: 'regular',
      username: 'regular',
      email: null,
      thumb: null,
      isAdmin: false,
    });
    const res = await usersPut(putReq({ plexUserId: 'regular', isAdmin: true }));
    expect(res.status).toBe(200);
    expect(getUser('regular')?.isAdmin).toBe(true);
  });

  it('demotes a promoted admin back to regular', async () => {
    upsertUser({
      plexUserId: 'promoted',
      username: 'promoted',
      email: null,
      thumb: null,
      isAdmin: true,
    });
    const res = await usersPut(putReq({ plexUserId: 'promoted', isAdmin: false }));
    expect(res.status).toBe(200);
    expect(getUser('promoted')?.isAdmin).toBe(false);
  });

  it('refuses to demote the Owner', async () => {
    const res = await usersPut(putReq({ plexUserId: 'owner', isAdmin: false }));
    expect(res.status).toBe(400);
    expect(getUser('owner')?.isAdmin).toBe(true);
  });

  it('404 for an unknown user', async () => {
    const res = await usersPut(putReq({ plexUserId: 'ghost', isAdmin: true }));
    expect(res.status).toBe(404);
  });

  it('403 when a non-admin tries to change admin status', async () => {
    cookieJar.clear();
    await loginAs('regular', false);
    upsertUser({
      plexUserId: 'victim',
      username: 'victim',
      email: null,
      thumb: null,
      isAdmin: false,
    });
    const res = await usersPut(putReq({ plexUserId: 'victim', isAdmin: true }));
    expect(res.status).toBe(403);
    expect(getUser('victim')?.isAdmin).toBe(false);
  });
});
