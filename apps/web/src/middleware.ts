import { NextResponse, type NextRequest } from 'next/server';

const HR_ONLY_ROUTES = [
  '/dashboard',
  '/weekly-day-off',
  '/payroll',
  '/bonuses',
  '/deductions',
  '/advances',
  '/reports',
  '/self-service',
] as const;

export function middleware(request: NextRequest) {
  if (process.env.EDITION !== 'erp') return NextResponse.next();
  const blocked = HR_ONLY_ROUTES.some((route) => (
    request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(`${route}/`)
  ));
  return blocked
    ? NextResponse.redirect(new URL('/branch-kiosk', request.url))
    : NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/weekly-day-off/:path*',
    '/payroll/:path*',
    '/bonuses/:path*',
    '/deductions/:path*',
    '/advances/:path*',
    '/reports/:path*',
    '/self-service/:path*',
  ],
};
