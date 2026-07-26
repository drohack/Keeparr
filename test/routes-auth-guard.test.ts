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
import { upsertUser } from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';

// The previously untested route modules. Every /api/ route must guard ITSELF:
// middleware's X-Api-Key passthrough only DEFERS validation to the handler, so
// an unguarded route would be an open door. This sweep pins each one's guard
// (and that the guard runs BEFORE any body/network/fs work — bare Requests
// with no body would explode otherwise).
import { GET as health } from '@/app/api/health/route';
import { GET as about } from '@/app/api/about/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as sections } from '@/app/api/sections/route';
import { GET as stats } from '@/app/api/stats/route';
import { GET as overview } from '@/app/api/overview/route';
import { GET as facets } from '@/app/api/library/facets/route';
import { GET as openapi } from '@/app/api/openapi.json/route';
import { GET as adminStorageCheck } from '@/app/api/admin/storage-check/route';
import { POST as adminUsersImport } from '@/app/api/admin/users/import/route';
import { GET as adminPlexServers } from '@/app/api/admin/plex-servers/route';
import { GET as adminArrHealth } from '@/app/api/admin/arr-health/route';
import { GET as adminCacheGet, POST as adminCachePost } from '@/app/api/admin/cache/route';
import { POST as adminSyncLibraries } from '@/app/api/admin/sync-libraries/route';
import { POST as adminTestConnection } from '@/app/api/admin/test-connection/route';
import { GET as adminHealth } from '@/app/api/admin/health/route';
import { GET as adminLogsGet, DELETE as adminLogsDelete } from '@/app/api/admin/logs/route';
import { GET as adminProblems } from '@/app/api/admin/problems/route';
import { GET as adminProblemsSummary } from '@/app/api/admin/problems/summary/route';

type Handler = (req: Request) => Promise<Response>;

const req = (method = 'GET') => new Request('http://localhost/api/x', { method });

async function loginAs(plexUserId: string, isAdmin = false) {
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

const USER_GUARDED: [string, Handler, string][] = [
  ['GET /api/about', about, 'GET'],
  ['GET /api/sections', sections, 'GET'],
  ['GET /api/stats', stats, 'GET'],
  ['GET /api/overview', overview, 'GET'],
  ['GET /api/library/facets', facets, 'GET'],
  ['GET /api/openapi.json', openapi, 'GET'],
];

const ADMIN_GUARDED: [string, Handler, string][] = [
  ['GET /api/admin/storage-check', adminStorageCheck, 'GET'],
  ['POST /api/admin/users/import', adminUsersImport, 'POST'],
  ['GET /api/admin/plex-servers', adminPlexServers, 'GET'],
  ['GET /api/admin/arr-health', adminArrHealth, 'GET'],
  ['GET /api/admin/cache', adminCacheGet, 'GET'],
  ['POST /api/admin/cache', adminCachePost, 'POST'],
  ['POST /api/admin/sync-libraries', adminSyncLibraries, 'POST'],
  ['POST /api/admin/test-connection', adminTestConnection, 'POST'],
  ['GET /api/admin/health', adminHealth, 'GET'],
  ['GET /api/admin/logs', adminLogsGet, 'GET'],
  ['DELETE /api/admin/logs', adminLogsDelete, 'DELETE'],
  ['GET /api/admin/problems', adminProblems, 'GET'],
  ['GET /api/admin/problems/summary', adminProblemsSummary, 'GET'],
];

describe('public routes stay public', () => {
  it('GET /api/health → 200 (liveness probe)', async () => {
    expect((await health()).status).toBe(200);
  });

  it('GET /api/auth/me → 200 {user:null} when signed out', async () => {
    const res = await authMe();
    expect(res.status).toBe(200);
    expect((await res.json()).user).toBeNull();
  });

  it('POST /api/auth/logout → 200 without a session (idempotent)', async () => {
    expect((await logout()).status).toBe(200);
  });
});

describe('user-guarded routes reject anonymous requests', () => {
  for (const [name, handler, method] of USER_GUARDED) {
    it(`${name} → 401`, async () => {
      expect((await handler(req(method))).status).toBe(401);
    });
  }
});

describe('admin routes reject anonymous AND non-admin requests', () => {
  for (const [name, handler, method] of ADMIN_GUARDED) {
    it(`${name} → 401 anonymous`, async () => {
      expect((await handler(req(method))).status).toBe(401);
    });

    it(`${name} → 403 for a signed-in non-admin`, async () => {
      await loginAs('pleb');
      expect((await handler(req(method))).status).toBe(403);
    });
  }
});

describe('logout revokes this device', () => {
  it('a guarded route works before logout and 401s after', async () => {
    await loginAs('userA');
    expect((await sections()).status).toBe(200);
    await logout();
    expect((await sections()).status).toBe(401);
  });
});
