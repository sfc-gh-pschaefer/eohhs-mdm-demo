import { NextResponse } from 'next/server';

import { getSummary } from '@/lib/queries';
import { toClientError } from '@/lib/server-error';

/**
 * Cross-entity key figures for the landing page.
 *
 * Owner's rights: counts only, identical for every user, so one cached answer
 * serves everyone.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getSummary());
  } catch (error) {
    const message = toClientError(error, 'summary');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
