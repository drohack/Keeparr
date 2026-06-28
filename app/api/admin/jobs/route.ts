import { NextResponse } from 'next/server';
import { requireAdminOrApiKey } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { JOBS, isJobId, jobStates, runJob } from '@/lib/jobs';
import { recentJobRuns } from '@/lib/queries';
import { isServerConfigured } from '@/lib/settings';

export const runtime = 'nodejs';

/** Status of every scheduled job + recent run history (admin or API key). */
export async function GET(req: Request) {
  try {
    await requireAdminOrApiKey(req);
    return NextResponse.json({ jobs: jobStates(), recent: recentJobRuns(50) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Trigger a job. Body: { job: 'library'|'sizes'|'watch'|'requests'|'all' }.
 * Fire-and-forget; single-flight per job.
 */
export async function POST(req: Request) {
  try {
    await requireAdminOrApiKey(req);
    if (!isServerConfigured()) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 });
    }
    const { job } = (await req.json()) as { job?: string };
    if (job === 'all') {
      for (const j of JOBS) void runJob(j.id).catch(() => {});
      return NextResponse.json({ started: true });
    }
    if (!job || !isJobId(job)) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    // Fire-and-forget: the standalone Node server runs it to completion.
    void runJob(job).catch(() => {
      /* job_state records the error */
    });
    return NextResponse.json({ started: true });
  } catch (e) {
    return errorResponse(e);
  }
}
