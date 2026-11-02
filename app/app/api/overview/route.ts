import { NextResponse } from 'next/server';

import { getOverview } from '@/lib/eohhs-queries';
import { toClientError } from '@/lib/server-error';

/** Executive overview: scorecard, source contribution, tiers. Owner's rights. */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getOverview());
  } catch (error) {
    return NextResponse.json({ error: toClientError(error, 'overview') }, { status: 500 });
  }
}
