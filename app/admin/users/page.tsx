import { redirect } from 'next/navigation';

// /admin/users redirects to Settings -> Users.
export default function LegacyUsers() {
  redirect('/settings/users');
}
