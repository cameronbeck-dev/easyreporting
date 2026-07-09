// Edge-safe auth gate. Built from auth.config only (no providers / DB), so it
// runs on the edge runtime. It guards PAGE navigations: unauthenticated visitors
// are redirected to /login. API routes are intentionally left to enforce their
// own 401 via getUserContext, so a fetch never gets an HTML redirect body.
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth/auth.config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Public page routes + anything under /api (handlers enforce their own auth).
  const isPublic =
    nextUrl.pathname.startsWith('/login') ||
    nextUrl.pathname.startsWith('/invite') ||
    nextUrl.pathname.startsWith('/api');

  if (!isLoggedIn && !isPublic) {
    return Response.redirect(new URL('/login', nextUrl));
  }

  // Expose the path so the root layout can DB-validate the session (the edge can't):
  // a still-valid cookie for a deleted/disabled user must not strand them on a page.
  const headers = new Headers(req.headers);
  headers.set('x-pathname', nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  // Run on everything except Next internals and static asset files. The file-upload
  // route is also excluded: middleware buffers/caps the request body at 10MB, which would
  // truncate large uploads. That route streams the body straight to disk and enforces its
  // own owner-admin auth (getUserContext), so it doesn't need the middleware gate.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/admin/import/upload|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
