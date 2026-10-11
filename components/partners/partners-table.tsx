"use client";

import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AddPartnerButton, RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { CompanyBadges, PartnerStatusBadge } from "@/components/partners/partner-badges";
import { BulkDeletePartnersButton } from "@/components/partners/bulk-delete-partners-button";
import {
  ColumnFilterPopover,
  type FilterOption,
} from "@/components/partners/column-filter-popover";
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
import { PARTNER_STATUSES, PARTNER_STATUS_LABELS } from "@schemas/partner";
import type { PartnerWithCount } from "@/lib/services/partners";

/**
 * Partners table — feature round 2, part 2 + part 3.
 *
 * Columns: Tên đối tác · Tên viết tắt · Mã số thuế · Khu vực · Trạng thái ·
 * Công ty · Số hợp đồng, plus the "Sửa" action. Address is deliberately NOT in
 * the table — it can run to a couple of lines and would crowd the row; the
 * detail page carries it.
 *
 * Round 30 — client-side column filters (name / abbreviation / region contain,
 * folded; company select). The filters AND together and run on the rows the
 * server already narrowed (status tab). The bulk select-all operates on the
 * FILTERED list.
 *
 * Round 31 — responsive columns (T1 chốt breakpoints — không tự đổi):
 *   < sm  : Tên, Trạng thái, Thao tác (3 cột)
 *   sm    : + Tên viết tắt, MST (5 cột)
 *   md    : + Khu vực (6 cột)
 *   lg    : + Công ty (7 cột)
 *   xl    : + Số hợp đồng (đủ 8 cột — giữ hành vi hiện tại)
 * Header filter trigger ẩn cùng breakpoint với cột tương ứng (vì trigger nằm
 * bên trong <th> ẩn, không cần class riêng).
 *
 * Round 37 — Excel-style column filter popovers (7 cột: tên, viết tắt, MST,
 * khu vực, trạng thái, công ty, số hợp đồng). Mỗi header có icon
 * `ListFilter` + badge count; mở popover có search + multi-select checkbox +
 * "Chọn tất cả" / "Bỏ chọn"; click ngoài là áp dụng. AND giữa cột, OR trong
 * cùng cột. Chip strip trên đầu bảng liệt kê filter đang áp dụng + nút
 * "Xoá tất cả filter".
 */

type PartnerFilters = {
  name: string[];
  shortName: string[];
  taxCode: string[];
  region: string[];
  status: string[];
  company: string[];
  contractCount: "all" | "zero" | "nonzero";
};

const EMPTY_FILTERS: PartnerFilters = {
  name: [],
  shortName: [],
  taxCode: [],
  region: [],
  status: [],
  company: [],
  contractCount: "all",
};

/** Counts each distinct value in `values` and returns options sorted A→Z (vi). */
function uniqueOptions(
  values: Array<string | null | undefined>,
): Array<{ value: string; count: number }> {
  const map = new Map<string, number>();
  for (const v of values) {
    if (v == null || v === "") continue;
    const k = String(v);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, "vi"));
}

/** Same as uniqueOptions but takes the pre-flattened union of arrays. */
function uniqueOptionsFlattened(
  values: Array<Array<string> | null | undefined>,
): Array<{ value: string; count: number }> {
  const flat: string[] = [];
  for (const list of values) {
    if (!list) continue;
    for (const v of list) {
      if (v != null && v !== "") flat.push(v);
    }
  }
  return uniqueOptions(flat);
}

/** Human-readable label for a column, used in chips. */
const COLUMN_LABELS: Record<keyof Omit<PartnerFilters, "contractCount">, string> = {
  name: "Tên đối tác",
  shortName: "Tên viết tắt",
  taxCode: "Mã số thuế",
  region: "Khu vực",
  status: "Trạng thái",
  company: "Công ty",
};

