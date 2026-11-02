import { NextResponse } from 'next/server';

import { getEntity } from '@/lib/config';
import { getMatchStats } from '@/lib/queries';
import { toClientError } from '@/lib/server-error';

/**
 * Routing breakdown and per-rule counts for one entity.
 *
 * Owner's rights: aggregate only.
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
    return NextResponse.json(await getMatchStats(entity));
  } catch (error) {
    const message = toClientError(error, `match-stats:${entity}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
