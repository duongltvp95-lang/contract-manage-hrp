import { PARTNER_STATUS_LABELS, type PartnerStatus } from "@schemas/partner";

import { Badge } from "@/components/ui/badge";

/**
 * Status + company badges shared by the partners table and the detail page
 * (round 10).
 */

export function PartnerStatusBadge({ status }: { status: PartnerStatus }) {
  const active = status === "active";

  return (
    <Badge
      variant="outline"
      data-testid={`partner-status-${status}`}
      className={
        active
          ? "rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
          : "rounded-full border-transparent bg-muted text-muted-foreground"
      }
    >
      {PARTNER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CompanyBadges({ companies }: { companies: string[] }) {
  if (companies.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {companies.map((name) => (
        <Badge
          key={name}
          variant="secondary"
          data-testid="partner-company-badge"
          className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        >
          {name}
        </Badge>
      ))}
    </div>
  );
}
