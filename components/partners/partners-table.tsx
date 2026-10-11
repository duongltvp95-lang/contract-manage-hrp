"use client";

import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AddPartnerButton, RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { CompanyBadges, PartnerStatusBadge } from "@/components/partners/partner-badges";
import { BulkDeletePartnersButton } from "@/components/partners/bulk-delete-partners-button";
import { ColumnFilterPopover } from "@/components/partners/column-filter-popover";
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
import type { PartnerWithCount } from "@/lib/services/partners";

import {
  COLUMN_LABELS,
  CONTRACT_COUNT_OPTIONS,
  usePartnerTableFilters,
  type PartnerFilters,
} from "@/components/partners/hooks/use-partner-table-filters";
import { usePartnerSelection } from "@/components/partners/hooks/use-partner-selection";
import { PartnerActiveFilters } from "@/components/partners/partner-active-filters";

export {
  usePartnerTableFilters,
  usePartnerSelection,
  COLUMN_LABELS,
  CONTRACT_COUNT_OPTIONS,
};
export type { PartnerFilters };

/**
 * Partners table — feature round 2, part 2 + part 3; refactored in Round 33.
 *
 * Columns: Tên đối tác · Tên viết tắt · Mã số thuế · Khu vực · Trạng thái ·
 * Công ty · Số hợp đồng, plus the "Sửa" action. Address is deliberately NOT in
 * the table — it can run to a couple of lines and would crowd the row; the
 * detail page carries it.
 *
 * Round 30 — client-side column filters (name / abbreviation / region contain,
 * folded; company select).
 *
 * Round 31 — responsive columns (T1 chốt breakpoints — không tự đổi):
 *   < sm  : Tên, Trạng thái, Thao tác (3 cột)
 *   sm    : + Tên viết tắt, MST (5 cột)
 *   md    : + Khu vực (6 cột)
 *   lg    : + Công ty (7 cột)
 *   xl    : + Số hợp đồng (đủ 8 cột — giữ hành vi hiện tại)
 *
 * Round 37 — Excel-style column filter popovers (7 cột: tên, viết tắt, MST,
 * khu vực, trạng thái, công ty, số hợp đồng).
 */
