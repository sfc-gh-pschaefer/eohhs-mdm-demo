import { NextResponse } from 'next/server';

import { getEntity } from '@/lib/config';
import { getMatchPairs } from '@/lib/queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/**
 * Pairs awaiting a human decision.
 *
 * This is the same table as match-pairs, restricted to MANUAL_REVIEW and ordered
 * so the least certain pairs come first. It exists as its own route because the
 * alerts page has a distinct meaning from the pair explorer, and because the
 * previous frontend called a review-queue endpoint that was never implemented on
 * the backend.
 *
 * Caller's rights: individual records.
 */
export const dynamic = 'force-dynamic';

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
    const result = await getMatchPairs(
      entity,
      {
        limit: intParam(url.searchParams.get('limit'), 50, 1, 200),
        offset: intParam(url.searchParams.get('offset'), 0, 0, 1_000_000),
        matchType: url.searchParams.get('match_type') ?? '',
        minScore: 0,
        maxScore: 1,
        search: url.searchParams.get('search') ?? '',
        routing: 'MANUAL_REVIEW',
      },
      { callersRights: true, callerToken: callerTokenFrom(request) },
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = toClientError(error, `review-queue:${entity}`);
    return NextResponse.json(
      { entity_type: entity, items: [], total: 0, error: message },
      { status: 500 },
    );
  }
}
