import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Person360View } from '@/components/views/Person360View';
import { getEntity } from '@/lib/config';

export default async function Person360Page({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: slug } = await params;
  if (!getEntity(slug)) notFound();
  return (
    <Suspense>
      <Person360View />
    </Suspense>
  );
}
