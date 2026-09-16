// Auth.js endpoints: sign-in (POST /api/auth/callback/credentials), sign-out,
// session and CSRF token.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
