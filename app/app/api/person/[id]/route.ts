import { NextResponse } from 'next/server';

import { getEohhsId, getPerson360 } from '@/lib/eohhs-queries';
import { callerTokenFrom } from '@/lib/snowflake';
import { toClientError } from '@/lib/server-error';

/** One master record with every source record behind it. Caller's rights. */
export const dynamic = 'force-dynamic';

const MASTER_ID = /^(EOH|MH|DTA|BSAS|EHS)-[0-9]{6,}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!MASTER_ID.test(id)) {
    return NextResponse.json({ error: 'Invalid master ID' }, { status: 400 });
  }
  try {
    const auth = { callersRights: true, callerToken: callerTokenFrom(request) };
    const [result, eohhs] = await Promise.all([getPerson360(id, auth), getEohhsId(id, auth)]);
    if (!result.master) {
      return NextResponse.json({ error: `No master record ${id}` }, { status: 404 });
    }
    return NextResponse.json({ ...result, eohhs });
  } catch (error) {
    return NextResponse.json({ error: toClientError(error, 'person360') }, { status: 500 });
  }
}
