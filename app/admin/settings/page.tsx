import { redirect } from 'next/navigation';

// /admin/settings redirects to the Settings tabs.
export default function LegacySettings() {
  redirect('/settings/general');
}
