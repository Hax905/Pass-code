// Auth.js configuration (STYLES.md §2.4): email + password, JWT sessions.
// A valid JWT is not enough on its own: protected routes must go through
// withAuth (src/features/auth/route-guard.ts), which re-checks the database.
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authenticateCredentials } from "@/features/auth/login";

export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

class LoginError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [
    Credentials({
      credentials: {
        email: { type: "email", label: "Email" },
        password: { type: "password", label: "Password" },
      },
      async authorize(credentials, request) {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
        const result = await authenticateCredentials(credentials, { ip });
        if (!result.ok) {
          // "invalid_credentials" and "invalid_input" look the same to the client.
          throw new LoginError(
            result.reason === "invalid_input" ? "invalid_credentials" : result.reason,
          );
        }
        const { id, email, name, role, tokenVersion } = result.user;
        return { id, email, name, role, tokenVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present right after sign-in.
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.tokenVersion = user.tokenVersion;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.role = token.role;
      session.user.tokenVersion = token.tokenVersion;
      return session;
    },
  },
});
