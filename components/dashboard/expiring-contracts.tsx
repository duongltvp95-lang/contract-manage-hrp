import Link from "next/link";

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
import type { ContractRow } from "@/lib/services/contracts";

/**
 * "Expiring Contracts" — plan sections 67, 69.
 *
 * The rows arrive already filtered to `today <= expiry_date <= today + 90` and
 * sorted by `expiry_date` ascending, so this component only presents them. The
 * "days left" column is derived for display; it is never stored (plan section
 * 70: no lifecycle status column).
 */
export function ExpiringContracts({ contracts }: { contracts: ContractRow[] }) {
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
                <TableCell className="max-w-[18rem] truncate">
                  {contract.partner_text ?? "—"}
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
