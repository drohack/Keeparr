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
  getJobState,
  replaceSeerrRequests,
  upsertMediaBatch,
  upsertUser,
  type UpsertMediaInput,
} from '@/lib/queries';
import { setApiKey, writeSetting } from '@/lib/settings';
import { runJob } from '@/lib/jobs';
import { setSessionCookie } from '@/lib/auth';
import { GET as jobsGet, POST as jobsPost } from '@/app/api/admin/jobs/route';
import { GET as requestsGet } from '@/app/api/requests/route';
import { GET as libraryGet } from '@/app/api/library/route';

function media(rk: string, over: Partial<UpsertMediaInput> = {}): UpsertMediaInput {
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
    ...over,
  };
}

async function loginAs(plexUserId: string, isAdmin = false) {
  upsertUser({
    plexUserId,
    username: plexUserId,
    email: null,
    thumb: null,
    isAdmin,
  });
  await setSessionCookie(plexUserId);
}

function configureServer() {
  writeSetting('plex_machine_id', 'mid');
  writeSetting('plex_base_url', 'http://pms');
  writeSetting('plex_server_token', 'tok');
}

function postReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function getReq(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/jobs', { headers });
}

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
});
afterAll(() => {
  __closeDb();
});

describe('GET /api/admin/jobs', () => {
  it('401 without a session', async () => {
    expect((await jobsGet(getReq())).status).toBe(401);
  });

  it('403 for non-admin', async () => {
    await loginAs('u', false);
    expect((await jobsGet(getReq())).status).toBe(403);
  });

  it('returns a row per job for an admin', async () => {
    await loginAs('admin', true);
    const body = await jobsGet(getReq()).then((r) => r.json());
    expect(body.jobs.map((j: { jobId: string }) => j.jobId).sort()).toEqual([
      'library',
      'recentlyAdded',
      'requests',
      'sizes',
      'watch',
    ]);
    expect(body.jobs[0]).toHaveProperty('label');
    expect(body.jobs[0]).toHaveProperty('schedule');
  });
});

describe('POST /api/admin/jobs', () => {
  it('403 for non-admin', async () => {
    await loginAs('u', false);
    expect((await jobsPost(postReq({ job: 'library' }))).status).toBe(403);
  });

  it('400 when the server is not configured', async () => {
    await loginAs('admin', true);
    expect((await jobsPost(postReq({ job: 'library' }))).status).toBe(400);
  });

  it('400 for an unknown job', async () => {
    await loginAs('admin', true);
    configureServer();
    const res = await jobsPost(postReq({ job: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('starts a valid job', async () => {
    await loginAs('admin', true);
    configureServer();
    const body = await jobsPost(postReq({ job: 'requests' })).then((r) => r.json());
    expect(body.started).toBe(true);
  });
});

describe('API key auth (no session)', () => {
  it('GET accepts a valid X-Api-Key', async () => {
    setApiKey('secret-key');
    const res = await jobsGet(getReq({ 'x-api-key': 'secret-key' }));
    expect(res.status).toBe(200);
  });

  it('GET rejects a bad X-Api-Key', async () => {
    setApiKey('secret-key');
    const res = await jobsGet(getReq({ 'x-api-key': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('POST triggers a job with a valid key', async () => {
    setApiKey('secret-key');
    configureServer();
    const res = await jobsPost(postReq({ job: 'requests' }, { 'x-api-key': 'secret-key' }));
    expect((await res.json()).started).toBe(true);
  });
});

describe('requests job runner (no HTTP when Seerr unconfigured)', () => {
  it('runJob(requests) records ok without network', async () => {
    const ran = await runJob('requests');
    expect(ran).toBe(true);
    const s = getJobState('requests');
    expect(s.lastStatus).toBe('ok');
    expect(s.lastMessage).toContain('not configured');
  });
});

describe('Seerr served from cache', () => {
  it('/api/requests returns cached keys', async () => {
    await loginAs('userA');
    replaceSeerrRequests('userA', ['10', '20']);
    const body = await requestsGet().then((r) => r.json());
    expect(body.ratingKeys.sort()).toEqual(['10', '20']);
  });

  it('library requestedByMe filters by the cache', async () => {
    await loginAs('userA');
    upsertMediaBatch([media('10'), media('20'), media('30')]);
    replaceSeerrRequests('userA', ['20']);
    const res = await libraryGet(
      new Request('http://localhost/api/library?requestedByMe=1')
    ).then((r) => r.json());
    expect(res.items.map((i: { ratingKey: string }) => i.ratingKey)).toEqual(['20']);
  });
});
