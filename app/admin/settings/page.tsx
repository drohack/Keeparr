import { redirect } from 'next/navigation';

// Settings moved to /settings/* sub-tabs.
export default function LegacySettings() {
  redirect('/settings/general');
}
