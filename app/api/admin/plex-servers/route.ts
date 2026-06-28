import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getResources } from '@/lib/plex';
import { getAdminToken } from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Discover Plex servers the admin can connect, using their stored account
 * token. Returns one entry per server with its candidate connection URIs.
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
      // Prefer local/direct URIs first, relays last.
      connections: r.connections
        .slice()
        .sort((a, b) => Number(a.relay) - Number(b.relay))
        .map((c) => ({ uri: c.uri, local: c.local, relay: c.relay })),
    }));
    return NextResponse.json({ servers });
  } catch (e) {
    return errorResponse(e);
  }
}
