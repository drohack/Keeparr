import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { clearLogs, recentLogs } from '@/lib/queries';

export const runtime = 'nodejs';

/** Recent app-event logs. Query: ?level=info|warn|error|all */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const level = new URL(req.url).searchParams.get('level') ?? 'all';
    return NextResponse.json({ logs: recentLogs({ level, limit: 300 }) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Clear the log. */
export async function DELETE() {
  try {
    await requireAdmin();
    clearLogs();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
