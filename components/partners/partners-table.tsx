"use client";

import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AddPartnerButton, RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { CompanyBadges, PartnerStatusBadge } from "@/components/partners/partner-badges";
import { BulkDeletePartnersButton } from "@/components/partners/bulk-delete-partners-button";
import { DeletePartnerButton } from "@/components/partners/delete-partner-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
 * Round 19: a delete action (Trash2) is rendered only for the delete-admin
 * emails. The database still refuses a client-side delete; the service deletes
 * through the service-role client after re-checking the email.
 */
export function PartnersTable({
  rows,
  canDelete = false,
}: {
  rows: PartnerWithCount[];
  canDelete?: boolean;
}) {
  const router = useRouter();
  // Round 24 — bulk selection. The page remounts this table with a `key` when
  // the tab changes, so a selection never survives a list change.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectedSet = new Set(selectedIds);
  const allSelected =
    rows.length > 0 && rows.every((row) => selectedSet.has(row.id));

  const toggleRow = (id: string) => {
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((existing) => existing !== id)
        : [...previous, id],
    );
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : rows.map((row) => row.id));
  };

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
    <div className="space-y-3">
      {canDelete && selectedIds.length > 0 && (
        <BulkDeletePartnersButton
          ids={selectedIds}
          names={new Map(rows.map((row) => [row.id, row.name]))}
          onDone={() => setSelectedIds([])}
        />
      )}
      <div className="rounded-xl shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Chọn tất cả đối tác"
                    data-testid="partner-select-all"
                  />
                </TableHead>
              )}
              <TableHead>Tên đối tác</TableHead>
              <TableHead>Tên viết tắt</TableHead>
              <TableHead>Mã số thuế</TableHead>
              <TableHead>Khu vực</TableHead>
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
                  {canDelete && (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selectedSet.has(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                        aria-label="Chọn đối tác"
                        data-testid={`partner-select-${row.id}`}
                      />
                    </TableCell>
                  )}
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
                  {/* Round 26 — the abbreviation lives in its own column. */}
                  <TableCell
                    className="font-mono text-sm text-muted-foreground"
                    data-testid={`partner-abbr-cell-${row.id}`}
                  >
                    {row.abbreviation ?? ""}
                  </TableCell>
                <TableCell className="font-mono text-sm">
                  {row.tax_code ? (
                    row.tax_code
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.region ?? ""}
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
                  <div className="inline-flex items-center gap-1">
                    <RenamePartnerButton partner={row} />
                    {canDelete && <DeletePartnerButton partnerId={row.id} />}
                  </div>
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