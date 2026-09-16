import { withAuth } from "@/features/auth/route-guard";
import { approveUser } from "@/features/auth/users";

export const POST = withAuth(
  "admin",
  async (_request, context: RouteContext<"/api/admin/users/[id]/approve">, admin) => {
    const { id } = await context.params;
    return Response.json({ user: await approveUser(admin, id) });
  },
);
