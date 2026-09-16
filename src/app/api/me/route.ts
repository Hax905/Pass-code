import { withAuth } from "@/features/auth/route-guard";

/** The signed-in user. Also the reference "protected route" for Phase 2. */
export const GET = withAuth("user", async (_request, _context, user) => {
  return Response.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});
