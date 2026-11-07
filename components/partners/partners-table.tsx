"use client";

import { Building2, ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PartnerStatus } from "@schemas/partner";

import { AddPartnerButton, RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { CompanyBadges, PartnerStatusBadge } from "@/components/partners/partner-badges";
import { BulkDeletePartnersButton } from "@/components/partners/bulk-delete-partners-button";
import { ColumnFilterPopover } from "@/components/partners/column-filter-popover";
import { DeletePartnerButton } from "@/components/partners/delete-partner-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PARTNERS_PAGE_SIZE_DEFAULT } from "@/lib/partner-display";
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

export type PartnersPaginationState = {
  totalCount: number;
  page: number;
  pageSize: number;
  pageCount: number;
  search?: string;
  status?: PartnerStatus;
  company?: string;
  contracts?: "has" | "none";
};

function buildPartnersHref(
  base: PartnersPaginationState | undefined,
  patch: Partial<Pick<PartnersPaginationState, "page" | "pageSize" | "search">>,
): string {
  const params = new URLSearchParams();
  const nextSearch = (patch.search !== undefined ? patch.search : base?.search ?? "").trim();
  const nextPage = patch.page ?? base?.page ?? 1;
  const nextPageSize = patch.pageSize ?? base?.pageSize ?? PARTNERS_PAGE_SIZE_DEFAULT;

  if (nextSearch) params.set("q", nextSearch);
  if (base?.status) params.set("status", base.status);
  if (base?.company) params.set("company", base.company);
  if (base?.contracts) params.set("contracts", base.contracts);
  if (nextPageSize !== PARTNERS_PAGE_SIZE_DEFAULT) {
    params.set("pageSize", String(nextPageSize));
  }
  if (nextPage > 1) params.set("page", String(nextPage));

  const qs = params.toString();
  return qs ? `/partners?${qs}` : "/partners";
}

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
 *
 * A10 — Server-side pagination + full-directory folded search (`?q=&page=`).
 */
export function PartnersTable({
  rows,
  canDelete = false,
  pagination,
}: {
  rows: PartnerWithCount[];
  canDelete?: boolean;
  pagination?: PartnersPaginationState;
}) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(pagination?.search ?? "");

  const totalCount = pagination?.totalCount ?? rows.length;
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? PARTNERS_PAGE_SIZE_DEFAULT;
  const pageCount = pagination?.pageCount ?? 1;
  const hasServerFilter = Boolean(
    pagination?.search ||
      pagination?.status ||
      pagination?.company ||
      pagination?.contracts,
  );
  const showServerSearch = Boolean(pagination) && (totalCount > 0 || hasServerFilter);

  const {
    filters,
    sortConfig,
    setSort,
    clearSort,
    filteredRows,
    hasFilters,
    nameOptions,
    abbrOptions,
    taxCodeOptions,
    regionOptions,
    statusOptions,
    companyOptions,
    contractCountOptions,
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
    clearSort();
    clearSelection();
  };

  if (rows.length === 0 && !hasServerFilter) {
    return (
      <EmptyState
        icon={<Building2 className="h-6 w-6" />}
        title="Chưa có đối tác"
        description="Thêm đối tác để gắn vào hợp đồng và lọc theo đối tác."
        action={<AddPartnerButton />}
      />
    );
  }

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min((page - 1) * pageSize + rows.length, totalCount);

  return (
    <div className="space-y-3">
      {showServerSearch && (
        <form
          className="flex flex-wrap items-center gap-2"
          data-testid="partners-server-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(buildPartnersHref(pagination, { search: searchInput, page: 1 }));
          }}
        >
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Tìm toàn danh bạ (tên, MST, viết tắt, khu vực)..."
              className="pl-9 pr-8"
              data-testid="partners-server-search"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Xoá từ khoá tìm kiếm"
                data-testid="partners-server-search-clear"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearchInput("");
                  router.push(buildPartnersHref(pagination, { search: "", page: 1 }));
                }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="submit" variant="outline" size="sm">
            Tìm kiếm
          </Button>
        </form>
      )}
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
      <div className="rounded-2xl border border-border/80 shadow-sm bg-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent">
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
                    sortDirection={sortConfig.field === "name" ? sortConfig.direction : null}
                    onSort={(dir) => setSort("name", dir)}
                    onClearSort={clearSort}
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
                    sortDirection={sortConfig.field === "shortName" ? sortConfig.direction : null}
                    onSort={(dir) => setSort("shortName", dir)}
                    onClearSort={clearSort}
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
                    sortDirection={sortConfig.field === "taxCode" ? sortConfig.direction : null}
                    onSort={(dir) => setSort("taxCode", dir)}
                    onClearSort={clearSort}
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
                    sortDirection={sortConfig.field === "region" ? sortConfig.direction : null}
                    onSort={(dir) => setSort("region", dir)}
                    onClearSort={clearSort}
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
                    sortDirection={sortConfig.field === "status" ? sortConfig.direction : null}
                    onSort={(dir) => setSort("status", dir)}
                    onClearSort={clearSort}
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
                    label={COLUMN_LABELS.contractCount}
                    options={contractCountOptions}
                    selected={filters.contractCount}
                    onChange={(v) => {
                      const current = filters.contractCount;
                      const added = v.find((val) => !current.includes(val));
                      let next = v;
                      if (added === "zero") {
                        next = ["zero"];
                      } else if (added === "nonzero") {
                        next = ["nonzero"];
                      } else if (added != null) {
                        next = v.filter((val) => val !== "zero" && val !== "nonzero");
                      }
                      setColumnFilter("contractCount", next);
                    }}
                    mode="static"
                    testIdPrefix="partner-filter-contract-count"
                    sortDirection={sortConfig.field === "contractCount" ? sortConfig.direction : null}
                    onSort={(dir) => setSort("contractCount", dir)}
                    onClearSort={clearSort}
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
                    className="cursor-pointer hover:bg-emerald-500/[0.02] transition-colors"
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
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-xs font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20">
                          {row.name ? row.name.trim().charAt(0).toUpperCase() : "—"}
                        </div>
                        <Link
                          href={href}
                          className="hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {row.name}
                        </Link>
                      </div>
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground bg-muted/10">
          <p>
            {hasFilters
              ? `${filteredRows.length} / ${rows.length} đối tác${
                  pageCount > 1 ? ` (trang ${page}/${pageCount}, tổng ${totalCount})` : ""
                }`
              : pageCount > 1
                ? `Hiển thị ${from}–${to} trong ${totalCount} đối tác`
                : `${totalCount} đối tác`}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-2" data-testid="partners-pagination">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={page <= 1}
                data-testid="partners-page-prev"
                onClick={() => router.push(buildPartnersHref(pagination, { page: page - 1 }))}
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                Trước
              </Button>
              <span className="tabular-nums">
                Trang {page}/{pageCount}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={page >= pageCount}
                data-testid="partners-page-next"
                onClick={() => router.push(buildPartnersHref(pagination, { page: page + 1 }))}
              >
                Sau
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
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
