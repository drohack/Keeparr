import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getServerIdentity } from '@/lib/plex';
import { getServerToken } from '@/lib/settings';
import { testTautulli } from '@/lib/tautulli';
import { testSeerr } from '@/lib/seerr';

export const runtime = 'nodejs';

interface Body {
  service: 'plex' | 'tautulli' | 'seerr';
  url: string;
  apiKey?: string;
  token?: string;
}

/** Probe a service's reachability with the provided (unsaved) credentials. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as Body;

    if (body.service === 'plex') {
      try {
        // Fall back to the saved server token (e.g. when re-testing a manual URL).
        const token = body.token || getServerToken() || '';
        const id = await getServerIdentity(body.url, token);
        return NextResponse.json({
          ok: true,
          message: `Connected to ${id.friendlyName}`,
        });
      } catch (e) {
        return NextResponse.json({ ok: false, message: String(e) });
      }
    }

    if (body.service === 'tautulli') {
      const r = await testTautulli(body.url, body.apiKey ?? '');
      return NextResponse.json(r);
    }

    if (body.service === 'seerr') {
      const r = await testSeerr(body.url, body.apiKey ?? '');
      return NextResponse.json(r);
    }

    return NextResponse.json({ error: 'bad_service' }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}
