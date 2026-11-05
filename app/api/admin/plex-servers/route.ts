import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getResources, usefulServerConnections } from '@/lib/plex';
import { getAdminToken } from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Discover Plex servers the admin can connect, using their stored account
 * token. Returns one entry per server with its candidate connection URIs -
 * Docker-bridge addresses filtered out, best (LAN) connection first.
 */
export async function GET() {
  try {
    await requireAdmin();
    const adminToken = getAdminToken();
    if (!adminToken) {
      return NextResponse.json({ error: 'no_admin_token' }, { status: 400 });
    }
    const resources = await getResources(adminToken);
    const servers = resources.map((r) => ({
      name: r.name,
      machineId: r.clientIdentifier,
      owned: r.owned,
      accessToken: r.accessToken,
      connections: usefulServerConnections(r.connections),
    }));
    return NextResponse.json({ servers });
  } catch (e) {
    return errorResponse(e);
  }
}
