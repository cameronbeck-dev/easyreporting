// Edge-safe auth gate. Built from auth.config only (no providers / DB), so it
// runs on the edge runtime. It guards PAGE navigations: unauthenticated visitors
// are redirected to /login. API routes are intentionally left to enforce their
// own 401 via getUserContext, so a fetch never gets an HTML redirect body.
import NextAuth from 'next-auth';
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
});

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