const CONTRACT_COUNT_OPTIONS: Array<{ value: "all" | "zero" | "nonzero"; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "zero", label: "0 hợp đồng" },
  { value: "nonzero", label: "Có hợp đồng" },
];

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

  // Round 37 — Excel-style filters (client-only, not synced to URL).
  const [filters, setFilters] = useState<PartnerFilters>(EMPTY_FILTERS);

  // Option lists, derived from the rows the server already returned.
  const nameOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.name)),
    [rows],
  );
  const abbrOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.abbreviation)),
    [rows],
  );
  const taxCodeOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.tax_code)),
    [rows],
  );
  const regionOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.region)),
    [rows],
  );
  // Status: enum-driven options with the count coming from the rows so the
  // (12) / (4) figure is honest even after other filters narrow the list.
  // The popover shows the Vietnamese label, but the filter compares against
  // the schema enum token.
  const statusOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return PARTNER_STATUSES.map((status) => ({
      value: status,
      label: PARTNER_STATUS_LABELS[status],
      count: counts.get(status) ?? 0,
    }));
  }, [rows]);
  const companyOptions = useMemo<FilterOption[]>(
    () => uniqueOptionsFlattened(rows.map((row) => row.companies)),
    [rows],
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filters.name.length > 0 && !filters.name.includes(row.name)) return false;
      if (filters.shortName.length > 0 && !filters.shortName.includes(row.abbreviation ?? "")) {
        return false;
      }
      if (filters.taxCode.length > 0 && !filters.taxCode.includes(row.tax_code ?? "")) {
        return false;
      }
      if (filters.region.length > 0 && !filters.region.includes(row.region ?? "")) {
        return false;
      }
      if (filters.status.length > 0 && !filters.status.includes(row.status)) {
        return false;
      }
      if (filters.company.length > 0) {
        const overlap = row.companies.some((c) => filters.company.includes(c));
        if (!overlap) return false;
      }
      if (filters.contractCount === "zero" && row.contract_count !== 0) return false;
      if (filters.contractCount === "nonzero" && row.contract_count <= 0) return false;
      return true;
    });
  }, [rows, filters]);

  const filteredIdSet = useMemo(
    () => new Set(filteredRows.map((row) => row.id)),
    [filteredRows],
  );

  // The bulk action only ever targets VISIBLE (filtered) rows — a selection
  // that a filter hid can neither be deleted nor counted by accident.
  const effectiveIds = selectedIds.filter((id) => filteredIdSet.has(id));
  const selectedSet = new Set(selectedIds);
  const allSelected =
    filteredRows.length > 0 &&
    filteredRows.every((row) => selectedSet.has(row.id));

  const toggleRow = (id: string) => {
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((existing) => existing !== id)
        : [...previous, id],
    );
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : filteredRows.map((row) => row.id));
  };

  const hasFilters =
    filters.name.length > 0 ||
    filters.shortName.length > 0 ||
    filters.taxCode.length > 0 ||
    filters.region.length > 0 ||
    filters.status.length > 0 ||
    filters.company.length > 0 ||
    filters.contractCount !== "all";

  const setColumnFilter = <K extends keyof PartnerFilters>(key: K, value: PartnerFilters[K]) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  };

  const clearAllFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSelectedIds([]);
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
      {canDelete && effectiveIds.length > 0 && (
        <BulkDeletePartnersButton
          ids={effectiveIds}
          names={new Map(rows.map((row) => [row.id, row.name]))}
          onDone={() => setSelectedIds([])}
        />
      )}
      {hasFilters && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="partners-active-filters"
        >
          {(Object.keys(COLUMN_LABELS) as Array<keyof typeof COLUMN_LABELS>).map((key) => {
            const values = filters[key] as string[];
            if (values.length === 0) return null;
            const label = COLUMN_LABELS[key];
            const visible = values.slice(0, 3);
            const more = values.length - visible.length;
            const summary = visible.join(", ") + (more > 0 ? `, +${more} khác` : "");
            return (
              <Badge
                key={key}
                variant="secondary"
                className="gap-1"
                data-testid={`partners-active-filter-${key}`}
              >
                <span className="text-xs">
                  {label}: {summary}
                </span>
                <button
                  type="button"
                  aria-label={`Xoá filter ${label}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setColumnFilter(key, [])}
                >
                  ×
                </button>
              </Badge>
            );
          })}
          {filters.contractCount !== "all" && (
            <Badge
              variant="secondary"
              className="gap-1"
              data-testid="partners-active-filter-contract-count"
            >
              <span className="text-xs">
                Số hợp đồng:{" "}
                {CONTRACT_COUNT_OPTIONS.find((opt) => opt.value === filters.contractCount)?.label}
              </span>
              <button
                type="button"
                aria-label="Xoá filter số hợp đồng"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setColumnFilter("contractCount", "all")}
              >
                ×
              </button>
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
            data-testid="partners-clear-filters"
          >
            Xoá tất cả filter
          </Button>
        </div>
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
                      // ColumnFilterPopover's `toggle` always appends to the
                      // current selection, so a single-select switch (e.g.
                      // nonzero -> zero) briefly hands us ["nonzero", "zero"].
                      // We can't trust v[0] (it would re-pick the old value);
                      // read the previous filter and pick the candidate that
                      // differs from it, falling back to "all" when nothing
                      // is selected.
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
