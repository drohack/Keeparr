import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { isServerConfigured } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import ProblemsView from '@/components/ProblemsView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ProblemsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.isAdmin) redirect('/');

  return (
    <AppShell>
      <div className="px-6 py-6">
        {!isServerConfigured() ? (
          <p className="text-slate-400">Not set up yet.</p>
        ) : (
          <ProblemsView />
        )}
      </div>
    </AppShell>
  );
}
