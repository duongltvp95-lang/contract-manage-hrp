"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { PartnerOption } from "./partner-combobox";

/**
 * One row in the combobox popover.
 *
 * Round 33 removed the per-row company fetch (round 32's `IntersectionObserver`
 * plus `partnerCompaniesAction`) and the company badge from the row: the
 * company is now a separate `<Select>` field in the contract form, and asking
 * the server "which companies is this partner linked to" for every row the user
 * can see is exactly the latency round 33 was filed about.
 *
 * The row is still its own component — it keeps the check mark, the name and the
 * tax code in one place, and it is the element `data-testid="partner-option"`
 * hangs off.
 */
export function PartnerOptionRow({
  option,
  isSelected,
  onSelect,
}: {
  option: PartnerOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="partner-option"
      data-partner-id={option.id}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
    >
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          isSelected ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="block truncate">{option.name}</span>
        {option.tax_code ? (
          <span className="block truncate text-xs text-muted-foreground">
            MST {option.tax_code}
          </span>
        ) : null}
      </span>
    </button>
  );
}