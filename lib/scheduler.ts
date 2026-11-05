import { isServerConfigured } from './settings';
import { dueJobs, runJob } from './jobs';
import { logEvent, resetInterruptedJobs } from './queries';

let started = false;

/**
 * Background scheduler. Every minute it asks which refresh jobs are due (per
 * their configured interval) and fires each one (single-flight, fire-and-forget).
 * Idempotent: only one scheduler per process.
 */
export function startScheduler(): void {
  if (started) return;
  started = true;

  // A job killed mid-run (restart/OOM) left its 'running' row behind, which
  // gates it out of the scheduler AND manual runs forever - clear it now.
  try {
    const n = resetInterruptedJobs();
    if (n > 0) {
      logEvent('warn', 'scheduler', `Reset ${n} job(s) stuck in 'running' after restart.`);
    }
  } catch {
    /* never block boot */
  }

  const tick = () => {
    try {
      if (!isServerConfigured()) return;
      for (const id of dueJobs()) {
        void runJob(id).catch(() => {
          /* error recorded in job_state */
        });
      }
    } catch {
      /* never let the scheduler crash the process */
    }
  };

  // First check shortly after boot, then every minute.
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}
