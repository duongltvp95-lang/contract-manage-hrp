"use client";

import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AddPartnerButton, RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { CompanyBadges, PartnerStatusBadge } from "@/components/partners/partner-badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { PartnerWithCount } from "@/lib/services/partners";

/**
 * Partners table — feature round 2, part 2 + part 3.
 *
 * Columns: Tên đối tác · Mã số thuế · Số hợp đồng · Cập nhật lúc, plus a
 * "Sửa" action. Address is deliberately NOT in the table — it can run to a
 * couple of lines and would crowd the row; the detail page carries it.
 *
 * There is no Xoá column and no delete control of any kind: a partner is
 * referenced by contracts, and the database refuses a client-side delete twice
 * over (no grant, no policy). Editing is the only write the UI offers.
 */
export function PartnersTable({ rows }: { rows: PartnerWithCount[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-6 w-6" />}
        title="Chưa có đối tác"
        description="Thêm đối tác để gắn vào hợp đồng và lọc theo đối tác."
        action={
          <AddPartnerButton />
        }
      />
    );
  }

  return (
    <div className="rounded-xl shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tên đối tác</TableHead>
            <TableHead>Mã số thuế</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Công ty</TableHead>
            <TableHead className="text-center">Số hợp đồng</TableHead>
            <TableHead>Cập nhật lúc</TableHead>
            <TableHead className="text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = `/partners/${row.id}`;

            return (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(href)}
                data-testid="partner-row"
                data-partner-name={row.name}
                data-partner-tax-code={row.tax_code ?? ""}
              >
                <TableCell className="font-medium">
                  {/* A real link, so the row is reachable by keyboard too. */}
                  <Link
                    href={href}
                    className="hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {row.tax_code ? (
                    row.tax_code
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <PartnerStatusBadge status={row.status} />
                </TableCell>
                <TableCell>
                  <CompanyBadges companies={row.companies} />
                </TableCell>
                <TableCell className="text-center">
                  {row.contract_count > 0 ? (
                    <Badge variant="secondary" data-testid="partner-contract-count">
                      {row.contract_count}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(row.updated_at)}
                </TableCell>
                <TableCell
                  className="text-right"
                  onClick={(event) => event.stopPropagation()}
                >
                  <RenamePartnerButton partner={row} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {rows.length} đối tác
      </p>
    </div>
  );
}

/** The empty state for a partner that has no contracts yet. */
export function NoPartnerContractsEmptyState() {
  return (
    <EmptyState
      icon={<Building2 className="h-6 w-6" />}
      title="Chưa có hợp đồng với đối tác này"
      description="Tạo hợp đồng và chọn đối tác này để nó xuất hiện ở đây."
      action={
        <Button asChild>
          <Link href="/contracts/new">
            <Plus className="mr-2 h-4 w-4" />
            Thêm hợp đồng
          </Link>
        </Button>
      }
    />
  );
}