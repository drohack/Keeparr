import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import {
  getPlexBaseUrl,
  getMachineId,
  getPlexSections,
  getSeerrUrl,
  getStorageMappings,
  getJobSchedules,
  getManagedSectionIds,
  getAppTitle,
  getAppUrl,
  getTautulliUrl,
  isApiKeyConfigured,
  isSeerrConfigured,
  isServerConfigured,
  isTautulliConfigured,
  readSetting,
  setStorageMappings,
  setJobSchedules,
  setManagedSectionIds,
  setApiKey,
  setAppTitle,
  setAppUrl,
  writeSetting,
  type JobSchedule,
} from '@/lib/settings';

export const runtime = 'nodejs';

/** Current settings (secrets are reported as booleans, never returned). */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({
      plex: {
        configured: isServerConfigured(),
        baseUrl: getPlexBaseUrl(),
        machineId: getMachineId(),
        serverName: readSetting('plex_server_name'),
      },
      tautulli: {
        url: getTautulliUrl(),
        configured: isTautulliConfigured(),
      },
      seerr: {
        url: getSeerrUrl(),
        configured: isSeerrConfigured(),
      },
      jobSchedules: getJobSchedules(),
      sections: getPlexSections(),
      managedSectionIds: getManagedSectionIds(),
      storageMappings: getStorageMappings(),
      appTitle: getAppTitle(),
      appUrl: getAppUrl(),
      apiKeyConfigured: isApiKeyConfigured(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

interface PutBody {
  plexServer?: {
    machineId: string;
    baseUrl: string;
    serverToken: string;
    serverName?: string;
  };
  tautulli?: { url: string; apiKey?: string };
  seerr?: { url: string; apiKey?: string };
  jobSchedules?: Record<string, JobSchedule>;
  storageMappings?: { sectionId: string; path: string }[];
  managedSectionIds?: string[];
  /** Manual override of the Plex base URL (host/port/SSL all in one). */
  plexBaseUrl?: string;
  appTitle?: string;
  appUrl?: string;
  /** New API key value, or '' to clear it. */
  apiKey?: string;
}

/** Update settings. Only provided fields are changed. */
export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as PutBody;

    if (body.plexServer) {
      const p = body.plexServer;
      writeSetting('plex_machine_id', p.machineId);
      writeSetting('plex_base_url', p.baseUrl);
      writeSetting('plex_server_token', p.serverToken);
      if (p.serverName) writeSetting('plex_server_name', p.serverName);
    }

    if (body.tautulli) {
      writeSetting('tautulli_url', body.tautulli.url);
      // Empty/absent apiKey keeps the existing one (so the UI can omit it).
      if (body.tautulli.apiKey) {
        writeSetting('tautulli_api_key', body.tautulli.apiKey);
      }
    }

    if (body.seerr) {
      writeSetting('seerr_url', body.seerr.url);
      if (body.seerr.apiKey) writeSetting('seerr_api_key', body.seerr.apiKey);
    }

    if (body.jobSchedules && typeof body.jobSchedules === 'object') {
      setJobSchedules(body.jobSchedules);
    }

    if (Array.isArray(body.storageMappings)) {
      setStorageMappings(
        body.storageMappings
          .filter((m) => m && typeof m.sectionId === 'string')
          .map((m) => ({ sectionId: m.sectionId, path: String(m.path ?? '').trim() }))
          .filter((m) => m.path.length > 0)
      );
    }

    if (Array.isArray(body.managedSectionIds)) {
      setManagedSectionIds(body.managedSectionIds.map(String));
    }

    if (typeof body.plexBaseUrl === 'string' && body.plexBaseUrl.trim()) {
      writeSetting('plex_base_url', body.plexBaseUrl.trim());
    }

    if (typeof body.appTitle === 'string') {
      setAppTitle(body.appTitle);
    }

    if (typeof body.appUrl === 'string') {
      setAppUrl(body.appUrl);
    }

    if (typeof body.apiKey === 'string') {
      setApiKey(body.apiKey.trim());
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
