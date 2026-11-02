import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { StewardWorkbenchView } from '@/components/views/StewardWorkbenchView';
import { getEntity } from '@/lib/config';

export default async function WorkbenchPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: slug } = await params;
  if (!getEntity(slug)) notFound();
  return (
    <Suspense>
      <StewardWorkbenchView />
    </Suspense>
  );
}
