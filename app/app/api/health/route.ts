import { NextResponse } from 'next/server';

import { querySnowflake } from '@/lib/snowflake';

/**
 * Deployment health check: which Snowflake runtime variables are present
 * (names only, never values) and whether a trivial owner's-rights query
 * completes. A hard timeout makes a hung connection visible as an error.
 */
export const dynamic = 'force-dynamic';

const ENV_NAMES = [
  'SNOWFLAKE_ACCOUNT',
  'SNOWFLAKE_HOST',
  'SNOWFLAKE_ACCOUNT_URL',
  'SNOWFLAKE_PORT',
  'SNOWFLAKE_PROTOCOL',
  'SNOWFLAKE_WAREHOUSE',
  'SNOWFLAKE_DATABASE',
  'SNOWFLAKE_SCHEMA',
  'SNOWFLAKE_ROLE',
];

export async function GET() {
  const env = Object.fromEntries(ENV_NAMES.map((n) => [n, Boolean(process.env[n])]));
  const t0 = Date.now();
  try {
    const rows = await Promise.race([
      querySnowflake<{ OK: number }>('SELECT 1 AS OK'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 20s')), 20_000)),
    ]);
    return NextResponse.json({ ok: rows[0]?.OK === 1, ms: Date.now() - t0, env });
  } catch (error) {
    console.error('[health]', error);
    return NextResponse.json(
      { ok: false, ms: Date.now() - t0, env, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' },
      { status: 503 },
    );
  }
}
