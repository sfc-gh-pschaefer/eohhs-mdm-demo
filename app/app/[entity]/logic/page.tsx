import { notFound } from 'next/navigation';

import { RulesView } from '@/components/views/RulesView';
import { getEntity } from '@/lib/config';

export default async function RulesPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = getEntity(slug);
  if (!entity) notFound();

  return <RulesView entity={entity} />;
}
