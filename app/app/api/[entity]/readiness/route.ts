import { NextResponse } from 'next/server';

import { getEntity } from '@/lib/config';
import { getReadiness } from '@/lib/queries';
import { toClientError } from '@/lib/server-error';

/**
 * Per-column data quality readiness.
 *
 * Owner's rights: the readiness table holds counts and percentages only, never
 * values, so it is safe to show identically to every user. This is deliberate:
 * it lets a steward assess completeness of a sensitive column without being able
 * to read the column.
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
    return NextResponse.json(await getReadiness(entity));
  } catch (error) {
    const message = toClientError(error, `readiness:${entity}`);
    return NextResponse.json({ columns: [], error: message }, { status: 500 });
  }
}
