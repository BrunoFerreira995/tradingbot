import { NextRequest, NextResponse } from 'next/server';

const actions = new Set(['install', 'doctor']);

export async function POST(request: NextRequest) {
  const key = process.env.ADMIN_API_KEY;
  if (!key)
    return NextResponse.json(
      { error: 'Configure ADMIN_API_KEY on server' },
      { status: 503 },
    );
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  const action = body?.action;
  if (typeof action !== 'string' || !actions.has(action))
    return NextResponse.json(
      { error: 'Expected action install or doctor' },
      { status: 400 },
    );
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/mt5/${action}`,
    {
      method: 'POST',
      headers: { 'x-admin-key': key },
      cache: 'no-store',
    },
  );
  return NextResponse.json(await response.json(), { status: response.status });
}
