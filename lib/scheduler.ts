import { isServerConfigured } from './settings';
import { dueJobs, runJob } from './jobs';

let started = false;

/**
 * Background scheduler. Every minute it asks which refresh jobs are due (per
 * their configured interval) and fires each one (single-flight, fire-and-forget).
 * Idempotent: only one scheduler per process.
 */
export function startScheduler(): void {
  if (started) return;
  started = true;

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
