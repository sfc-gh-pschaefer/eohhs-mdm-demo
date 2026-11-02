import { NextResponse } from 'next/server';

import { getEntity } from '@/lib/config';
import { getGoldenRecords } from '@/lib/queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/**
 * Paged, searchable golden records.
 *
 * Caller's rights: these are individual records, so the query runs as the
 * signed-in user and any masking or row access policy applies to them.
 *
 * All filter values are bound parameters. Nothing from the query string reaches
 * the SQL text.
 */
export const dynamic = 'force-dynamic';

/** Clamp a numeric query parameter into a sane range. */
function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;

  if (!getEntity(entity)) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 404 });
  }

  const url = new URL(request.url);

  try {
    const result = await getGoldenRecords(
      entity,
      {
        // Cap the page size so a hand-edited URL cannot pull the whole table.
        limit: intParam(url.searchParams.get('limit'), 25, 1, 200),
        offset: intParam(url.searchParams.get('offset'), 0, 0, 1_000_000),
        minClusterSize: intParam(url.searchParams.get('min_cluster_size'), 1, 1, 1_000_000),
        search: url.searchParams.get('search') ?? '',
      },
      { callersRights: true, callerToken: callerTokenFrom(request) },
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = toClientError(error, `golden-records:${entity}`);
    return NextResponse.json(
      { entity_type: entity, items: [], total: 0, error: message },
      { status: 500 },
    );
  }
}
