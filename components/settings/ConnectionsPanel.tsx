'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSize } from '@/lib/format';
import { Card, CardColumns, StatusPill, btnCls, btnGhost, inputCls } from './ui';
import { noAutofill, noAutofillSecret } from '../noAutofill';
import MatchHealthCard from './MatchHealthCard';

/**
 * A unique id for a new instance row. `crypto.randomUUID()` only exists in a
 * secure context (HTTPS or localhost) - on a plain-HTTP LAN deployment it's
 * undefined and would throw, so fall back to getRandomValues (available in
 * insecure contexts) and finally a timestamp+random string.
 */
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through */
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

interface Parts {
  ssl: boolean;
  host: string;
  port: string;
  base: string;
}
interface DiscoveredServer {
  name: string;
  machineId: string;
  owned: boolean;
  accessToken: string | null;
  connections: {
    uri: string;
    local: boolean;
    relay: boolean;
    address: string;
    port: number;
    protocol: string;
  }[];
}
interface JobRow {
  jobId: string;
  lastStatus: string;
  lastMessage: string | null;
}
interface SectionInfo {
  id: string;
  title: string;
  type: string;
  paths?: string[];
}

/**
 * `defaultPort` is prefilled as a REAL value, not a placeholder: a greyed-out
 * "32400" that isn't actually there reads as filled in. Shown as a value, it
 * is obvious and editable.
 */
function parseUrl(url: string | null, defaultPort = ''): Parts {
  if (!url) return { ssl: false, host: '', port: defaultPort, base: '' };
  try {
    const u = new URL(url);
    return {
      ssl: u.protocol === 'https:',
      host: u.hostname,
      // A saved https URL legitimately has no port (reverse proxy); only fill
      // the default for plain http.
      port: u.port || (u.protocol === 'https:' ? '' : defaultPort),
      base: u.pathname.replace(/\/$/, ''),
    };
  } catch {
    return { ssl: false, host: url, port: defaultPort, base: '' };
  }
}
/**
 * Default ports, applied only when the port box is EMPTY and SSL is off.
 *
 * Without one, a blank port means :80, where a NAS web UI answers with an HTML
 * login page; fetchJson then reports "returned text/html ... check the URL/SSL
 * and credentials", blaming the token for a missing port. Left alone over https,
 * where a bare host (:443, reverse proxy) is a normal setup.
 */
const DEFAULT_PORTS: Record<string, string> = {
  plex: '32400',
  jellyfin: '8096',
  emby: '8096',
  tautulli: '8181',
  seerr: '5055',
};

function buildUrl(p: Parts, service?: string): string {
  const host = p.host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!host) return '';
  const proto = p.ssl ? 'https' : 'http';
  const fallback = !p.ssl && service ? DEFAULT_PORTS[service] : undefined;
  const resolved = p.port || fallback || '';
  const port = resolved ? `:${resolved}` : '';
  let base = p.base.trim();
  if (base && !base.startsWith('/')) base = `/${base}`;
  return `${proto}://${host}${port}${base.replace(/\/$/, '')}`;
}

