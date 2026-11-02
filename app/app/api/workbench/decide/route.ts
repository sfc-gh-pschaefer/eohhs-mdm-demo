import { NextResponse } from 'next/server';

import { decideAndRefresh } from '@/lib/eohhs-queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/**
 * Record a steward decision and rebuild master records so it takes effect
 * immediately. The decision write runs with caller's rights (attributed to the
 * real steward); the rebuild runs as the service owner.
 */
export const dynamic = 'force-dynamic';

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const rowA = finiteNumber(body.row_a);
  const rowB = finiteNumber(body.row_b);
  const decision = body.decision;
  if (rowA === null || rowB === null) {
    return NextResponse.json({ error: 'row_a and row_b must be numbers' }, { status: 400 });
  }
  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return NextResponse.json({ error: "decision must be 'APPROVE' or 'REJECT'" }, { status: 400 });
  }
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 400) : '';

  try {
    const result = await decideAndRefresh(
      { rowA, rowB, decision, notes },
      { callersRights: true, callerToken: callerTokenFrom(request) },
    );
    if (!result.decided) {
      return NextResponse.json(
        { error: 'This pair is no longer in the review queue. Someone may have decided it already.' },
        { status: 409 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: toClientError(error, 'workbench/decide') }, { status: 500 });
  }
}
