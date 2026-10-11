"use client";

import { useMemo, useState } from "react";
import type { FilterOption } from "@/components/partners/column-filter-popover";
import { PARTNER_STATUSES, PARTNER_STATUS_LABELS } from "@schemas/partner";
import type { PartnerWithCount } from "@/lib/services/partners";

/**
 * Filter state definition for the Partners table.
 */
export type PartnerFilters = {
  name: string[];
  shortName: string[];
  taxCode: string[];
  region: string[];
  status: string[];
  company: string[];
  contractCount: "all" | "zero" | "nonzero";
};

export const EMPTY_FILTERS: PartnerFilters = {
  name: [],
  shortName: [],
  taxCode: [],
  region: [],
  status: [],
  company: [],
  contractCount: "all",
};

/** Human-readable label for a column, used in chips. */
export const COLUMN_LABELS: Record<keyof Omit<PartnerFilters, "contractCount">, string> = {
  name: "Tên đối tác",
  shortName: "Tên viết tắt",
  taxCode: "Mã số thuế",
  region: "Khu vực",
  status: "Trạng thái",
  company: "Công ty",
};

export const CONTRACT_COUNT_OPTIONS: Array<{ value: "all" | "zero" | "nonzero"; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "zero", label: "0 hợp đồng" },
  { value: "nonzero", label: "Có hợp đồng" },
];

/** Counts each distinct value in `values` and returns options sorted A→Z (vi). */
export function uniqueOptions(
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
export function uniqueOptionsFlattened(
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

/**
 * Custom hook to manage all column filters, derived option lists,
 * and filtered rows for the partners directory.
 */
export function usePartnerTableFilters(rows: PartnerWithCount[]) {
  const [filters, setFilters] = useState<PartnerFilters>(EMPTY_FILTERS);

  // Option lists derived from the rows
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
  };

  return {
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
  };
}
