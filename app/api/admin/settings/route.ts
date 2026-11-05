import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { getServerIdentity } from '@/lib/plex';
import {
  getPlexBaseUrl,
  getMachineId,
  getServerToken,
  getMediaServerType,
  getServerBaseUrl,
  getServerName,
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
  isPlexOwnerTokenSet,
  readSetting,
  setStorageMappings,
  setJobSchedules,
  setManagedSectionIds,
  setApiKey,
  setAppTitle,
  setAppUrl,
  getApiKey,
  getBackupRetention,
  setBackupRetention,
  writeSetting,
  getSonarrInstances,
  getRadarrInstances,
  setSonarrInstances,
  setRadarrInstances,
  type ArrInstance,
  type JobSchedule,
} from '@/lib/settings';

export const runtime = 'nodejs';

/** Strip apiKey from instances before sending to the client; report hasKey only. */
function sanitizeInstances(instances: ArrInstance[]) {
  return instances.map((i) => ({
    id: i.id,
    name: i.name,
    url: i.url,
    hasKey: !!i.apiKey,
  }));
}

interface IncomingInstance {
  id?: string;
  name?: string;
  url: string;
  apiKey?: string;
}

/** Merge incoming instances with the saved ones: a blank apiKey keeps the
 *  existing key for that id (so the UI never has to round-trip secrets). */
function mergeInstances(
  incoming: IncomingInstance[],
  existing: ArrInstance[]
): ArrInstance[] {
  const byId = new Map(existing.map((i) => [i.id, i]));
  return incoming
    .filter((i) => i && typeof i.url === 'string' && i.url.trim())
    .map((i) => {
      const url = i.url.trim().replace(/\/$/, '');
      const id = (i.id && String(i.id).trim()) || url;
      const prev = byId.get(id);
      return {
        id,
        name: String(i.name ?? '').trim(),
        url,
        apiKey: (i.apiKey && String(i.apiKey).trim()) || prev?.apiKey || '',
      };
    });
}

/** Current settings. Service secrets are reported as booleans, never returned;
 *  the automation `apiKey` is the one exception (masked+copyable in the UI). */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({
      mediaServerType: getMediaServerType(),
      mediaServer: {
        type: getMediaServerType(),
        configured: isServerConfigured(),
        url: getServerBaseUrl(),
        name: getServerName(),
      },
      plex: {
        configured: isServerConfigured(),
        baseUrl: getPlexBaseUrl(),
        machineId: getMachineId(),
        serverName: readSetting('plex_server_name'),
        // Presence only - the token itself is never returned.
        ownerTokenSet: isPlexOwnerTokenSet(),
      },
      tautulli: {
        url: getTautulliUrl(),
        configured: isTautulliConfigured(),
      },
      seerr: {
        url: getSeerrUrl(),
        configured: isSeerrConfigured(),
      },
      sonarr: { instances: sanitizeInstances(getSonarrInstances()) },
      radarr: { instances: sanitizeInstances(getRadarrInstances()) },
      jobSchedules: getJobSchedules(),
      sections: getPlexSections(),
      managedSectionIds: getManagedSectionIds(),
      storageMappings: getStorageMappings(),
      appTitle: getAppTitle(),
      appUrl: getAppUrl(),
      apiKeyConfigured: isApiKeyConfigured(),
      // The automation key IS returned (admin-only route) so the UI can show a
      // masked copy-able field, Servarr-style. Service secrets stay hidden.
      apiKey: getApiKey() ?? '',
      backupRetention: getBackupRetention(),
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
  sonarrInstances?: IncomingInstance[];
  radarrInstances?: IncomingInstance[];
  jobSchedules?: Record<string, JobSchedule>;
  storageMappings?: { sectionId: string; path: string }[];
  managedSectionIds?: string[];
  /** Manual override of the Plex base URL (host/port/SSL all in one). */
  plexBaseUrl?: string;
  /** Optional Plex server-owner token (all-users watch history). '' clears it. */
  plexOwnerToken?: string;
  appTitle?: string;
  appUrl?: string;
  /** New API key value, or '' to clear it. */
  apiKey?: string;
  /** How many backup files to keep (oldest pruned first). */
  backupRetention?: number;
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

    if (Array.isArray(body.sonarrInstances)) {
      setSonarrInstances(
        mergeInstances(body.sonarrInstances, getSonarrInstances())
      );
    }
    if (Array.isArray(body.radarrInstances)) {
      setRadarrInstances(
        mergeInstances(body.radarrInstances, getRadarrInstances())
      );
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

    if (typeof body.plexOwnerToken === 'string') {
      // Blank means "clear it"; the UI sends undefined to keep the saved value.
      writeSetting('plex_owner_token', body.plexOwnerToken.trim());
    }
    if (typeof body.plexBaseUrl === 'string' && body.plexBaseUrl.trim()) {
      const nextUrl = body.plexBaseUrl.trim();
      // Changing the URL by hand must not silently point Keeparr at a DIFFERENT
      // server: `plex_server_token` and `plex_machine_id` are issued per server,
      // so they would not work there, and the manual path never replaces them.
      // That would leave a half-configured install with no warning. Switching
      // servers has to go through Discover & connect, which stores all three.
      // A same-server address change (the normal case) is allowed, and so is an
      // unreachable target - fixing the URL of a server that is currently down
      // is legitimate, so we only block on a POSITIVE mismatch.
      const storedMachine = getMachineId();
      const token = getServerToken();
      if (nextUrl !== getPlexBaseUrl() && storedMachine && token) {
        try {
          const id = await getServerIdentity(nextUrl, token);
          if (id.machineIdentifier && id.machineIdentifier !== storedMachine) {
            return NextResponse.json(
              {
                error: 'different_server',
                message:
                  `That address is a different Plex server (${id.friendlyName || id.machineIdentifier}). ` +
                  `Use "Discover servers" and connect to it, so its token and id are stored too.`,
              },
              { status: 400 }
            );
          }
        } catch {
          // Unreachable: allow the save (see above).
        }
      }
      writeSetting('plex_base_url', nextUrl);
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

    if (typeof body.backupRetention === 'number' && body.backupRetention >= 1) {
      setBackupRetention(body.backupRetention);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
