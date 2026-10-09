import { NextRequest, NextResponse } from 'next/server';
export async function PATCH(request: NextRequest) {
  const key = process.env.ADMIN_API_KEY;
  if (!key)
    return NextResponse.json(
      { error: 'Configure ADMIN_API_KEY on server' },
      { status: 503 },
    );
  const body = await request.json();
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/settings`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify(body),
    },
  );
  return NextResponse.json(await response.json(), { status: response.status });
}
