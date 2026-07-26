import { JOBS, type JobId } from './jobs';
import { getJobState } from './queries';
import {
  getJobSchedules,
  getManagedSections,
  getStorageMappings,
  isArrConfigured,
  isSeerrConfigured,
  isServerConfigured,
  isWatchAvailable,
} from './settings';
import { getVersionInfo } from './version';
import type { JobSchedule } from './config';

/**
 * Health checks (the Servarr System → Status pattern): standing warnings
 * derived from existing state — job_state, settings, and the cached version
 * check. No live network probes, so this is cheap enough to compute per
 * request. Each issue links to a fix-it section in the README via `docSlug`.
 */

export interface HealthIssue {
  id: string;
  severity: 'warning' | 'error';
  message: string;
  /** README anchor: https://github.com/drohack/Keeparr#<docSlug> */
  docSlug: string;
}

/** Is this job's feature configured (so its failures are worth surfacing)? */
function jobRelevant(id: JobId): boolean {
  switch (id) {
    case 'watch':
      return isWatchAvailable();
    case 'requests':
      return isSeerrConfigured();
    case 'arr':
      return isArrConfigured();
    case 'diskScan':
      // Failures only matter once there are mapped paths to scan.
      return isServerConfigured() && getStorageMappings().length > 0;
    case 'backup':
      return true;
    default:
      // recentlyAdded / library / sizes need the media server.
      return isServerConfigured();
  }
}

/** Expected seconds between successful runs for a schedule (null = manual-only). */
function cadenceSeconds(s: JobSchedule | undefined): number | null {
  if (!s) return null;
  if (s.type === 'interval') return s.minutes > 0 ? s.minutes * 60 : null;
  if (s.type === 'daily') return 24 * 3600;
  return 7 * 24 * 3600; // weekly
}

export async function healthIssues(
  now: number = Math.floor(Date.now() / 1000)
): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];

  // 1. No media server yet — everything else is moot.
  if (!isServerConfigured()) {
    issues.push({
      id: 'server-not-configured',
      severity: 'error',
      message: 'No media server is connected — connect Plex/Jellyfin/Emby in Settings → Connections.',
      docSlug: 'media-server-not-configured',
    });
  }

  const schedules = getJobSchedules();
  for (const job of JOBS) {
    if (!jobRelevant(job.id)) continue;
    const state = getJobState(job.id);

    // 2. A configured feature's job is failing.
    if (state.lastStatus === 'error') {
      issues.push({
        id: `job-${job.id}-failing`,
        severity: 'error',
        message: `The ${job.label} job is failing${state.lastMessage ? `: ${state.lastMessage}` : '.'}`,
        docSlug: 'a-job-is-failing',
      });
      continue; // failing already covers staleness
    }

    // 3. A scheduled job that has run before hasn't succeeded in >2× its cadence.
    const cadence = cadenceSeconds(schedules[job.id]);
    if (cadence != null && state.lastRun && now - state.lastRun > 2 * cadence) {
      issues.push({
        id: `job-${job.id}-stale`,
        severity: 'warning',
        message: `The ${job.label} job hasn't run in over ${Math.floor((now - state.lastRun) / 3600)}h — the scheduler may be stuck (a restart fixes it).`,
        docSlug: 'a-job-is-stale',
      });
    }
  }

  // 4. Libraries managed but no disk paths mapped — capacity/free-space stays blank.
  if (isServerConfigured() && getManagedSections().length > 0 && getStorageMappings().length === 0) {
    issues.push({
      id: 'no-storage-mappings',
      severity: 'warning',
      message: 'No storage mappings configured — Big Picture can\'t show disk capacity or free space.',
      docSlug: 'no-storage-mappings',
    });
  }

  // 5. Backups turned off (manual-only schedule).
  if (cadenceSeconds(schedules.backup) == null) {
    issues.push({
      id: 'backups-disabled',
      severity: 'warning',
      message: 'Scheduled backups are disabled — set the Backup job to daily in Settings → Jobs.',
      docSlug: 'backups-disabled',
    });
  }

  // 6. Update available (cached GitHub releases check; never blocks/throws).
  const v = await getVersionInfo();
  if (v.updateAvailable) {
    issues.push({
      id: 'update-available',
      severity: 'warning',
      message: `Keeparr v${v.latest} is available (you're on v${v.current}).`,
      docSlug: 'updating',
    });
  }

  return issues;
}
