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

// Credentials always fail - we only care that each attempt consumes a rate-limit
// hit, not the auth outcome.
vi.mock('@/lib/jellyfin', () => ({
  authenticateByName: vi.fn(async () => {
    throw new Error('bad creds');
  }),
}));

import { __setTestDbToMemory, __closeDb } from '@/lib/db';
import { __resetRateLimits } from '@/lib/rate-limit';
import { setMediaServerType, setServerField } from '@/lib/settings';
import { POST as loginPost } from '@/app/api/auth/login/route';

function attempt(username: string, ip: string): Promise<Response> {
  return loginPost(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ username, password: 'x' }),
    })
  );
}

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
  __resetRateLimits();
  setMediaServerType('jellyfin');
  setServerField('jellyfin', 'url', 'http://jellyfin.local');
});
afterAll(() => {
  __closeDb();
});

describe('POST /api/auth/login rate limiting', () => {
  it('per-username bucket trips despite rotating X-Forwarded-For', async () => {
    // A fresh spoofed IP every request means the per-IP bucket never fills, but
    // the same username hammers the per-username bucket.
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await attempt('victim', `10.0.0.${i}`);
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBeTruthy();
  });

  it('a different username from the same run is not yet limited', async () => {
    for (let i = 0; i < 11; i++) await attempt('victim', `10.0.0.${i}`);
    // Distinct username + distinct IP -> only the global bucket has accrued.
    const res = await attempt('someone-else', '10.0.0.200');
    expect(res.status).not.toBe(429);
  });

  it('global bucket caps distributed spraying across unique users and IPs', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 51; i++) {
      last = await attempt(`user${i}`, `172.16.0.${i}`);
    }
    expect(last!.status).toBe(429);
  });
});
