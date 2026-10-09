import { NextRequest, NextResponse } from 'next/server';
export function middleware(request: NextRequest) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password)
    return process.env.NODE_ENV === 'production'
      ? new NextResponse('Dashboard credentials not configured', {
          status: 503,
        })
      : NextResponse.next();
  const authorization = request.headers.get('authorization');
  const credentials = authorization?.startsWith('Basic ')
    ? atob(authorization.slice(6))
    : '';
  if (credentials !== `${user}:${password}`)
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Aurum Terminal"' },
    });
  return NextResponse.next();
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
