import { notFound } from 'next/navigation';

import { MatchingView } from '@/components/views/MatchingView';
import { getEntity } from '@/lib/config';

export default async function MatchingPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = getEntity(slug);
  if (!entity) notFound();

  return <MatchingView entity={entity} />;
}
