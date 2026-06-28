import {
  syncLibrary,
  syncRecentlyAdded,
  syncSeerrRequests,
  syncSizes,
  syncWatchHistory,
  type JobResult,
} from './sync';
import {
  getAllJobState,
  getJobState,
  isJobRunning,
  logEvent,
  recordJobRun,
  setJobState,
} from './queries';
import { getJobSchedules } from './settings';
import type { JobSchedule } from './config';
import type { JobState } from './types';

export type JobId =
  | 'recentlyAdded'
  | 'library'
  | 'sizes'
  | 'watch'
  | 'requests';

export interface JobDef {
  id: JobId;
  label: string;
  run: () => Promise<JobResult>;
}

/** The schedulable refresh jobs, in display order. */
export const JOBS: JobDef[] = [
  { id: 'recentlyAdded', label: 'Plex Recently Added Scan', run: syncRecentlyAdded },
  { id: 'library', label: 'Plex Full Library Scan', run: syncLibrary },
  { id: 'sizes', label: 'Library size', run: syncSizes },
  { id: 'watch', label: 'Tautulli', run: syncWatchHistory },
  { id: 'requests', label: 'Seerr', run: syncSeerrRequests },
];

export const JOB_IDS = JOBS.map((j) => j.id);

export function isJobId(id: string): id is JobId {
  return (JOB_IDS as string[]).includes(id);
}

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Run a job body with single-flight + status bookkeeping. Exported for tests so
 * the state machine can be exercised with an arbitrary fn. Resolves to false if
 * the job was already running (skipped).
 */
export async function runWithState(
  id: string,
  fn: () => Promise<JobResult>,
  clock: () => number = () => Date.now()
): Promise<boolean> {
  if (isJobRunning(id)) return false;
  const started = clock();
  const startedSec = nowSec();
  setJobState(id, { lastStatus: 'running', lastMessage: 'Running…' });
  try {
    const { result, message } = await fn();
    const durationMs = clock() - started;
    setJobState(id, {
      lastStatus: 'ok',
      lastRun: nowSec(),
      lastMessage: message,
      lastDurationMs: durationMs,
      lastResult: result,
    });
    recordJobRun({
      jobId: id,
      startedAt: startedSec,
      endedAt: nowSec(),
      status: 'ok',
      message,
      durationMs,
      result,
    });
    logEvent('info', `job:${id}`, message);
    return true;
  } catch (e) {
    const durationMs = clock() - started;
    setJobState(id, {
      lastStatus: 'error',
      lastRun: nowSec(),
      lastMessage: String(e),
      lastDurationMs: durationMs,
    });
    recordJobRun({
      jobId: id,
      startedAt: startedSec,
      endedAt: nowSec(),
      status: 'error',
      message: String(e),
      durationMs,
      result: null,
    });
    logEvent('error', `job:${id}`, String(e));
    return true;
  }
}

/** Run a registered job by id (single-flight). Returns false if unknown/running. */
export async function runJob(id: string): Promise<boolean> {
  const job = JOBS.find((j) => j.id === id);
  if (!job) return false;
  return runWithState(job.id, job.run);
}

/**
 * Whether a job is due now under its schedule: interval (every N min, 0 = off)
 * or daily (once per day after a local HH:MM). Pure w.r.t. the passed clock.
 */
export function isDue(
  sch: JobSchedule | undefined,
  lastRun: number,
  nowMs: number
): boolean {
  if (!sch) return false;
  const nowS = Math.floor(nowMs / 1000);
  if (sch.type === 'interval') {
    return sch.minutes > 0 && nowS >= lastRun + sch.minutes * 60;
  }
  // daily: due once today, after the target local time.
  const target = new Date(nowMs);
  target.setHours(sch.hour, sch.minute, 0, 0);
  const targetS = Math.floor(target.getTime() / 1000);
  return nowS >= targetS && lastRun < targetS;
}

export function dueJobs(nowMs: number = Date.now()): JobId[] {
  const schedules = getJobSchedules();
  const due: JobId[] = [];
  for (const { id } of JOBS) {
    if (isJobRunning(id)) continue;
    const lastRun = getJobState(id).lastRun ?? 0;
    if (isDue(schedules[id], lastRun, nowMs)) due.push(id);
  }
  return due;
}

/** Job state for every registered job (with its schedule + label). */
export function jobStates(): (JobState & { label: string; schedule: JobSchedule })[] {
  const schedules = getJobSchedules();
  const byId = new Map(getAllJobState().map((s) => [s.jobId, s]));
  return JOBS.map((j) => {
    const state = byId.get(j.id) ?? getJobState(j.id);
    return {
      ...state,
      label: j.label,
      schedule: schedules[j.id] ?? { type: 'interval', minutes: 0 },
    };
  });
}
