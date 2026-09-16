import { jsonError, withAuth } from "@/features/auth/route-guard";
import { resetUserPassword } from "@/features/auth/users";

/** Body: { password }. Ends the user's existing sessions. */
export const POST = withAuth(
  "admin",
  async (request, context: RouteContext<"/api/admin/users/[id]/password">, admin) => {
    const { id } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    const password =
      body && typeof body === "object" && "password" in body ? body.password : undefined;
    if (typeof password !== "string") {
      return jsonError(400, "invalid_input", "password is required");
    }
    return Response.json({ user: await resetUserPassword(admin, id, password) });
  },
);
