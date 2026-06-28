import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getSharedUsers } from '@/lib/plex';
import { upsertUser } from '@/lib/queries';
import { getAdminToken, getMachineId } from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Import the Plex server's shared users into the users table so an admin can
 * pre-enable them (useful when open sign-in is off). Existing rows are updated
 * (their admin/enabled flags are preserved); new rows default to enabled.
 */
export async function POST() {
  try {
    await requireAdmin();
    const adminToken = getAdminToken();
    const machineId = getMachineId();
    if (!adminToken || !machineId) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 });
    }
    const shared = await getSharedUsers(adminToken, machineId);
    for (const u of shared) {
      upsertUser({
        plexUserId: u.id,
        username: u.username,
        email: u.email,
        thumb: u.thumb,
        isAdmin: false,
      });
    }
    return NextResponse.json({ imported: shared.length });
  } catch (e) {
    return errorResponse(e);
  }
}
