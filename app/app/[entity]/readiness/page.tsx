import { notFound } from 'next/navigation';

import { ReadinessView } from '@/components/views/ReadinessView';
import { getEntity } from '@/lib/config';

export default async function ReadinessPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = getEntity(slug);
  if (!entity) notFound();

  return <ReadinessView entity={entity} />;
}
