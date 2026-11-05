import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { arrFacets } from '@/lib/queries';

export const runtime = 'nodejs';

/** Distinct Sonarr/Radarr instances / tags / qualities - for the Browse filters. */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(arrFacets());
  } catch (e) {
    return errorResponse(e);
  }
}
