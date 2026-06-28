import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { statfsSafe } from '@/lib/storage';

export const runtime = 'nodejs';

/** Probe a container path's free/total space (admin Settings "Check" button). */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const path = (new URL(req.url).searchParams.get('path') ?? '').trim();
    if (!path) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    return NextResponse.json(await statfsSafe(path));
  } catch (e) {
    return errorResponse(e);
  }
}
