import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return NextResponse.json({ error: 'Configure ADMIN_API_KEY on server' }, { status: 503 });
  const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/strategy/chart`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify(await request.json()),
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
