import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { __setTestDbToMemory, __closeDb } from './db';
import { setJobState } from './queries';
import { writeSetting, setJobSchedules } from './settings';
import { __clearVersionCache, getVersionInfo } from './version';
import { healthIssues } from './health';

const NOW = 1_800_000_000; // fixed clock (unix seconds)

/** Minimal Plex-configured install (matches isServerConfigured for 'plex'). */
function configurePlex() {
  writeSetting('plex_machine_id', 'M1');
  writeSetting('plex_base_url', 'http://plex:32400');
  writeSetting('plex_server_token', 'tok');
}

const ids = async () => (await healthIssues(NOW)).map((i) => i.id).sort();

beforeEach(async () => {
  __setTestDbToMemory();
  // Warm the version cache with a failing fetcher so healthIssues() never
  // reaches out to the real GitHub API from unit tests.
  __clearVersionCache();
  await getVersionInfo(async () => {
    throw new Error('offline (test)');
  });
});
afterAll(() => __closeDb());

describe('healthIssues', () => {
  it('unconfigured install -> server-not-configured error (and nothing job-y)', async () => {
    const issues = await healthIssues(NOW);
    const server = issues.find((i) => i.id === 'server-not-configured');
    expect(server?.severity).toBe('error');
    expect(issues.some((i) => i.id.startsWith('job-'))).toBe(false);
  });

  it('healthy configured install -> no issues', async () => {
    configurePlex();
    expect(await ids()).toEqual([]);
  });

  it('a failing job for a configured feature -> error with its message', async () => {
    configurePlex();
    setJobState('library', { lastStatus: 'error', lastMessage: 'boom', lastRun: NOW });
    const issues = await healthIssues(NOW);
    const issue = issues.find((i) => i.id === 'job-library-failing');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('boom');
  });

  it("an unconfigured feature's failing job is ignored (Seerr not connected)", async () => {
    configurePlex();
    setJobState('requests', { lastStatus: 'error', lastMessage: 'no seerr', lastRun: NOW });
    expect(await ids()).toEqual([]);
  });

  it('a job silent for >2x its cadence -> stale warning (but not if never run)', async () => {
    configurePlex();
    // recentlyAdded runs every 5 min by default; 3h old = way past 2x cadence.
    setJobState('recentlyAdded', { lastStatus: 'ok', lastRun: NOW - 3 * 3600 });
    const issues = await healthIssues(NOW);
    expect(issues.find((i) => i.id === 'job-recentlyAdded-stale')?.severity).toBe('warning');
    // library (daily) has never run -> no stale warning for it.
    expect(issues.some((i) => i.id === 'job-library-stale')).toBe(false);
  });

  it('backups set to manual-only -> backups-disabled warning', async () => {
    configurePlex();
    setJobSchedules({ backup: { type: 'interval', minutes: 0 } });
    expect(await ids()).toEqual(['backups-disabled']);
  });

  it('update available (cached version info) -> warning', async () => {
    configurePlex();
    __clearVersionCache();
    await getVersionInfo(async () => ({ tag_name: 'v99.0.0' })); // warm the cache
    const issues = await healthIssues(NOW);
    const upd = issues.find((i) => i.id === 'update-available');
    expect(upd?.severity).toBe('warning');
    expect(upd?.message).toContain('99.0.0');
  });
});
