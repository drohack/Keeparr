import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import AppShell from '@/components/AppShell';
import { SettingsLayout } from '@/components/settings/ui';
import AboutPanel from '@/components/settings/AboutPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.isAdmin) redirect('/');
  return (
    <AppShell>
      <SettingsLayout>
        <AboutPanel />
      </SettingsLayout>
    </AppShell>
  );
}