export function PartnersTable({
  rows,
  canDelete = false,
}: {
  rows: PartnerWithCount[];
  canDelete?: boolean;
}) {
  const router = useRouter();

  const {
    filters,
    setFilters,
    filteredRows,
    hasFilters,
    nameOptions,
    abbrOptions,
    taxCodeOptions,
    regionOptions,
    statusOptions,
    companyOptions,
    setColumnFilter,
    clearAllFilters,
  } = usePartnerTableFilters(rows);

  const {
    effectiveIds,
    selectedSet,
    allSelected,
    toggleRow,
    toggleAll,
    clearSelection,
  } = usePartnerSelection(filteredRows);

  const handleClearAll = () => {
    clearAllFilters();
    clearSelection();
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-6 w-6" />}
        title="Chưa có đối tác"
        description="Thêm đối tác để gắn vào hợp đồng và lọc theo đối tác."
        action={<AddPartnerButton />}
      />
    );
  }

  return (
    <div className="space-y-3">
      {canDelete && effectiveIds.length > 0 && (
        <BulkDeletePartnersButton
          ids={effectiveIds}
          names={new Map(rows.map((row) => [row.id, row.name]))}
          onDone={clearSelection}
        />
      )}
      {hasFilters && (
        <PartnerActiveFilters
          filters={filters}
          onClearColumn={setColumnFilter}
          onClearAll={handleClearAll}
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
              <TableHead>
                <div className="flex items-center justify-between gap-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tên đối tác
                  </span>
                  <ColumnFilterPopover
                    label={COLUMN_LABELS.name}
                    options={nameOptions}
                    selected={filters.name}
                    onChange={(v) => setColumnFilter("name", v)}
                    mode="search"
                    placeholder="Lọc theo tên"
                    testIdPrefix="partner-filter-name"
                  />
                </div>
              </TableHead>
              <TableHead className="hidden sm:table-cell" data-testid="partner-head-abbr">
                <div className="flex items-center justify-between gap-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tên viết tắt
                  </span>
                  <ColumnFilterPopover
                    label={COLUMN_LABELS.shortName}
                    options={abbrOptions}
                    selected={filters.shortName}
                    onChange={(v) => setColumnFilter("shortName", v)}
                    mode="search"
                    placeholder="Lọc viết tắt"
                    testIdPrefix="partner-filter-abbr"
                  />
                </div>
              </TableHead>
              <TableHead className="hidden sm:table-cell" data-testid="partner-head-tax-code">
                <div className="flex items-center justify-between gap-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Mã số thuế
                  </span>
                  <ColumnFilterPopover
                    label={COLUMN_LABELS.taxCode}
                    options={taxCodeOptions}
                    selected={filters.taxCode}
                    onChange={(v) => setColumnFilter("taxCode", v)}
                    mode="search"
                    placeholder="Lọc MST"
                    testIdPrefix="partner-filter-tax-code"
                  />
                </div>
              </TableHead>
              <TableHead className="hidden md:table-cell" data-testid="partner-head-region">
                <div className="flex items-center justify-between gap-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Khu vực
                  </span>
                  <ColumnFilterPopover
                    label={COLUMN_LABELS.region}
                    options={regionOptions}
                    selected={filters.region}
                    onChange={(v) => setColumnFilter("region", v)}
                    mode="search"
                    placeholder="Lọc khu vực"
                    testIdPrefix="partner-filter-region"
                  />
                </div>
              </TableHead>
              <TableHead data-testid="partner-head-status">
                <div className="flex items-center justify-between gap-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Trạng thái
                  </span>
                  <ColumnFilterPopover
                    label={COLUMN_LABELS.status}
                    options={statusOptions}
                    selected={filters.status}
                    onChange={(v) => setColumnFilter("status", v)}
                    mode="static"
                    testIdPrefix="partner-filter-status"
                  />
                </div>
              </TableHead>
              <TableHead className="hidden lg:table-cell" data-testid="partner-head-company">
                <div className="flex items-center justify-between gap-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Công ty
                  </span>
                  <ColumnFilterPopover
                    label={COLUMN_LABELS.company}
                    options={companyOptions}
                    selected={filters.company}
                    onChange={(v) => setColumnFilter("company", v)}
                    mode="search"
                    placeholder="Lọc công ty"
                    testIdPrefix="partner-filter-company"
                  />
                </div>
              </TableHead>
              <TableHead
                className="hidden text-center xl:table-cell"
                data-testid="partner-head-contract-count"
              >
                <div className="flex items-center justify-center gap-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Số hợp đồng
                  </span>
                  <ColumnFilterPopover
                    label="Số hợp đồng"
                    options={CONTRACT_COUNT_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    selected={filters.contractCount === "all" ? [] : [filters.contractCount]}
                    onChange={(v) => {
                      setFilters((previous) => {
                        const current = previous.contractCount;
                        const candidates = v.filter((value) => value !== current);
                        const next = (candidates[0] ??
                          (v.length === 0 ? "all" : current)) as PartnerFilters["contractCount"];
                        return { ...previous, contractCount: next };
                      });
                    }}
                    mode="static"
                    testIdPrefix="partner-filter-contract-count"
                  />
                </div>
              </TableHead>
              <TableHead className="text-right" data-testid="partner-head-actions">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Thao tác
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canDelete ? 9 : 8}
                  className="py-10 text-center text-sm text-muted-foreground"
                  data-testid="partners-filter-empty"
                >
                  Không có đối tác nào khớp bộ lọc
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
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
                    <TableCell className="font-medium" data-testid={`partner-name-cell-${row.id}`}>
                      <Link
                        href={href}
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell
                      className="hidden font-mono text-sm text-muted-foreground sm:table-cell"
                      data-testid={`partner-abbr-cell-${row.id}`}
                    >
                      {row.abbreviation ?? ""}
                    </TableCell>
                    <TableCell className="hidden font-mono text-sm sm:table-cell">
                      {row.tax_code ? (
                        row.tax_code
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {row.region ?? ""}
                    </TableCell>
                    <TableCell>
                      <PartnerStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <CompanyBadges companies={row.companies} />
                    </TableCell>
                    <TableCell className="hidden text-center xl:table-cell">
                      {row.contract_count > 0 ? (
                        <Badge variant="secondary" data-testid="partner-contract-count">
                          {row.contract_count}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
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
              })
            )}
          </TableBody>
        </Table>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {hasFilters
            ? `${filteredRows.length} / ${rows.length} đối tác`
            : `${rows.length} đối tác`}
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
