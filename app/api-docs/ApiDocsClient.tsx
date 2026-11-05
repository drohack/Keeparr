'use client';

import dynamic from 'next/dynamic';
import '@scalar/api-reference-react/style.css';

// Scalar is heavy - load it client-side only, code-split to this route.
const ApiReferenceReact = dynamic(
  () => import('@scalar/api-reference-react').then((m) => m.ApiReferenceReact),
  { ssr: false, loading: () => <p className="p-6 text-sm text-slate-400">Loading API docs…</p> }
);

export default function ApiDocsClient() {
  return (
    <ApiReferenceReact
      configuration={{
        url: '/api/openapi.json',
        darkMode: true,
        hideDarkModeToggle: true,
        // Match Keeparr's dark chrome.
        theme: 'kepler',
      }}
    />
  );
}
