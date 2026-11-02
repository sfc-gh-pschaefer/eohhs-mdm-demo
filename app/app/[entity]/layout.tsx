import { notFound } from 'next/navigation';

import { entitySlugs, getEntity } from '@/lib/config';

/**
 * Validates the entity segment once for every page beneath it, so an unknown
 * slug produces a 404 rather than each page handling the case separately.
 */
export function generateStaticParams() {
  return entitySlugs().map((entity) => ({ entity }));
}

export default async function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;

  if (!getEntity(entity)) {
    notFound();
  }

  return <>{children}</>;
}
