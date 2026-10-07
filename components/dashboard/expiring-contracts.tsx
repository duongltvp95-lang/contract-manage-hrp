import Link from "next/link";

import { CompanyBadges } from "@/components/partners/partner-badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
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
    <div className="rounded-md border">
      <Table data-testid="expiring-contracts-table">
        <TableHeader>
          <TableRow>
            <TableHead>Số hợp đồng</TableHead>
            <TableHead>Đối tác</TableHead>
            <TableHead>Công ty</TableHead>
            <TableHead>Ngày hết hạn</TableHead>
            <TableHead>Còn lại</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {contracts.map((contract) => {
            const days = daysUntil(contract.expiry_date);
            const urgent = days !== null && days <= 30;

            return (
              <TableRow key={contract.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/contracts/${contract.id}`}
                    className="hover:underline"
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
                <TableCell className="whitespace-nowrap">
                  {formatDateOnly(contract.expiry_date)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={urgent ? "destructive" : "secondary"}>
                    {formatExpiryHint(contract.expiry_date)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
