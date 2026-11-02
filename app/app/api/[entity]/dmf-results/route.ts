import { NextResponse } from 'next/server';

import { getEntity } from '@/lib/config';
import { getQuality } from '@/lib/queries';
import { toClientError } from '@/lib/server-error';

/**
 * Data Metric Function results: the intake gate verdict, the latest scheduled
 * measurements on the clean table, and the remediation audit trail.
 *
 * Owner's rights: metric results are counts and percentages, not values.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;

  if (!getEntity(entity)) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 404 });
  }

  try {
    return NextResponse.json(await getQuality(entity));
  } catch (error) {
    const message = toClientError(error, `dmf-results:${entity}`);
    return NextResponse.json(
      { entity_type: entity, checks: [], monitored: [], remediation: [], error: message },
      { status: 500 },
    );
  }
}
