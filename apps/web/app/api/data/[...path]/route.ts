import { NextRequest, NextResponse } from 'next/server';
const allowed = new Set([
  'dashboard',
  'logs',
  'events',
  'events/stream',
  'strategy',
]);
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path.join('/');
  if (!allowed.has(path))
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const key = process.env.ADMIN_API_KEY;
  if (!key)
    return NextResponse.json(
      { error: 'Admin API key not configured' },
      { status: 503 },
    );
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/${path}`,
    { headers: { 'x-admin-key': key }, cache: 'no-store' },
  );
  if (path === 'events/stream')
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
    });
  return NextResponse.json(await response.json(), { status: response.status });
}
