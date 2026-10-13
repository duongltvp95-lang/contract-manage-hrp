import Link from "next/link";

import { CompanyBadges } from "@/components/partners/partner-badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateOnly } from "@/lib/format";
import type { DashboardContractRow } from "@/lib/services/dashboard";

/**
 * "Recent Contracts" — plan section 67.
 *
 * Server-rendered from data the page already fetched; the component takes rows
 * rather than querying, so the dashboard is one round trip instead of three.
 *
 * Round 15: the partner cell shows the resolved name (never "—") and a new
 * "Công ty" column shows the partner's company badges.
 */
export function RecentContracts({ contracts }: { contracts: DashboardContractRow[] }) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        title="Chưa có hợp đồng nào"
        description="Hợp đồng bạn tạo sẽ xuất hiện ở đây."
        action={
          <Button asChild size="sm">
            <Link href="/contracts/new">Thêm hợp đồng</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden shadow-xs bg-card">
      <Table data-testid="recent-contracts-table">
        <TableHeader className="bg-muted/30">
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-semibold text-xs">Số hợp đồng</TableHead>
            <TableHead className="font-semibold text-xs">Đối tác</TableHead>
            <TableHead className="font-semibold text-xs">Công ty</TableHead>
            <TableHead className="font-semibold text-xs">Ngày ký</TableHead>
            <TableHead className="font-semibold text-xs">Ngày hết hạn</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {contracts.map((contract) => (
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
                {formatDateOnly(contract.signed_date)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                {formatDateOnly(contract.expiry_date)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
