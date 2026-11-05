'use client';

import { useEffect, useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { Card, CardColumns, btnCls, btnGhost, inputCls } from './ui';

export default function GeneralPanel() {
  const [appTitle, setAppTitle] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyDirty, setKeyDirty] = useState(false); // regenerated but not saved yet
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        setAppTitle(d.appTitle ?? 'Keeparr');
        setAppUrl(d.appUrl ?? '');
        setApiKey(d.apiKey ?? '');
      })
      .catch(() => {});
  }, []);

  function generateApiKey() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    setApiKey(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
    setKeyDirty(true);
    setShowKey(true); // a fresh key is worth seeing
  }

  async function copyApiKey() {
    if (await copyText(apiKey)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    // On failure the field stays visible for manual copy.
  }

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appTitle,
          appUrl,
          ...(keyDirty ? { apiKey } : {}),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMsg('Saved.');
      // Only on success: a failed PUT means a regenerated key is NOT active,
      // so the "Save settings to activate it" warning must stay.
      setKeyDirty(false);
    } catch {
      setMsg("Couldn't save - settings unchanged.");
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
        {apiKey ? (
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} font-mono text-xs`}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button
              onClick={() => setShowKey((s) => !s)}
              className={`${btnGhost} shrink-0`}
              type="button"
              title={showKey ? 'Hide' : 'Show'}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button
              onClick={copyApiKey}
              className={`${btnGhost} shrink-0`}
              type="button"
              title="Copy to clipboard"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No key set.</p>
        )}
        {keyDirty && (
          <p className="mt-2 text-xs text-amber-400">
            New key — Save settings to activate it (the old key stops working).
          </p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button onClick={generateApiKey} className={btnGhost} type="button">
            {apiKey ? 'Regenerate' : 'Generate key'}
          </button>
          <a
            href="/api-docs"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-400 underline hover:text-white"
          >
            API docs →
          </a>
        </div>
      </Card>
      </CardColumns>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className={btnCls}>
          {saving ? 'Saving...' : 'Save settings'}
        </button>
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </div>
  );
}
