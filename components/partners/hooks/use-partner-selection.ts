"use client";

import { useMemo, useState } from "react";
import type { PartnerWithCount } from "@/lib/services/partners";

/**
 * Custom hook to manage row selection and bulk operations in the partners directory.
 */
export function usePartnerSelection(filteredRows: PartnerWithCount[]) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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

  const clearSelection = () => {
    setSelectedIds([]);
  };

  return {
    selectedIds,
    effectiveIds,
    selectedSet,
    allSelected,
    toggleRow,
    toggleAll,
    clearSelection,
  };
}
