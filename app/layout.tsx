import type { Metadata, Viewport } from 'next';
import { getAppTitle } from '@/lib/settings';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: getAppTitle(),
    description: 'Decide what media to keep, and find what can be deleted.',
    // Declaring `icons` overrides Next's file-convention auto-link for
    // app/icon.svg, so the favicon MUST be listed here explicitly or the tab
    // icon disappears.
    icons: {
      icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
      apple: '/icons/apple-touch-icon.png',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
  ],
};

/**
 * Pre-hydration theme init: reads the per-user prefs from localStorage and
 * stamps `data-theme` / `data-cim` on <html> BEFORE first paint, so there is
 * no light/dark flash. Kept dependency-free and tiny; the ThemeMenu component
 * updates the same attributes live afterwards. `suppressHydrationWarning` on
 * <html> because these attributes are intentionally client-decided.
 */
const THEME_INIT = `(function(){try{
var t=localStorage.getItem('keeparr.theme');
if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
document.documentElement.setAttribute('data-theme',t);
if(localStorage.getItem('keeparr.colorImpaired')==='1'){document.documentElement.setAttribute('data-cim','1');}
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
