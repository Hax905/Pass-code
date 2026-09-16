import { withAuth } from "@/features/auth/route-guard";
import { revokeUser } from "@/features/auth/users";

/** Revokes access immediately. Optional body: { reason }. */
export const POST = withAuth(
  "admin",
  async (request, context: RouteContext<"/api/admin/users/[id]/revoke">, admin) => {
    const { id } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    const reason =
      typeof body === "object" &&
      body !== null &&
      "reason" in body &&
      typeof body.reason === "string"
        ? body.reason
        : undefined;
    return Response.json({ user: await revokeUser(admin, id, reason) });
  },
);
