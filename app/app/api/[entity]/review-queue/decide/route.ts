import { NextResponse } from 'next/server';

import { getEntity } from '@/lib/config';
import { recordStewardDecision } from '@/lib/queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/**
 * Record a steward's decision on a MANUAL_REVIEW pair.
 *
 * Runs with caller's rights, not owner's rights: the write is attributed to
 * the signed-in user (CURRENT_USER() in the audit row) and is only allowed
 * when both the caller's own grants and the service's caller grants permit
 * it. See the "Grant caller rights" step in the deploy-app skill for the
 * INSERT/UPDATE/DELETE grants this needs beyond the read-only SELECT grant
 * the rest of the app uses.
 *
 * Every value from the request body is bound, never interpolated. row_a and
 * row_b are coerced to finite numbers before use; a non-numeric value is
 * rejected rather than passed through to SQL.
 */
export const dynamic = 'force-dynamic';

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;

  if (!getEntity(entity)) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const { row_a, row_b, decision, notes } = (body ?? {}) as Record<string, unknown>;

  const rowA = finiteNumber(row_a);
  const rowB = finiteNumber(row_b);
  if (rowA === null || rowB === null) {
    return NextResponse.json({ error: 'row_a and row_b must be numbers' }, { status: 400 });
  }
  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return NextResponse.json({ error: "decision must be 'APPROVE' or 'REJECT'" }, { status: 400 });
  }
  const safeNotes = typeof notes === 'string' ? notes.slice(0, 500) : '';

  try {
    const result = await recordStewardDecision(
      entity,
      { rowA, rowB, decision, notes: safeNotes },
      { callersRights: true, callerToken: callerTokenFrom(request) },
    );

    if (!result) {
      return NextResponse.json(
        { error: 'Pair not found in the review queue. It may already have been decided.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ row_a: result.rowA, row_b: result.rowB, decision: result.decision });
  } catch (error) {
    const message = toClientError(error, `review-queue/decide:${entity}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
