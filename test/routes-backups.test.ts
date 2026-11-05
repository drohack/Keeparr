import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieJar, TMP } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  TMP: `${process.env.TMP ?? process.env.TEMP ?? '/tmp'}/keeparr-backup-routes-${process.pid}`,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

// Redirect DATA_DIR so backup files land in a temp dir (real files, no mocks).
vi.mock('@/lib/config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/config')>();
  return { ...orig, DATA_DIR: TMP, DB_PATH: `${TMP}/keeparr.db` };
});

import { __setTestDbToMemory, __closeDb } from '@/lib/db';
import { upsertUser } from '@/lib/queries';
import { setSessionCookie } from '@/lib/auth';
import { createBackup } from '@/lib/backup';
import { GET as backupsGet, POST as backupsPost, DELETE as backupsDelete } from '@/app/api/admin/backups/route';
import { GET as downloadGet } from '@/app/api/admin/backups/download/route';

beforeEach(() => {
  cookieJar.clear();
  __setTestDbToMemory();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  __closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function loginAs(plexUserId: string, isAdmin = false) {
  upsertUser({ plexUserId, username: plexUserId, email: null, thumb: null, isAdmin });
  await setSessionCookie(plexUserId);
}

const getReq = () => new Request('http://localhost/api/admin/backups');
const postReq = (body: unknown) =>
  new Request('http://localhost/api/admin/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const delReq = (body: unknown) =>
  new Request('http://localhost/api/admin/backups', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/admin/backups auth', () => {
  it('401 without a session', async () => {
    expect((await backupsGet()).status).toBe(401);
  });

  it('403 for a non-admin', async () => {
    await loginAs('user', false);
    expect((await backupsGet()).status).toBe(403);
  });
});

describe('/api/admin/backups', () => {
  beforeEach(() => loginAs('admin', true));

  it('lists backups', async () => {
    const name = await createBackup();
    const body = await backupsGet().then((r) => r.json());
    expect(body.backups.map((b: { name: string }) => b.name)).toContain(name);
  });

  it('rejects restore/delete with an invalid (traversal) name', async () => {
    const res = await backupsPost(postReq({ action: 'restore', name: '../../evil.db' }));
    expect(res.status).toBe(400);
    const del = await backupsDelete(delReq({ name: '..\\evil.db' }));
    expect(del.status).toBe(400);
  });

  it('unknown action -> 400', async () => {
    expect((await backupsPost(postReq({ action: 'nope' }))).status).toBe(400);
  });

  it('deletes an existing backup', async () => {
    const name = await createBackup();
    const res = await backupsDelete(delReq({ name })).then((r) => r.json());
    expect(res.deleted).toBe(true);
  });
});

describe('/api/admin/backups/download', () => {
  it('streams a backup with attachment headers; validates the name', async () => {
    await loginAs('admin', true);
    const name = await createBackup();
    const res = await downloadGet(
      new Request(`http://localhost/api/admin/backups/download?name=${name}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(name);
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);

    const bad = await downloadGet(
      new Request('http://localhost/api/admin/backups/download?name=../../etc/passwd')
    );
    expect(bad.status).toBe(400);

    const missing = await downloadGet(
      new Request('http://localhost/api/admin/backups/download?name=keeparr-19990101-000000.db')
    );
    expect(missing.status).toBe(404);
  });
});
