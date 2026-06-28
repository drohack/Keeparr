import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import AppShell from '@/components/AppShell';
import SearchResults from '@/components/SearchResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { q } = await searchParams;
  const query = (q ?? '').trim();

  return (
    <AppShell>
      <div className="px-6 py-6">
        <h1 className="text-2xl font-bold mb-6">
          {query ? `Results for “${query}”` : 'Search'}
        </h1>
        <SearchResults query={query} />
      </div>
    </AppShell>
  );
}
