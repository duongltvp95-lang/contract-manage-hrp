import Link from "next/link";

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
import type { ContractRow } from "@/lib/services/contracts";

/**
 * "Recent Contracts" — plan section 67.
 *
 * Server-rendered from data the page already fetched; the component takes rows
 * rather than querying, so the dashboard is one round trip instead of three.
 */
export function RecentContracts({ contracts }: { contracts: ContractRow[] }) {
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
    <div className="rounded-md border">
      <Table data-testid="recent-contracts-table">
        <TableHeader>
          <TableRow>
            <TableHead>Số hợp đồng</TableHead>
            <TableHead>Đối tác</TableHead>
            <TableHead>Ngày ký</TableHead>
            <TableHead>Ngày hết hạn</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {contracts.map((contract) => (
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
                {formatDateOnly(contract.signed_date)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateOnly(contract.expiry_date)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
