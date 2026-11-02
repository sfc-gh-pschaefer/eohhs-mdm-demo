import { NextResponse } from 'next/server';

import { getSharing } from '@/lib/eohhs-queries';
import { toClientError } from '@/lib/server-error';

/** What each agency shares with the hub, and what comes back. Owner's rights, metadata and counts only. */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getSharing());
  } catch (error) {
    return NextResponse.json({ error: toClientError(error, 'sharing') }, { status: 500 });
  }
}
