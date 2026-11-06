'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MediaServerType } from '@/lib/settings';

type Step = 'choose' | 'connect' | 'login';
type Phase = 'idle' | 'waiting' | 'denied' | 'error';

const LABEL: Record<MediaServerType, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
};

export default function LoginClient({
  type,
  chooserNeeded,
  configured,
  serverName,
}: {
  type: MediaServerType;
  chooserNeeded: boolean;
  configured: boolean;
  serverName: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [chosen, setChosen] = useState<MediaServerType>(type);
  const [step, setStep] = useState<Step>(
    chooserNeeded ? 'choose' : type === 'plex' ? 'login' : 'login'
  );

  function goAfterAuth(needsSetup: boolean) {
    router.push(needsSetup ? '/admin/settings' : next);
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-4xl font-bold text-brand mb-2">Keeparr</h1>

        {step === 'choose' && (
          <ChooseServer
            onPlex={async () => {
              await fetch('/api/auth/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'plex' }),
              }).catch(() => {});
              setChosen('plex');
              setStep('login');
            }}
            onPick={(t) => {
              setChosen(t);
              setStep('connect');
            }}
          />
        )}

        {step === 'connect' && (
          <ConnectServer
            kind={chosen as 'jellyfin' | 'emby'}
            onConnected={() => setStep('login')}
            onBack={() => setStep('choose')}
          />
        )}

        {step === 'login' &&
          (chosen === 'plex' ? (
            <PlexLogin onAuthorized={goAfterAuth} />
          ) : (
            <CredentialsLogin
              kind={chosen as 'jellyfin' | 'emby'}
              serverName={serverName}
              onAuthorized={goAfterAuth}
            />
          ))}
      </div>
    </main>
  );
}

function ChooseServer({
  onPlex,
  onPick,
}: {
  onPlex: () => void;
  onPick: (t: MediaServerType) => void;
}) {
  return (
    <>
      <p className="text-slate-400 mb-8">Which media server do you use?</p>
      <div className="flex flex-col gap-3">
        <button
          onClick={onPlex}
          className="w-full rounded-lg bg-brand hover:bg-brand-light text-ink font-semibold py-3 transition-colors"
        >
          Plex
        </button>
        <button
          onClick={() => onPick('jellyfin')}
          className="w-full rounded-lg border border-slate-600 hover:border-slate-400 py-3 transition-colors"
        >
          Jellyfin
        </button>
        <button
          onClick={() => onPick('emby')}
          className="w-full rounded-lg border border-slate-600 hover:border-slate-400 py-3 transition-colors"
        >
          Emby
        </button>
      </div>
      <p className="mt-6 text-xs text-slate-500">
        You can only choose this once during setup.
      </p>
    </>
  );
}

function ConnectServer({
  kind,
  onConnected,
  onBack,
}: {
  kind: 'jellyfin' | 'emby';
  onConnected: () => void;
  onBack: () => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, url }),
      });
      const d = await r.json();
      if (r.ok && d.ok) onConnected();
      else setErr(d.message || 'Could not reach that server.');
    } catch {
      setErr('Could not reach that server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-slate-400 mb-6">
        Enter your {LABEL[kind]} server address.
      </p>
      <input
        autoFocus
        className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-brand"
        placeholder="http://192.168.1.10:8096"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy || !url.trim()}
        className="w-full rounded-lg bg-brand hover:bg-brand-light disabled:opacity-60 text-ink font-semibold py-3 transition-colors"
      >
        {busy ? 'Connecting...' : 'Continue'}
      </button>
      {err && <p className="mt-4 text-sm text-red-400">{err}</p>}
      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-sm text-slate-500 hover:text-slate-300"
      >
        &larr; Back
      </button>
    </form>
  );
}

function CredentialsLogin({
  kind,
  serverName,
  onAuthorized,
}: {
  kind: 'jellyfin' | 'emby';
  serverName: string;
  onAuthorized: (needsSetup: boolean) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (d.status === 'authorized') onAuthorized(!!d.needsSetup);
      else setErr(d.message || 'Invalid username or password.');
    } catch {
      setErr('Something went wrong signing in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-slate-400 mb-6">
        Sign in with your {serverName || LABEL[kind]} account.
      </p>
      <input
        autoFocus
        className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-brand"
        placeholder="Username"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm mb-3 focus:outline-none focus:border-brand"
        placeholder="Password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy || !username}
        className="w-full rounded-lg bg-brand hover:bg-brand-light disabled:opacity-60 text-ink font-semibold py-3 transition-colors"
      >
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
      {err && <p className="mt-4 text-sm text-red-400">{err}</p>}
    </form>
  );
}

function PlexLogin({
  onAuthorized,
}: {
  onAuthorized: (needsSetup: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [denyReason, setDenyReason] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const startLogin = useCallback(async () => {
    setPhase('waiting');
    try {
      const res = await fetch('/api/auth/plex/pin', { method: 'POST' });
      if (!res.ok) throw new Error('pin failed');
      const { id, authUrl } = await res.json();
      const popup = window.open(authUrl, 'plex-auth', 'width=600,height=700');

      stopPolling();
      pollTimer.current = setInterval(async () => {
        const r = await fetch(`/api/auth/plex/check?id=${id}`);
        const data = await r.json();
        if (data.status === 'pending') return;
        stopPolling();
        popup?.close();
        if (data.status === 'authorized') onAuthorized(!!data.needsSetup);
        else if (data.status === 'denied') {
          setDenyReason(typeof data.reason === 'string' ? data.reason : null);
          setPhase('denied');
        }
        else setPhase('error');
      }, 2000);
    } catch {
      stopPolling();
      setPhase('error');
    }
  }, [onAuthorized]);

  return (
    <>
      <p className="text-slate-400 mb-8">Sign in with Plex to mark what to keep.</p>
      <button
        onClick={startLogin}
        disabled={phase === 'waiting'}
        className="w-full rounded-lg bg-brand hover:bg-brand-light disabled:opacity-60 text-ink font-semibold py-3 transition-colors"
      >
        {phase === 'waiting' ? 'Waiting for Plex...' : 'Sign in with Plex'}
      </button>
      {phase === 'waiting' && (
        <p className="mt-4 text-sm text-slate-500">
          Complete the login in the Plex window, then come back here.
        </p>
      )}
      {phase === 'denied' && (
        <p className="mt-4 text-sm text-red-400">
          {denyReason === 'not_enabled' ? (
            <>
              Your account hasn&apos;t been enabled yet. Ask an admin to enable it
              in Keeparr, then try again.
            </>
          ) : denyReason === 'setup_unfinished' ? (
            <>
              Keeparr isn&apos;t set up yet. Try again once the admin has connected
              a server.
            </>
          ) : (
            <>
              That Plex account doesn&apos;t have access to this server. Ask the
              owner to share a library with you, then try again.
            </>
          )}
        </p>
      )}
      {phase === 'error' && (
        <p className="mt-4 text-sm text-red-400">
          Something went wrong talking to Plex. Please try again.
        </p>
      )}
    </>
  );
}
