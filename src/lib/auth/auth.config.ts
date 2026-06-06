// Edge-safe Auth.js config: pages + callbacks only, NO database or Node-only code.
// middleware.ts imports this (runs on the edge runtime); auth.ts extends it with
// the Credentials provider, which DOES touch the DB and only runs in Node.
import type { NextAuthConfig, DefaultSession } from 'next-auth';

// Tell TS about the extra field we carry on the session. The session only needs the
// user id — all access facts (tenant, admin, profile) are re-resolved from the DB per
// request in getUserContext, so nothing security-relevant rides on the cookie. (We use
// a small cast in the callbacks rather than augmenting next-auth/jwt, whose augmentation
// module isn't resolvable in v5 beta.)
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

type AppToken = { id?: string };

export const authConfig = {
  // Self-hosted: trust the deployment's own host header rather than Vercel's.
  trustHost: true,
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  providers: [], // added in auth.ts (kept out of the edge bundle)
  callbacks: {
    // Persist the id onto the token at sign-in (from the object authorize returns).
    jwt({ token, user }) {
      if (user) {
        (token as AppToken).id = (user as { id: string }).id;
      }
      return token;
    },
    // Expose it on the session object read by server components / route handlers.
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token as AppToken).id ?? '';
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
