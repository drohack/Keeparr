import { redirect } from 'next/navigation';

// Users moved under Settings → Users.
export default function LegacyUsers() {
  redirect('/settings/users');
}