function ServiceFields({
  parts,
  setParts,
  showBase,
  portHint = '32400',
}: {
  parts: Parts;
  setParts: (p: Parts) => void;
  showBase?: boolean;
  /** This service's default port, so a cleared field hints the right one. */
  portHint?: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-400">
        Hostname or IP
        <div className="mt-1 flex items-stretch">
          {/* Shows the protocol that gets prepended (follows the SSL toggle). */}
          <span className="inline-flex items-center rounded-l-md border border-r-0 border-slate-700 bg-slate-900 px-2 font-mono text-xs text-slate-400">
            {parts.ssl ? 'https://' : 'http://'}
          </span>
          <input
            {...noAutofill}
            className="w-40 rounded-r-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            placeholder="192.168.1.10"
            value={parts.host}
            onChange={(e) => setParts({ ...parts, host: e.target.value })}
          />
        </div>
      </label>
      <label className="text-xs text-slate-400">
        Port
        <input
          {...noAutofill}
          className={`${inputCls} mt-1 w-24`}
          placeholder={portHint}
          value={parts.port}
          onChange={(e) => setParts({ ...parts, port: e.target.value })}
        />
      </label>
      {showBase && (
        <label className="text-xs text-slate-400">
          URL base
          <input
            {...noAutofill}
            className={`${inputCls} mt-1 w-32`}
            placeholder="/ (optional)"
            value={parts.base}
            onChange={(e) => setParts({ ...parts, base: e.target.value })}
          />
        </label>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-400 pb-2">
        <input
          {...noAutofill}
          type="checkbox"
          checked={parts.ssl}
          onChange={(e) => setParts({ ...parts, ssl: e.target.checked })}
        />
        Use SSL
      </label>
    </div>
  );
}

interface ArrRow {
  id: string;
  name: string;
  parts: Parts;
  apiKey: string;
  hasKey: boolean;
}

const emptyParts = (port = ''): Parts => ({ ssl: false, host: '', port, base: '' });

/** Repeatable Sonarr/Radarr instances (N per app), each with its own Test. */
function ArrCard({
  title,
  kind,
  rows,
  setRows,
  test,
  onTest,
}: {
  title: string;
  kind: 'sonarr' | 'radarr';
  rows: ArrRow[];
  setRows: (rows: ArrRow[]) => void;
  test: Record<string, string>;
  onTest: (idx: number) => void;
}) {
  const update = (idx: number, patch: Partial<ArrRow>) =>
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const add = () =>
    setRows([
      ...rows,
      {
        id: newId(),
        name: '',
        parts: emptyParts(kind === 'sonarr' ? '8989' : '7878'),
        apiKey: '',
        hasKey: false,
      },
    ]);
  const remove = (idx: number) => setRows(rows.filter((_, i) => i !== idx));

  return (
    <Card
      title={title}
      status={(() => {
        const ready = rows.filter((r) => r.parts.host && (r.hasKey || r.apiKey)).length;
        if (rows.length === 0) return <StatusPill state="off" label="Optional - none added" />;
        return (
          <StatusPill
            state={ready === rows.length ? 'ok' : 'warn'}
            label={`${ready}/${rows.length} configured`}
          />
        );
      })()}
    >
      {rows.length === 0 && (
        <p className="mb-3 text-sm text-slate-400">
          No instances. Add one to pull quality + tags into the Quality view.
        </p>
      )}
      <div className="space-y-4">
        {rows.map((row, idx) => (
          <div key={row.id} className="rounded-lg border border-slate-700 p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                {...noAutofill}
                className={`${inputCls} w-44`}
                placeholder="Name (e.g. 4K, HD)"
                value={row.name}
                onChange={(e) => update(idx, { name: e.target.value })}
              />
              <button
                onClick={() => remove(idx)}
                className={`${btnGhost} ml-auto text-xs`}
                type="button"
              >
                Remove
              </button>
            </div>
            <ServiceFields
              parts={row.parts}
              setParts={(p) => update(idx, { parts: p })}
              showBase
              portHint={kind === 'sonarr' ? '8989' : '7878'}
            />
            <label className="mt-3 mb-1 block text-sm text-slate-400">
              API key {row.hasKey && '(saved - leave blank to keep)'}
            </label>
            <input
              className={`${inputCls} max-w-md`}
              type="password"
              {...noAutofillSecret}
              value={row.apiKey}
              onChange={(e) => update(idx, { apiKey: e.target.value })}
            />
            <div className="mt-3 flex items-center gap-3">
              <button onClick={() => onTest(idx)} className={btnGhost} type="button">
                Test
              </button>
              {test[`${kind}-${row.id}`] && (
                <span className="text-sm text-slate-400">{test[`${kind}-${row.id}`]}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className={`${btnGhost} mt-3`} type="button">
        + Add {kind === 'sonarr' ? 'Sonarr' : 'Radarr'} instance
      </button>
    </Card>
  );
}

type ServerType = 'plex' | 'jellyfin' | 'emby';
const SERVER_LABEL: Record<ServerType, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
};

export default function ConnectionsPanel() {
  const [serverType, setServerType] = useState<ServerType>('plex');
  const [plex, setPlex] = useState<Parts>({ ssl: false, host: '', port: '32400', base: '' });
  const [plexConfigured, setPlexConfigured] = useState(false);
  const [plexName, setPlexName] = useState<string | null>(null);
  const [plexOwnerToken, setPlexOwnerToken] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [scope, setScope] = useState<{
    status?: 'all' | 'limited' | 'unknown';
    allUsers?: boolean;
    message?: string;
    usingOwnerToken?: boolean;
  } | null>(null);
  const [plexOwnerTokenSet, setPlexOwnerTokenSet] = useState(false);
  const [clearOwnerToken, setClearOwnerToken] = useState(false);
  const [taut, setTaut] = useState<Parts>({ ssl: false, host: '', port: '8181', base: '' });
  const [tautKey, setTautKey] = useState('');
  const [tautConfigured, setTautConfigured] = useState(false);
  const [seerr, setSeerr] = useState<Parts>({ ssl: false, host: '', port: '5055', base: '' });
  const [seerrKey, setSeerrKey] = useState('');
  const [seerrConfigured, setSeerrConfigured] = useState(false);
  const [sonarr, setSonarr] = useState<ArrRow[]>([]);
  const [radarr, setRadarr] = useState<ArrRow[]>([]);

  const [servers, setServers] = useState<DiscoveredServer[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [test, setTest] = useState<Record<string, string>>({});
  const [libMsg, setLibMsg] = useState('');
  const [scan, setScan] = useState<JobRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  // Managed libraries + storage (libraries depend on Plex being connected).
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [managed, setManaged] = useState<Set<string>>(new Set());
  const [allManaged, setAllManaged] = useState(true);
  const [storagePaths, setStoragePaths] = useState<Record<string, string>>({});
  const [storageMsg, setStorageMsg] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const d = await fetch('/api/admin/settings').then((r) => r.json());
    setServerType((d.mediaServerType as ServerType) ?? 'plex');
    setPlex(parseUrl(d.plex.baseUrl, '32400'));
    setPlexConfigured(!!d.plex.configured);
    setPlexOwnerTokenSet(!!d.plex.ownerTokenSet);
    setPlexName(
      d.mediaServer?.name ?? d.plex.serverName ?? d.plex.machineId ?? null
    );
    setTaut(parseUrl(d.tautulli.url, '8181'));
    setTautConfigured(!!d.tautulli.configured);
    setSeerr(parseUrl(d.seerr.url, '5055'));
    setSeerrConfigured(!!d.seerr.configured);
    const toRows = (
      arr: { id: string; name: string; url: string; hasKey: boolean }[],
      defaultPort: string
    ) =>
      (arr ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        parts: parseUrl(i.url, defaultPort),
        apiKey: '',
        hasKey: !!i.hasKey,
      }));
    setSonarr(toRows(d.sonarr?.instances, '8989'));
    setRadarr(toRows(d.radarr?.instances, '7878'));
    setSections(d.sections ?? []);
    const mgd: string[] = d.managedSectionIds ?? [];
    setAllManaged(mgd.length === 0);
    setManaged(new Set(mgd));
    const saved = new Map(
      (d.storageMappings ?? []).map((m: { sectionId: string; path: string }) => [
        m.sectionId,
        m.path,
      ])
    );
    const paths: Record<string, string> = {};
    for (const s of d.sections ?? []) {
      paths[s.id] = (saved.get(s.id) as string) ?? s.paths?.[0] ?? '';
    }
    setStoragePaths(paths);
  }, []);

  const isManaged = (id: string) => allManaged || managed.has(id);
  function toggleManaged(id: string, on: boolean) {
    const base = allManaged ? new Set(sections.map((s) => s.id)) : new Set(managed);
    if (on) base.add(id);
    else base.delete(id);
    setAllManaged(false);
    setManaged(base);
  }

  async function checkPath(id: string) {
    const path = (storagePaths[id] ?? '').trim();
    if (!path) return;
    setStorageMsg((m) => ({ ...m, [id]: 'Checking...' }));
    const r = await fetch(
      `/api/admin/storage-check?path=${encodeURIComponent(path)}`
    ).then((x) => x.json());
    setStorageMsg((m) => ({
      ...m,
      [id]: r.ok
        ? `OK - ${formatSize(r.freeBytes)} free of ${formatSize(r.totalBytes)}`
        : `Not accessible (${r.error})`,
    }));
  }

  const loadScan = useCallback(async () => {
    const d = await fetch('/api/admin/jobs').then((r) => r.json());
    const lib = (d.jobs ?? []).find((j: JobRow) => j.jobId === 'library') ?? null;
    setScan(lib);
    return lib as JobRow | null;
  }, []);

  useEffect(() => {
    load();
    loadScan();
  }, [load, loadScan]);

  // Poll the library scan while it's running.
  useEffect(() => {
    if (scan?.lastStatus === 'running' && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const s = await loadScan();
        if (s?.lastStatus !== 'running' && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scan?.lastStatus, loadScan]);

  async function discover() {
    setDiscovering(true);
    setServers(null);
    try {
      const d = await fetch('/api/admin/plex-servers').then((r) => r.json());
      setServers(d.servers ?? []);
    } finally {
      setDiscovering(false);
    }
  }

  async function connectServer(srv: DiscoveredServer, uri: string) {
    setSaving(true);
    setMsg('');
    try {
      const t = await fetch('/api/admin/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'plex', url: uri, token: srv.accessToken }),
      }).then((r) => r.json());
      if (!t.ok) {
        // The reachability test can fail even for a valid server (e.g. a
        // relay/remote URL not routable from the container). Don't silently
        // drop the click - let the admin save it anyway.
        const proceed = window.confirm(
          `Couldn't reach ${uri}\n(${t.message ?? 'connection test failed'}).\n\n` +
            `Save this connection anyway?`
        );
        if (!proceed) {
          setMsg(`Did not connect: ${t.message ?? 'connection test failed'}.`);
          return;
        }
      }
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plexServer: {
            machineId: srv.machineId,
            baseUrl: uri,
            serverToken: srv.accessToken,
            serverName: srv.name,
          },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMsg(`Connected to ${srv.name}.`);
      setServers(null);
      await load();
    } catch {
      // Discovered-servers list stays visible for a retry click.
      setMsg(`Couldn't connect to ${srv.name} - nothing was saved.`);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Re-authenticate with plex.tv to replace the stored ADMIN token. Does not
   * change who you are signed in as here - it only fixes WHICH Plex account
   * Keeparr uses for discovery and shared-user lookups. Sign in as the server
   * OWNER if Discover is not listing your server.
   */
  async function signInToPlex() {
    setSigningIn(true);
    setSignedInAs(null);
    try {
      const r = await fetch('/api/admin/plex-auth', { method: 'POST' }).then((x) => x.json());
      if (!r.authUrl) throw new Error(r.error ?? 'could not start sign-in');
      const popup = window.open(r.authUrl, 'plex-admin-auth', 'width=600,height=700');
      const started = Date.now();
      await new Promise<void>((resolve) => {
        const timer = setInterval(async () => {
          // Give up after 3 minutes rather than polling plex.tv forever if the
          // popup was closed or abandoned.
          if (Date.now() - started > 180_000) {
            clearInterval(timer);
            setSignedInAs('Timed out - try again');
            resolve();
            return;
          }
          const p = await fetch(`/api/admin/plex-auth?id=${r.id}`).then((x) => x.json());
          if (p.status === 'authorized') {
            clearInterval(timer);
            popup?.close();
            setSignedInAs(p.username ?? 'signed in');
            setServers(null); // force a fresh Discover under the new token
            void checkScope();
            resolve();
          }
        }, 2000);
      });
    } catch (e) {
      setSignedInAs(`Failed: ${String(e)}`);
    } finally {
      setSigningIn(false);
    }
  }

  /** "Connected" says nothing about WHOSE history Plex will hand over; this does. */
  const checkScope = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/plex-scope').then((x) => x.json());
      // 'unknown' (Plex unreachable) must not be rendered as a scope verdict.
      setScope(r.applicable && r.configured && r.status !== 'unknown' ? r : null);
    } catch {
      setScope(null); // never block the page on a diagnostic
    }
  }, []);

  useEffect(() => {
    void checkScope();
  }, [checkScope]);

  async function testConn(service: 'plex' | 'plexOwner' | 'tautulli' | 'seerr') {
    const url =
      service === 'plex' || service === 'plexOwner'
        ? buildUrl(plex, 'plex')
        : service === 'tautulli'
          ? buildUrl(taut, 'tautulli')
          : buildUrl(seerr, 'seerr');
    const apiKey = service === 'tautulli' ? tautKey : service === 'seerr' ? seerrKey : undefined;
    // Send the freshly-typed owner token so it can be checked BEFORE saving;
    // blank falls back to the stored one (re-testing a saved connection).
    const token = service === 'plexOwner' ? plexOwnerToken || undefined : undefined;
    if (!url) {
      setTest((m) => ({ ...m, [service]: 'Enter a hostname or IP first.' }));
      return;
    }
    setTest((m) => ({ ...m, [service]: `Testing ${url}...` }));
    const r = await fetch('/api/admin/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, url, apiKey, token }),
    }).then((x) => x.json());
    // Always echo the URL actually used: an unexpected host/port is the most
    // common cause and is invisible if only the upstream error is shown.
    const msg = r.message ?? (r.ok ? 'OK' : 'Failed');
    setTest((m) => ({ ...m, [service]: `${msg}  [${url}]` }));
  }

  async function testArrInstance(kind: 'sonarr' | 'radarr', idx: number) {
    const row = (kind === 'sonarr' ? sonarr : radarr)[idx];
    const key = `${kind}-${row.id}`;
    // Need either a freshly-typed key or a saved one (re-test by instance id).
    if (!row.apiKey && !row.hasKey) {
      setTest((m) => ({ ...m, [key]: 'Enter the API key to test.' }));
      return;
    }
    setTest((m) => ({ ...m, [key]: 'Testing...' }));
    const r = await fetch('/api/admin/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: kind,
        url: buildUrl(row.parts),
        apiKey: row.apiKey || undefined,
        instanceId: row.id,
      }),
    }).then((x) => x.json());
    setTest((m) => ({ ...m, [key]: r.message ?? (r.ok ? 'OK' : 'Failed') }));
  }

  const toInstancesBody = (rows: ArrRow[]) =>
    rows
      .filter((r) => buildUrl(r.parts))
      .map((r) => ({
        id: r.id,
        name: r.name.trim(),
        url: buildUrl(r.parts),
        apiKey: r.apiKey || undefined,
      }));

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const storageMappings = Object.entries(storagePaths)
        .map(([sectionId, path]) => ({ sectionId, path: (path ?? '').trim() }))
        .filter((m) => m.path.length > 0);
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(buildUrl(plex, 'plex') ? { plexBaseUrl: buildUrl(plex, 'plex') } : {}),
          // Blank = keep the stored token; clearing needs an explicit '' which
          // only the "clear it" control sends.
          ...(clearOwnerToken
            ? { plexOwnerToken: '' }
            : plexOwnerToken
              ? { plexOwnerToken }
              : {}),
          tautulli: { url: buildUrl(taut, 'tautulli'), apiKey: tautKey || undefined },
          seerr: { url: buildUrl(seerr, 'seerr'), apiKey: seerrKey || undefined },
          sonarrInstances: toInstancesBody(sonarr),
          radarrInstances: toInstancesBody(radarr),
          managedSectionIds: allManaged ? [] : [...managed],
          storageMappings,
        }),
      });
      if (!res.ok) {
        // Surface the server's explanation (e.g. "that's a different Plex
        // server") instead of a generic failure the admin can't act on.
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? body?.error ?? String(res.status));
      }
      // Only on success - a failed save must keep the typed API keys in their
      // inputs so the admin can just hit Save again instead of re-typing them.
      setTautKey('');
      setSeerrKey('');
      setPlexOwnerToken('');
      setClearOwnerToken(false);
      setMsg('Saved.');
      await load();
    } catch (e) {
      setMsg(`Couldn't save - connections unchanged. ${(e as Error).message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  }

  async function syncLibraries() {
    setLibMsg('Syncing...');
    const r = await fetch('/api/admin/sync-libraries', { method: 'POST' }).then((x) => x.json());
    setLibMsg(r.count != null ? `Found ${r.count} libraries.` : `Failed (${r.error ?? '?'})`);
  }
  async function manualScan() {
    await fetch('/api/admin/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: 'library' }),
    });
    await loadScan();
  }

  return (
    <div>
      <CardColumns>
      <Card
        title={SERVER_LABEL[serverType]}
        status={
          !plexConfigured ? (
            <StatusPill state="warn" label="Not connected" />
          ) : (
            <StatusPill
              // Amber on a limited token: connected but only one person's watch
              // history, which reads as "nobody watched this" everywhere else.
              state={scope == null ? 'ok' : scope.allUsers ? 'ok' : 'warn'}
              label={
                (plexName ? `Connected - ${plexName}` : 'Connected') +
                (scope == null
                  ? ''
                  : scope.allUsers
                    ? ' - all users'
                    : " - 1 account's history only")
              }
            />
          )
        }
      >
        {plexConfigured ? (
          <p className="text-sm text-slate-300 mb-3">
            Connected to <span className="text-white font-medium">{plexName}</span>.
          </p>
        ) : (
          <p className="text-sm text-amber-400 mb-3">
            No {SERVER_LABEL[serverType]} server connected yet.
          </p>
        )}

        {/* Plex connects here (discover or manual). Jellyfin/Emby are connected
            during sign-in (URL at setup + the owner's token), so there's no
            connect form - just library sync below. */}
        {serverType === 'plex' ? (
          <>
            <p className="text-xs text-slate-500 mb-2 max-w-2xl">
              Discovery uses the Plex account Keeparr was first set up with. If your
              server is not listed below, or you need another account&apos;s data
              (only the server OWNER can read everyone&apos;s watch history), sign in
              as that account here - it swaps the stored Plex token without changing
              who you are signed in as in Keeparr.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={signInToPlex} disabled={signingIn} className={btnGhost}>
                {signingIn ? 'Waiting for Plex...' : 'Sign in with Plex'}
              </button>
              <button onClick={discover} disabled={discovering} className={btnGhost}>
                {discovering ? 'Discovering...' : 'Discover servers'}
              </button>
              {signedInAs && (
                <span className="text-sm text-slate-400">Plex account: {signedInAs}</span>
              )}
            </div>
            {servers && servers.length === 0 && (
              <p className="text-sm text-slate-400 mt-3">No servers found.</p>
            )}
            {servers && servers.length > 0 && (
              <div className="mt-4 space-y-3">
                {servers.map((s) => (
                  <div key={s.machineId} className="rounded-lg border border-slate-700 p-3">
                    <div className="font-medium">
                      {s.name} {s.owned && <span className="text-xs text-brand">(owned)</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.connections.map((c) => {
                        // Prefer the raw http://ip:port for LAN-local connections
                        // (reliably reachable from a container); the .plex.direct
                        // uri needs public DNS + HTTPS and often fails here.
                        const connectUrl =
                          c.local && c.address && c.port
                            ? `http://${c.address}:${c.port}`
                            : c.uri;
                        let host = connectUrl;
                        try {
                          host = new URL(connectUrl).host;
                        } catch {
                          /* keep raw */
                        }
                        return (
                          <button
                            key={c.uri}
                            onClick={() => connectServer(s, connectUrl)}
                            disabled={saving}
                            className={`${btnGhost} text-xs`}
                            title={connectUrl}
                          >
                            {c.local ? 'Local' : c.relay ? 'Relay' : 'Remote'}: {host}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="text-sm text-slate-400 mb-2">
                Or set the connection manually:{' '}
                <span className="text-slate-500">
                  Test only checks it - press Save at the bottom to apply.
                </span>
              </p>
              <ServiceFields parts={plex} setParts={setPlex} />
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => testConn('plex')} className={btnGhost} type="button">
                  Test
                </button>
                {test.plex && <span className="text-sm text-slate-400">{test.plex}</span>}
              </div>
            </div>

            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="text-sm text-slate-400 mb-1">
                Server owner token{' '}
                <span className="text-slate-500">(optional, for all-users watch history)</span>
              </p>
              <p className="text-xs text-slate-500 mb-2 max-w-2xl">
                Plex only reveals <em>everyone&apos;s</em> play history to the account that owns
                the server. If Keeparr was connected by a shared user, the watch job silently sees
                just that one person. Paste the owner&apos;s X-Plex-Token here to read the full
                history &mdash; no one has to sign in as them. Find it in Plex Web: play any item
                &rarr; <span className="text-slate-400">Get Info</span> &rarr;{' '}
                <span className="text-slate-400">View XML</span>, then copy{' '}
                <code className="text-slate-400">X-Plex-Token</code> from the URL.
              </p>
              <label className="block text-sm text-slate-400 mb-1">
                Token {plexOwnerTokenSet && '(saved - leave blank to keep)'}
                {plexOwnerTokenSet && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearOwnerToken((v) => !v);
                      setPlexOwnerToken('');
                    }}
                    className="ml-2 text-xs underline text-slate-400 hover:text-slate-200"
                  >
                    {clearOwnerToken ? 'keep it after all' : 'clear it'}
                  </button>
                )}
              </label>
              {clearOwnerToken && (
                <p className="mb-1 text-xs text-amber-400">
                  Will be removed on Save - history falls back to the connected
                  account&apos;s own rows.
                </p>
              )}
              <input
                className={`${inputCls} max-w-md`}
                type="password"
                {...noAutofillSecret}
                value={plexOwnerToken}
                onChange={(e) => setPlexOwnerToken(e.target.value)}
              />
              {scope && (
                <p
                  className={`mt-2 text-xs ${scope.allUsers ? 'text-emerald-400' : 'text-amber-400'}`}
                >
                  {scope.allUsers ? 'Reading all users: ' : 'Limited: '}
                  {scope.message}
                  {!scope.allUsers &&
                    ' - paste the owner token above, or use "Sign in with Plex" as the server owner.'}
                </p>
              )}
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => testConn('plexOwner')} className={btnGhost} type="button">
                  Test
                </button>
                {test.plexOwner && (
                  <span className="text-sm text-slate-400">{test.plexOwner}</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500 mb-1">
            Connected at sign-in. Re-sync libraries below if you add a new one.
          </p>
        )}

        {plexConfigured && (
          <div className="mt-4 border-t border-slate-800 pt-3 flex flex-wrap items-center gap-3">
            <button onClick={syncLibraries} className={btnGhost} type="button">
              Sync libraries
            </button>
            <button
              onClick={manualScan}
              disabled={scan?.lastStatus === 'running'}
              className={btnGhost}
              type="button"
            >
              {scan?.lastStatus === 'running' ? 'Scanning...' : 'Manual library scan'}
            </button>
            {libMsg && <span className="text-sm text-slate-400">{libMsg}</span>}
            {scan && scan.lastStatus !== 'never' && (
              <span className="text-xs text-slate-500">
                Scan: {scan.lastStatus}
                {scan.lastMessage ? ` — ${scan.lastMessage}` : ''}
              </span>
            )}
          </div>
        )}

        {/* Managed libraries + storage are derived from the media server, so they
            live inside its card rather than as standalone connectors. */}
        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-2 text-sm font-semibold text-slate-200">Managed libraries</div>
          {sections.length === 0 ? (
            <p className="text-sm text-slate-400">
              Connect Plex and run a library scan to discover your libraries.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-3">
                Choose which Plex libraries Keeparr tracks. Unticked ones drop on the next scan.
              </p>
              <div className="space-y-2">
                {sections.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      {...noAutofill}
                      type="checkbox"
                      checked={isManaged(s.id)}
                      onChange={(e) => toggleManaged(s.id, e.target.checked)}
                      className="h-4 w-4 accent-brand"
                    />
                    {s.title}
                    <span className="text-xs text-slate-600">({s.type})</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-2 text-sm font-semibold text-slate-200">Storage / free space</div>
          {sections.length === 0 ? (
            <p className="text-sm text-slate-400">Discover libraries first.</p>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-3">
                Map each library to the path where its files live{' '}
                <strong>inside the Keeparr container</strong> (mount your media share
                read-only). Powers the free-space header.
              </p>
              <div className="space-y-3">
                {sections.map((s) => (
                  <div key={s.id}>
                    <label className="block text-sm text-slate-400 mb-1">
                      {s.title}
                      {s.paths && s.paths.length > 0 && (
                        <span className="text-slate-600"> — Plex: {s.paths.join(', ')}</span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <input
                        {...noAutofill}
                        className={`${inputCls} flex-1`}
                        placeholder="/media/..."
                        value={storagePaths[s.id] ?? ''}
                        onChange={(e) =>
                          setStoragePaths((p) => ({ ...p, [s.id]: e.target.value }))
                        }
                      />
                      <button onClick={() => checkPath(s.id)} className={btnGhost} type="button">
                        Check
                      </button>
                    </div>
                    {storageMsg[s.id] && (
                      <p className="mt-1 text-xs text-slate-400">{storageMsg[s.id]}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Tautulli is an ADDITIONAL Plex watch source - Plex's own play history
          is read directly, and the watch job merges the two. Tautulli is still
          worth connecting: it logs partial plays (Plex only records a scrobble)
          and remembers media Plex has pruned. Hidden for Jellyfin/Emby, which
          have native watch data and no Tautulli integration. */}
      {serverType === 'plex' && (
        <Card
          title="Tautulli (extra watch history)"
          status={
            <StatusPill
              state={tautConfigured ? 'ok' : 'off'}
              label={tautConfigured ? 'Configured' : 'Optional - not set up'}
            />
          }
        >
          <ServiceFields parts={taut} setParts={setTaut} showBase portHint="8181" />
          <label className="block text-sm text-slate-400 mt-3 mb-1">
            API key {tautConfigured && '(saved - leave blank to keep)'}
          </label>
          <input
            className={`${inputCls} max-w-md`}
            type="password"
            {...noAutofillSecret}
            value={tautKey}
            onChange={(e) => setTautKey(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => testConn('tautulli')} className={btnGhost} type="button">
              Test
            </button>
            {test.tautulli && <span className="text-sm text-slate-400">{test.tautulli}</span>}
          </div>
        </Card>
      )}

      <Card
        title="Overseerr / Seerr (requests)"
        status={
          <StatusPill
            state={seerrConfigured ? 'ok' : 'off'}
            label={seerrConfigured ? 'Configured' : 'Optional - not set up'}
          />
        }
      >
        <ServiceFields parts={seerr} setParts={setSeerr} showBase portHint="5055" />
        <label className="block text-sm text-slate-400 mt-3 mb-1">
          API key {seerrConfigured && '(saved - leave blank to keep)'}
        </label>
        <input
          className={`${inputCls} max-w-md`}
          type="password"
          {...noAutofillSecret}
          value={seerrKey}
          onChange={(e) => setSeerrKey(e.target.value)}
        />
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => testConn('seerr')} className={btnGhost} type="button">
            Test
          </button>
          {test.seerr && <span className="text-sm text-slate-400">{test.seerr}</span>}
        </div>
      </Card>

      <ArrCard
        title="Sonarr (TV quality + tags)"
        kind="sonarr"
        rows={sonarr}
        setRows={setSonarr}
        test={test}
        onTest={(idx) => testArrInstance('sonarr', idx)}
      />

      <ArrCard
        title="Radarr (movie quality + tags)"
        kind="radarr"
        rows={radarr}
        setRows={setRadarr}
        test={test}
        onTest={(idx) => testArrInstance('radarr', idx)}
      />

      {(sonarr.length > 0 || radarr.length > 0) && <MatchHealthCard />}

      </CardColumns>

      {/* Sticky so Save stays reachable from anywhere on this long
          page. */}
      <div className="sticky bottom-0 -mx-6 mt-2 border-t border-slate-800 bg-app/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className={btnCls}>
            {saving ? 'Saving...' : 'Save connections'}
          </button>
          {msg && <span className="text-sm text-slate-300">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
