import { BellIcon } from "lucide-react";
import Link from "next/link";

import { getAnomalies } from "@/features/admin/activity";
import { getSessionUser } from "@/features/auth/dal";

/** In-app alert badge (PRD §6.2): warnings from the dashboard, on every admin page. */
export async function AdminAlerts() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return null;
  const warnings = (await getAnomalies()).filter((a) => a.level === "warning");
  if (warnings.length === 0) return null;

  return (
    <Link
      href="/admin"
      title={warnings.map((w) => w.title).join("\n")}
      className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1 text-sm font-medium text-destructive hover:bg-destructive/20"
    >
      <BellIcon className="size-4" />
      {warnings.length} alert{warnings.length === 1 ? "" : "s"}
    </Link>
  );
}
