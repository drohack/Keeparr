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

// Only the plex.tv network calls are faked; the access match itself is real.
vi.mock('@/lib/plex', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/plex')>();
  return {
    hasServerResource: actual.hasServerResource,
    checkPin: vi.fn(async () => 'shared-user-token'),
    getPlexAccount: vi.fn(async () => ({
      id: '20000002',
      uuid: 'u',
      username: 'shareduser',
      email: 'shared@example.com',
      title: null,
      thumb: null,
    })),
    getResources: vi.fn(),
  };
});

import { __setTestDbToMemory, __closeDb } from '@/lib/db';
import { __resetRateLimits } from '@/lib/rate-limit';
import { getUser, recentLogs, upsertUser } from '@/lib/queries';
import { writeSetting } from '@/lib/settings';
import { getResources, type PlexResource } from '@/lib/plex';
import { GET as checkGet } from '@/app/api/auth/plex/check/route';

const MACHINE = 'carlflix-machine-id';

function resource(clientIdentifier: string, owned: boolean): PlexResource {
  return {
    name: clientIdentifier,
    clientIdentifier,
    provides: 'server',
    accessToken: 'res-token',
    owned,
    connections: [],
  };
}

function poll(): Promise<Response> {
  return checkGet(new Request('http://localhost/api/auth/plex/check?id=7'));
}

beforeEach(() => {
  __setTestDbToMemory();
  __resetRateLimits();
  cookieJar.clear();
  vi.clearAllMocks();
  // A configured Plex server, set up by an admin who is NOT the signing-in user
  // (and need not be the server's owner - their token is never consulted here).
  writeSetting('plex_owner_id', '3629986');
  writeSetting('plex_admin_token', 'setup-person-token');
  writeSetting('plex_machine_id', MACHINE);
  writeSetting('plex_base_url', 'http://192.0.2.10:32400');
  writeSetting('plex_server_token', 'server-token');
  writeSetting('plex_server_name', 'CarlFlix');
  upsertUser({ plexUserId: '3629986', username: 'admin', email: null, thumb: null, isAdmin: true });
});
afterAll(() => __closeDb());

describe('GET /api/auth/plex/check - server access from the user\'s own resources', () => {
  it('admits a user the server is shared with, using their own token', async () => {
    vi.mocked(getResources).mockResolvedValueOnce([
      resource('their-own-server', true),
      resource(MACHINE, false),
    ]);
    const res = await poll();
    expect(await res.json()).toMatchObject({ status: 'authorized', isAdmin: false });
    expect(vi.mocked(getResources)).toHaveBeenCalledWith('shared-user-token');
    expect(getUser('20000002')).not.toBeNull();
    expect(cookieJar.has('keeparr_session')).toBe(true);
  });

  it('denies a user the server is not shared with, and logs why', async () => {
    vi.mocked(getResources).mockResolvedValueOnce([resource('their-own-server', true)]);
    const res = await poll();
    expect(await res.json()).toEqual({ status: 'denied', reason: 'no_server_access' });
    expect(getUser('20000002')).toBeNull();
    const msg = recentLogs({ q: 'Sign-in denied' })[0]?.message;
    expect(msg).toContain('shareduser');
    expect(msg).toContain('CarlFlix is not shared with this Plex account');
  });

  it('reports a failed plex.tv lookup as an error, not a denial', async () => {
    vi.mocked(getResources).mockRejectedValueOnce(new Error('plex.tv 503'));
    const res = await poll();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'plex_check_failed' });
    expect(recentLogs({ q: 'Server-access check' })[0]).toMatchObject({ level: 'warn' });
    expect(recentLogs({ q: 'Sign-in denied' })).toHaveLength(0);
    expect(getUser('20000002')).toBeNull();
  });

  it('names closed sign-in when the account is shared but not enabled', async () => {
    writeSetting('open_signin', 'false');
    vi.mocked(getResources).mockResolvedValueOnce([resource(MACHINE, false)]);
    const res = await poll();
    expect(await res.json()).toEqual({ status: 'denied', reason: 'not_enabled' });
    expect(recentLogs({ q: 'Sign-in denied' })[0]?.message).toContain(
      'open sign-in is off and this account is not enabled'
    );
  });

  it('never asks plex.tv about the recorded owner', async () => {
    const { getPlexAccount } = await import('@/lib/plex');
    vi.mocked(getPlexAccount).mockResolvedValueOnce({
      id: '3629986',
      uuid: 'u',
      username: 'admin',
      email: null,
      title: null,
      thumb: null,
    });
    const res = await poll();
    expect(await res.json()).toMatchObject({ status: 'authorized', isAdmin: true });
    expect(vi.mocked(getResources)).not.toHaveBeenCalled();
  });
});
