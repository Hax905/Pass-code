import { jsonError, withAuth } from "@/features/auth/route-guard";
import { changeUserRole } from "@/features/auth/users";

/** Body: { role: "ADMIN" | "USER" }. Ends the user's existing sessions. */
export const POST = withAuth(
  "admin",
  async (request, context: RouteContext<"/api/admin/users/[id]/role">, admin) => {
    const { id } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    const role = body && typeof body === "object" && "role" in body ? body.role : undefined;
    if (role !== "ADMIN" && role !== "USER") {
      return jsonError(400, "invalid_input", 'role must be "ADMIN" or "USER"');
    }
    return Response.json({ user: await changeUserRole(admin, id, role) });
  },
);
