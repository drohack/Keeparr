import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/plex', () => ({
  createPin: vi.fn(async () => ({ id: 123, code: 'abcd' })),
  buildAuthUrl: vi.fn(() => 'http://auth.example'),
  checkPin: vi.fn(async () => null), // always "pending" -> poll returns fast
  // Unused by these tests but imported by the check route module:
  checkServerAccess: vi.fn(),
  getPlexAccount: vi.fn(),
}));

import { __setTestDbToMemory, __closeDb } from '@/lib/db';
import { __resetRateLimits } from '@/lib/rate-limit';
import { POST as pinPost } from '@/app/api/auth/plex/pin/route';
import { GET as checkGet } from '@/app/api/auth/plex/check/route';

function pinReq(ip: string): Request {
  return new Request('http://localhost/api/auth/plex/pin', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
}
function pollReq(ip: string): Request {
  return new Request('http://localhost/api/auth/plex/check?id=123', {
    headers: { 'x-forwarded-for': ip },
  });
}

beforeEach(() => {
  __setTestDbToMemory();
  __resetRateLimits();
});
afterAll(() => __closeDb());

describe('Plex PIN rate limiting', () => {
  it('caps pin creation per IP', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) last = await pinPost(pinReq('9.9.9.9'));
    expect(last!.status).toBe(429);
  });

  it('a different IP is not affected by another IP hitting the cap', async () => {
    for (let i = 0; i < 21; i++) await pinPost(pinReq('9.9.9.9'));
    const res = await pinPost(pinReq('9.9.9.10'));
    expect(res.status).not.toBe(429);
  });

  it('caps PIN polling per IP', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 121; i++) last = await checkGet(pollReq('9.9.9.9'));
    expect(last!.status).toBe(429);
  });
});
