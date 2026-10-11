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

export const BLANK_VALUE = "__BLANK__";

export type SortField =
  | "name"
  | "shortName"
  | "taxCode"
  | "region"
  | "status"
  | "contractCount";

export type SortConfig = {
  field: SortField | null;
  direction: "asc" | "desc";
};

export const CONTRACT_COUNT_OPTIONS: Array<{ value: "all" | "zero" | "nonzero"; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "zero", label: "0 hợp đồng" },
  { value: "nonzero", label: "Có hợp đồng" },
];

/** Counts each distinct value in `values` and returns options sorted A→Z (vi). */
export function uniqueOptions(
  values: Array<string | null | undefined>,
  includeBlanks = false,
): Array<{ value: string; label?: string; count: number }> {
  const map = new Map<string, number>();
  let blankCount = 0;
  for (const v of values) {
    if (v == null || v === "") {
      blankCount += 1;
      continue;
    }
    const k = String(v);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const result: Array<{ value: string; label?: string; count: number }> = Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, "vi"));

  if (includeBlanks && blankCount > 0) {
    result.push({
      value: BLANK_VALUE,
      label: "(Trống / Chưa có)",
      count: blankCount,
    });
  }

  return result;
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
 * sorting, and filtered rows for the partners directory.
 */
export function usePartnerTableFilters(rows: PartnerWithCount[]) {
  const [filters, setFilters] = useState<PartnerFilters>(EMPTY_FILTERS);
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: null,
    direction: "asc",
  });

  // Option lists derived from the rows (with Blanks support for nullable fields)
  const nameOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.name)),
    [rows],
  );
  const abbrOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.abbreviation), true),
    [rows],
  );
  const taxCodeOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.tax_code), true),
    [rows],
  );
  const regionOptions = useMemo<FilterOption[]>(
    () => uniqueOptions(rows.map((row) => row.region), true),
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
    const filtered = rows.filter((row) => {
      if (filters.name.length > 0 && !filters.name.includes(row.name)) return false;
      if (filters.shortName.length > 0) {
        const hasBlank = filters.shortName.includes(BLANK_VALUE) && (!row.abbreviation || row.abbreviation === "");
        const hasMatch = filters.shortName.includes(row.abbreviation ?? "");
        if (!hasBlank && !hasMatch) return false;
      }
      if (filters.taxCode.length > 0) {
        const hasBlank = filters.taxCode.includes(BLANK_VALUE) && (!row.tax_code || row.tax_code === "");
        const hasMatch = filters.taxCode.includes(row.tax_code ?? "");
        if (!hasBlank && !hasMatch) return false;
      }
      if (filters.region.length > 0) {
        const hasBlank = filters.region.includes(BLANK_VALUE) && (!row.region || row.region === "");
        const hasMatch = filters.region.includes(row.region ?? "");
        if (!hasBlank && !hasMatch) return false;
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

    if (sortConfig.field) {
      const sorted = [...filtered];
      sorted.sort((a, b) => {
        let cmp = 0;
        switch (sortConfig.field) {
          case "name":
            cmp = a.name.localeCompare(b.name, "vi");
            break;
          case "shortName":
            cmp = (a.abbreviation ?? "").localeCompare(b.abbreviation ?? "", "vi");
            break;
          case "taxCode":
            cmp = (a.tax_code ?? "").localeCompare(b.tax_code ?? "", "vi");
            break;
          case "region":
            cmp = (a.region ?? "").localeCompare(b.region ?? "", "vi");
            break;
          case "status":
            cmp = a.status.localeCompare(b.status);
            break;
          case "contractCount":
            cmp = a.contract_count - b.contract_count;
            break;
        }
        return sortConfig.direction === "asc" ? cmp : -cmp;
      });
      return sorted;
    }

    return filtered;
  }, [rows, filters, sortConfig]);

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

  const setSort = (field: SortField, direction?: "asc" | "desc") => {
    setSortConfig((prev) => {
      const nextDir = direction ?? (prev.field === field && prev.direction === "asc" ? "desc" : "asc");
      return { field, direction: nextDir };
    });
  };

  const clearSort = () => {
    setSortConfig({ field: null, direction: "asc" });
  };

  return {
    filters,
    setFilters,
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
    setColumnFilter,
    clearAllFilters,
  };
}
