'use client';

import { useEffect, useState } from 'react';
import { Card, CardColumns, btnCls, btnGhost, inputCls } from './ui';

export default function GeneralPanel() {
  const [appTitle, setAppTitle] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        setAppTitle(d.appTitle ?? 'Keeparr');
        setAppUrl(d.appUrl ?? '');
        setApiKeyConfigured(!!d.apiKeyConfigured);
      })
      .catch(() => {});
  }, []);

  function generateApiKey() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    setNewApiKey(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
  }

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appTitle,
          appUrl,
          ...(newApiKey ? { apiKey: newApiKey } : {}),
        }),
      });
      setMsg('Saved.');
      if (newApiKey) setApiKeyConfigured(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <CardColumns>
      <Card title="Branding">
        <label className="block text-sm text-slate-400 mb-1">Application title</label>
        <input
          className={`${inputCls} max-w-xs`}
          value={appTitle}
          onChange={(e) => setAppTitle(e.target.value)}
          placeholder="Keeparr"
        />
        <p className="mt-1 text-xs text-slate-500">Shown in the sidebar and browser tab.</p>

        <label className="block text-sm text-slate-400 mb-1 mt-4">Application URL</label>
        <input
          className={inputCls}
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          placeholder="https://keeparr.example.net"
        />
        <p className="mt-1 text-xs text-slate-500">
          Public URL of this app — used to build the Plex sign-in redirect.
        </p>
      </Card>

      <Card title="API access">
        <p className="text-sm text-slate-400 mb-3">
          A key for automation — send it as the <code>X-Api-Key</code> header to read
          stats or trigger refresh jobs without signing in.
        </p>
        {newApiKey ? (
          <div className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
            <div className="text-slate-300 mb-1">
              New key (copy it now — hidden after saving):
            </div>
            <code className="break-all text-brand">{newApiKey}</code>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            {apiKeyConfigured ? 'A key is configured.' : 'No key set.'}
          </p>
        )}
        <div className="mt-3 flex gap-3">
          <button onClick={generateApiKey} className={btnGhost} type="button">
            {apiKeyConfigured || newApiKey ? 'Regenerate' : 'Generate key'}
          </button>
        </div>
      </Card>
      </CardColumns>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className={btnCls}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </div>
  );
}
