import { NextResponse } from 'next/server';

import { getOverlap } from '@/lib/eohhs-queries';
import { toClientError } from '@/lib/server-error';

/** Agency footprint combinations across residents. Owner's rights, aggregates only. */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getOverlap());
  } catch (error) {
    return NextResponse.json({ error: toClientError(error, 'overlap') }, { status: 500 });
  }
}
