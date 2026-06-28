import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import AppShell from '@/components/AppShell';
import { SettingsLayout } from '@/components/settings/ui';
import UsersManager from '@/components/UsersManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.isAdmin) redirect('/');
  return (
    <AppShell>
      <SettingsLayout>
        <p className="text-sm text-slate-400 mb-4">
          Everyone signs in with their Plex account. Grant admin to let someone else manage
          settings; the Owner is always an admin and can’t be disabled.
        </p>
        <UsersManager />
      </SettingsLayout>
    </AppShell>
  );
}
