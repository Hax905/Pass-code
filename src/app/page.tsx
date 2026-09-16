import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/features/auth/dal";

import { logoutAction } from "./(auth)/actions";

export default async function Home({ searchParams }: PageProps<"/">) {
  const [user, { denied }] = await Promise.all([getSessionUser(), searchParams]);
  if (user?.role === "ADMIN") redirect("/admin");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">PassCode</h1>
        <p className="text-muted-foreground">
          The building&apos;s network password changes regularly. Sign in with your own account to
          get the current one.
        </p>
        {denied === "admin" && (
          <Alert variant="destructive">
            <AlertDescription>That page is only for administrators.</AlertDescription>
          </Alert>
        )}
        {user ? (
          <div className="space-y-3">
            <p className="text-sm">
              Signed in as <span className="font-medium">{user.email}</span>.
            </p>
            <p className="text-sm text-muted-foreground">
              The assistant that gives you the network password is coming soon.
            </p>
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex justify-center gap-2">
            <Button nativeButton={false} render={<Link href="/login" />}>
              Sign in
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/register" />}>
              Request access
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
