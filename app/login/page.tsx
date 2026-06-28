'use client';

import { Suspense, useCallback, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Phase = 'idle' | 'waiting' | 'denied' | 'error';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const [phase, setPhase] = useState<Phase>('idle');
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

      // Open the Plex auth popup. (Popups must be opened in the click handler.)
      const popup = window.open(
        authUrl,
        'plex-auth',
        'width=600,height=700'
      );

      stopPolling();
      pollTimer.current = setInterval(async () => {
        const r = await fetch(`/api/auth/plex/check?id=${id}`);
        const data = await r.json();
        if (data.status === 'pending') return;
        stopPolling();
        popup?.close();
        if (data.status === 'authorized') {
          router.push(data.needsSetup ? '/admin/settings' : next);
          router.refresh();
        } else if (data.status === 'denied') {
          setPhase('denied');
        } else {
          setPhase('error');
        }
      }, 2000);
    } catch {
      stopPolling();
      setPhase('error');
    }
  }, [next, router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-4xl font-bold text-brand mb-2">Keeparr</h1>
        <p className="text-slate-400 mb-8">
          Sign in with Plex to mark what to keep.
        </p>

        <button
          onClick={startLogin}
          disabled={phase === 'waiting'}
          className="w-full rounded-lg bg-brand hover:bg-brand-light disabled:opacity-60 text-slate-900 font-semibold py-3 transition-colors"
        >
          {phase === 'waiting' ? 'Waiting for Plex…' : 'Sign in with Plex'}
        </button>

        {phase === 'waiting' && (
          <p className="mt-4 text-sm text-slate-500">
            Complete the login in the Plex window, then come back here.
          </p>
        )}
        {phase === 'denied' && (
          <p className="mt-4 text-sm text-red-400">
            That Plex account doesn&apos;t have access to this server. Ask the
            owner to share a library with you, then try again.
          </p>
        )}
        {phase === 'error' && (
          <p className="mt-4 text-sm text-red-400">
            Something went wrong talking to Plex. Please try again.
          </p>
        )}
      </div>
    </main>
  );
}
