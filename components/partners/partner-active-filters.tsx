"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BLANK_VALUE,
  COLUMN_LABELS,
  type PartnerFilters,
} from "@/components/partners/hooks/use-partner-table-filters";

/**
 * Chip strip displaying active column filters with individual removal and "clear all" actions.
 */
export function PartnerActiveFilters({
  filters,
  onClearColumn,
  onClearAll,
}: {
  filters: PartnerFilters;
  onClearColumn: <K extends keyof PartnerFilters>(key: K, value: PartnerFilters[K]) => void;
  onClearAll: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="partners-active-filters"
    >
      {(Object.keys(COLUMN_LABELS) as Array<keyof typeof COLUMN_LABELS>).map((key) => {
        const values = filters[key];
        if (values.length === 0) return null;
        const label = COLUMN_LABELS[key];
        const displayValues = values.map((v) => {
          if (v === BLANK_VALUE) return "(Trống)";
          if (key === "contractCount") {
            if (v === "zero") return "0 hợp đồng";
            if (v === "nonzero") return "Có hợp đồng";
            return `${v} hợp đồng`;
          }
          return v;
        });
        const visible = displayValues.slice(0, 3);
        const more = displayValues.length - visible.length;
        const summary = visible.join(", ") + (more > 0 ? `, +${more} khác` : "");
        const testId =
          key === "contractCount"
            ? "partners-active-filter-contract-count"
            : `partners-active-filter-${key}`;

        return (
          <Badge
            key={key}
            variant="secondary"
            className="gap-1"
            data-testid={testId}
          >
            <span className="text-xs">
              {label}: {summary}
            </span>
            <button
              type="button"
              aria-label={`Xoá filter ${label}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onClearColumn(key, [])}
            >
              ×
            </button>
          </Badge>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClearAll}
        data-testid="partners-clear-filters"
      >
        Xoá tất cả filter
      </Button>
    </div>
  );
}
