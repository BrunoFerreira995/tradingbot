import { NextRequest, NextResponse } from 'next/server';
import { TIMEFRAMES, isTimeframe } from '@trade/shared';

/**
 * Timeframe selection for the strategy runner.
 *
 * The API validates the value too; this is a second, cheaper guard so an invalid
 * value never crosses the network boundary and the user gets the accepted list
 * from the same source the runner validates against.
 */
export async function PATCH(request: NextRequest) {
  const key = process.env.ADMIN_API_KEY;
  if (!key)
    return NextResponse.json(
      { error: 'Configure ADMIN_API_KEY on server' },
      { status: 503 },
    );
  const body = (await request.json().catch(() => null)) as {
    timeframe?: unknown;
  } | null;
  const { timeframe } = body ?? {};
  if (typeof timeframe !== 'string' || !isTimeframe(timeframe))
    return NextResponse.json(
      { error: `Expected timeframe one of: ${TIMEFRAMES.join(', ')}` },
      { status: 400 },
    );
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/strategy`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ timeframe }),
    },
  );
  return NextResponse.json(await response.json(), { status: response.status });
}
