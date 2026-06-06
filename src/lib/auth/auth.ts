// Node-runtime Auth.js instance: the edge-safe config plus the Credentials
// provider (which reads the DB and verifies a scrypt hash). This is the module
// route handlers and server components import for auth(), signIn(), signOut().
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { getUserCredentialsByEmail } from '../db/config-repo';
import { verifyPassword } from './password';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;

        const user = await getUserCredentialsByEmail(email);
        // Reject users that haven't accepted their invite (no password set yet).
        if (!user || user.status !== 'active' || !user.passwordHash) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        // Only the id rides on the JWT; access facts are re-resolved per request
        // from the DB in getUserContext, so nothing stale can be trusted from the cookie.
        return { id: user.id, email: user.email };
      },
    }),
  ],
});
