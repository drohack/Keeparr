import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getAppTitle, isServerConfigured } from '@/lib/settings';

export const runtime = 'nodejs';

/** Current session user + app title + whether the server has been set up yet. */
export async function GET() {
  const user = await getSessionUser();
  const appTitle = getAppTitle();
  if (!user) return NextResponse.json({ user: null, appTitle });
  return NextResponse.json({ user, appTitle, serverConfigured: isServerConfigured() });
}
