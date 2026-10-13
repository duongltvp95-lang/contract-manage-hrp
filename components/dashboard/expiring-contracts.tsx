import Link from "next/link";

import { CompanyBadges } from "@/components/partners/partner-badges";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateOnly, formatExpiryHint, daysUntil } from "@/lib/format";
import type { DashboardContractRow } from "@/lib/services/dashboard";
import { cn } from "@/lib/utils";

/**
 * "Expiring Contracts" — plan sections 67, 69.
 *
 * The rows arrive already filtered to `today <= expiry_date <= today + 90` and
 * sorted by `expiry_date` ascending, so this component only presents them. The
 * "days left" column is derived for display; it is never stored (plan section
 * 70: no lifecycle status column).
 *
 * Round 15: the partner cell shows the resolved name (never "—") and a new
 * "Công ty" column shows the partner's company badges.
 */
export function ExpiringContracts({ contracts }: { contracts: DashboardContractRow[] }) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        title="Không có hợp đồng nào sắp hết hạn"
        description="Không có hợp đồng nào hết hạn trong 90 ngày tới."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden shadow-xs bg-card">
      <Table data-testid="expiring-contracts-table">
        <TableHeader className="bg-muted/30">
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-semibold text-xs">Số hợp đồng</TableHead>
            <TableHead className="font-semibold text-xs">Đối tác</TableHead>
            <TableHead className="font-semibold text-xs">Công ty</TableHead>
            <TableHead className="font-semibold text-xs">Ngày hết hạn</TableHead>
            <TableHead className="font-semibold text-xs">Còn lại</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {contracts.map((contract) => {
            const days = daysUntil(contract.expiry_date);
            const urgent = days !== null && days <= 30;

            return (
              <TableRow key={contract.id} className="hover:bg-emerald-500/[0.02] transition-colors">
                <TableCell className="font-medium">
                  <Link
                    href={`/contracts/${contract.id}`}
                    className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    {contract.contract_number ?? "Chưa đặt số"}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[16rem] truncate">
                  {contract.partnerName ?? contract.partner_text ?? ""}
                </TableCell>
                <TableCell>
                  {contract.companies.length > 0 ? (
                    <CompanyBadges companies={contract.companies} />
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                  {formatDateOnly(contract.expiry_date)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-xs",
                      urgent
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30"
                        : "bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30",
                    )}
                  >
                    {formatExpiryHint(contract.expiry_date)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
