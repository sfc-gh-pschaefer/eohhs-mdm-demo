import { notFound } from 'next/navigation';

import { QualityView } from '@/components/views/QualityView';
import { getEntity } from '@/lib/config';

export default async function QualityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = getEntity(slug);
  if (!entity) notFound();

  return <QualityView entity={entity} />;
}
