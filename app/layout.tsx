import type { Metadata, Viewport } from 'next';
import { getAppTitle } from '@/lib/settings';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: getAppTitle(),
    description: 'Decide what media to keep, and find what can be deleted.',
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
