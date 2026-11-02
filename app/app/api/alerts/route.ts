import { NextResponse } from 'next/server';

import { getAlerts } from '@/lib/eohhs-queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/** Alerts that only exist once records are joined. Caller's rights, so row access policies apply. */
export const dynamic = 'force-dynamic';

const TYPES = /^[A-Z_]{0,40}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  if (!TYPES.test(type)) return NextResponse.json({ error: 'Invalid alert type' }, { status: 400 });
  try {
    return NextResponse.json(await getAlerts({ type, limit }, { callersRights: true, callerToken: callerTokenFrom(request) }));
  } catch (error) {
    return NextResponse.json({ error: toClientError(error, 'alerts') }, { status: 500 });
  }
}
