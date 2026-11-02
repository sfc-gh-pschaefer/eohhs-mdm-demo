import { NextResponse } from 'next/server';

import { getWorkbench } from '@/lib/eohhs-queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/** Pairs awaiting a steward, with both full records. Caller's rights. */
export const dynamic = 'force-dynamic';

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await getWorkbench(
      {
        limit: intParam(url.searchParams.get('limit'), 12, 1, 50),
        offset: intParam(url.searchParams.get('offset'), 0, 0, 1_000_000),
        search: (url.searchParams.get('search') ?? '').slice(0, 100),
        suggestion: url.searchParams.get('suggestion') ?? '',
      },
      { callersRights: true, callerToken: callerTokenFrom(request) },
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { items: [], total: 0, error: toClientError(error, 'workbench') },
      { status: 500 },
    );
  }
}
