import { NextResponse } from 'next/server';

import { getEntity } from '@/lib/config';
import { getMatchPairs } from '@/lib/queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/**
 * Paged, filterable candidate pairs.
 *
 * Caller's rights: pairs expose the underlying records, so the query runs as the
 * signed-in user.
 */
export const dynamic = 'force-dynamic';

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function floatParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? NaN : Number.parseFloat(value);
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
    const result = await getMatchPairs(
      entity,
      {
        limit: intParam(url.searchParams.get('limit'), 50, 1, 200),
        offset: intParam(url.searchParams.get('offset'), 0, 0, 1_000_000),
        matchType: url.searchParams.get('match_type') ?? '',
        minScore: floatParam(url.searchParams.get('min_score'), 0, 0, 1),
        maxScore: floatParam(url.searchParams.get('max_score'), 1, 0, 1),
        search: url.searchParams.get('search') ?? '',
        routing: url.searchParams.get('routing') ?? '',
      },
      { callersRights: true, callerToken: callerTokenFrom(request) },
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = toClientError(error, `match-pairs:${entity}`);
    return NextResponse.json(
      { entity_type: entity, items: [], total: 0, error: message },
      { status: 500 },
    );
  }
}
