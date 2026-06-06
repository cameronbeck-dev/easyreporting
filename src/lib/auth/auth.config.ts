// Edge-safe Auth.js config: pages + callbacks only, NO database or Node-only code.
// middleware.ts imports this (runs on the edge runtime); auth.ts extends it with
// the Credentials provider, which DOES touch the DB and only runs in Node.
import type { NextAuthConfig, DefaultSession } from 'next-auth';
import type { Role } from './types';

// Tell TS about the extra fields we carry on the session. (JWT carries the same
// two fields; we read/write them via a small cast in the callbacks rather than
// augmenting next-auth/jwt, whose augmentation module isn't resolvable in v5 beta.)
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession['user'];
  }
}

type AppToken = { id?: string; role?: Role };

export const authConfig = {
  // Self-hosted: trust the deployment's own host header rather than Vercel's.
  trustHost: true,
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  providers: [], // added in auth.ts (kept out of the edge bundle)
  callbacks: {
    // Persist id + role onto the token at sign-in (from the object authorize returns).
    jwt({ token, user }) {
      if (user) {
        const t = token as AppToken;
        t.id = (user as { id: string }).id;
        t.role = (user as { role: Role }).role;
      }
      return token;
    },
    // Expose them on the session object read by server components / route handlers.
    session({ session, token }) {
      const t = token as AppToken;
      if (session.user) {
        session.user.id = t.id ?? '';
        session.user.role = t.role ?? 'external';
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
