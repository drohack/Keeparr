import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import pkg from '../../../package.json';

export const runtime = 'nodejs';

/** Build/version info for the About page. */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ name: 'Keeparr', version: pkg.version });
  } catch (e) {
    return errorResponse(e);
  }
}
