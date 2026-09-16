import { Badge } from "@/components/ui/badge";

const VARIANTS = {
  SUCCEEDED: "secondary",
  ACTIVE: "secondary",
  GRANTED: "secondary",
  PENDING: "outline",
  FAILED: "destructive",
  REVOKED: "destructive",
  DENIED: "destructive",
} as const;

const LABELS: Record<keyof typeof VARIANTS, string> = {
  SUCCEEDED: "Succeeded",
  ACTIVE: "Active",
  GRANTED: "Granted",
  PENDING: "Pending",
  FAILED: "Failed",
  REVOKED: "Revoked",
  DENIED: "Denied",
};

export function StatusBadge({ status }: { status: keyof typeof VARIANTS }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
