import { withAuth } from "@/features/auth/route-guard";
import { reinstateUser } from "@/features/auth/users";

export const POST = withAuth(
  "admin",
  async (_request, context: RouteContext<"/api/admin/users/[id]/reinstate">, admin) => {
    const { id } = await context.params;
    return Response.json({ user: await reinstateUser(admin, id) });
  },
);
