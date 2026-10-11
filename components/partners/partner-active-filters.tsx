"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  COLUMN_LABELS,
  CONTRACT_COUNT_OPTIONS,
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
              onClick={() => onClearColumn(key, [])}
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
            onClick={() => onClearColumn("contractCount", "all")}
          >
            ×
          </button>
        </Badge>
      )}
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
