import { jsonError, withAuth } from "@/features/auth/route-guard";
import { listUsers, provisionUser } from "@/features/auth/users";

export const GET = withAuth("admin", async (_request, _context, admin) => {
  return Response.json({ users: await listUsers(admin) });
});

/** Creates an ACTIVE account: { email, password, name?, role? }. */
export const POST = withAuth("admin", async (request, _context, admin) => {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return jsonError(400, "invalid_input", "Expected a JSON body");
  }
  const user = await provisionUser(admin, body as Parameters<typeof provisionUser>[1]);
  return Response.json({ user }, { status: 201 });
});
