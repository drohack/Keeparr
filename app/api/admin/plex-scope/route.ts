import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { plexHistoryScope } from '@/lib/plex';
import { errorResponse } from '@/lib/route-helpers';
import {
  getMediaServerType,
  getPlexBaseUrl,
  getPlexOwnerToken,
  getServerToken,
} from '@/lib/settings';

export const runtime = 'nodejs';

/**
 * Can Keeparr read EVERY account's play history, or only the connected user's?
 *
 * "Connected" is not the useful question for Plex. A shared user's token
 * connects fine, scans libraries fine, and then silently returns only its own
 * watch history - so "never watched by anyone" quietly means "never watched by
 * one person".
 *
 * Checks the token history ACTUALLY uses (the owner token when set, otherwise
 * the server token) by counting distinct accounts in a single page of history.
 * It reads one page, so the Connections page runs it on load.
 */
export async function GET() {
  try {
    await requireAdmin();
    if (getMediaServerType() !== 'plex') {
      // Jellyfin/Emby report per-user data natively; there is no owner concept.
      return NextResponse.json({ applicable: false });
    }
    const baseUrl = getPlexBaseUrl();
    const ownerToken = getPlexOwnerToken();
    const token = ownerToken || getServerToken();
    if (!baseUrl || !token) {
      return NextResponse.json({ applicable: true, configured: false });
    }
    const r = await plexHistoryScope(baseUrl, token);
    return NextResponse.json({
      applicable: true,
      configured: true,
      status: r.status, // all | limited | unknown
      allUsers: r.ok,
      message: r.message,
      usingOwnerToken: !!ownerToken,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
