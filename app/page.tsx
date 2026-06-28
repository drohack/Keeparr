import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getManagedSections, isServerConfigured } from '@/lib/settings';
import { sectionSizeSummary } from '@/lib/queries';
import AppShell from '@/components/AppShell';
import KeepView from '@/components/KeepView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const configured = isServerConfigured();

  // Feed filters are the user's actual Plex libraries, biggest first.
  const sizes = new Map(sectionSizeSummary().map((s) => [s.section_id, s.bytes]));
  const libraries = getManagedSections()
    .map((s) => ({ id: s.id, title: s.title, sizeBytes: sizes.get(s.id) ?? 0 }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  return (
    <AppShell>
      {!configured ? (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <div className="rounded-xl border border-slate-800 bg-panel p-8 text-center">
            <h1 className="text-xl font-semibold mb-2">Keeparr isn’t set up yet</h1>
            {user.isAdmin ? (
              <p className="text-slate-400">
                Connect your Plex server and run a scan in{' '}
                <Link href="/settings/connections" className="text-brand underline">
                  Settings
                </Link>
                .
              </p>
            ) : (
              <p className="text-slate-400">
                The owner still needs to finish setting things up. Check back
                soon.
              </p>
            )}
          </div>
        </div>
      ) : (
        <KeepView libraries={libraries} />
      )}
    </AppShell>
  );
}
