import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { __setTestDbToMemory, __closeDb } from './db';
import { getJobState, setJobState } from './queries';
import { setJobSchedules } from './settings';
import { runWithState, dueJobs, isDue } from './jobs';
import type { JobSchedule } from './config';

// Turn every job off, so a test can enable just the one it cares about.
const ALL_OFF: Record<string, JobSchedule> = {
  recentlyAdded: { type: 'interval', minutes: 0 },
  library: { type: 'interval', minutes: 0 },
  sizes: { type: 'interval', minutes: 0 },
  watch: { type: 'interval', minutes: 0 },
  requests: { type: 'interval', minutes: 0 },
};

beforeEach(() => {
  __setTestDbToMemory();
});
afterAll(() => {
  __closeDb();
});

describe('runWithState', () => {
  it('records running → ok with duration + result', async () => {
    let clock = 1000;
    const ran = await runWithState(
      'library',
      async () => ({ result: 5, message: 'done' }),
      () => (clock += 250) // advances each call
    );
    expect(ran).toBe(true);
    const s = getJobState('library');
    expect(s.lastStatus).toBe('ok');
    expect(s.lastResult).toBe(5);
    expect(s.lastMessage).toBe('done');
    expect(s.lastDurationMs).toBeGreaterThan(0);
    expect(s.lastRun).not.toBeNull();
  });

  it('records error with the message and does not throw', async () => {
    const ran = await runWithState('sizes', async () => {
      throw new Error('boom');
    });
    expect(ran).toBe(true);
    const s = getJobState('sizes');
    expect(s.lastStatus).toBe('error');
    expect(s.lastMessage).toContain('boom');
  });

  it('is single-flight: skips when already running', async () => {
    setJobState('watch', { lastStatus: 'running' });
    let called = false;
    const ran = await runWithState('watch', async () => {
      called = true;
      return { result: 0, message: '' };
    });
    expect(ran).toBe(false);
    expect(called).toBe(false);
  });
});

describe('isDue (pure schedule check)', () => {
  const MIN = 60_000;

  it('interval: due once past N minutes since last run; 0 = never', () => {
    expect(isDue({ type: 'interval', minutes: 60 }, 0, 61 * MIN)).toBe(true);
    expect(isDue({ type: 'interval', minutes: 60 }, 0, 30 * MIN)).toBe(false);
    expect(isDue({ type: 'interval', minutes: 0 }, 0, 999 * MIN)).toBe(false);
  });

  it('daily: due once after the local HH:MM, not again until next day', () => {
    const day = new Date(2026, 0, 2, 5, 0, 0).getTime(); // local 05:00
    const before = new Date(2026, 0, 2, 2, 0, 0).getTime(); // local 02:00
    // At 05:00, never run today → due.
    expect(isDue({ type: 'daily', hour: 3, minute: 0 }, 0, day)).toBe(true);
    // Before 03:00 → not yet.
    expect(isDue({ type: 'daily', hour: 3, minute: 0 }, 0, before)).toBe(false);
    // Already ran after today's 03:00 → not again.
    const ranAt = Math.floor(new Date(2026, 0, 2, 3, 30, 0).getTime() / 1000);
    expect(isDue({ type: 'daily', hour: 3, minute: 0 }, ranAt, day)).toBe(false);
  });
});

describe('dueJobs', () => {
  const MIN = 60_000;

  it('returns enabled jobs past their interval', () => {
    setJobSchedules({ ...ALL_OFF, library: { type: 'interval', minutes: 60 } });
    expect(dueJobs(120 * MIN)).toContain('library');
  });

  it('skips disabled and running jobs', () => {
    setJobSchedules({ ...ALL_OFF, sizes: { type: 'interval', minutes: 60 } });
    setJobState('sizes', { lastStatus: 'running', lastRun: 0 });
    const due = dueJobs(120 * MIN);
    expect(due).not.toContain('library'); // disabled
    expect(due).not.toContain('sizes'); // running
  });
});
