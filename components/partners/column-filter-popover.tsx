"use client";

import { ListFilter } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Round 37 — Excel-style column filter popover for the partners list.
 *
 * Trigger: a `ListFilter` icon on a table header. When at least one value is
 * selected the icon turns primary and a small badge carries the count. The
 * popover itself contains a search input (when `mode="search"`), a
 * "Chọn tất cả" master checkbox, a scrollable list of option checkboxes, and
 * a "Bỏ chọn" button. Radix closes on outside click; the parent owns the
 * selection, so applying is automatic — no extra "Áp dụng" button.
 *
 * The component is intentionally generic (no partner-specific copy) so future
 * tables can reuse it without copy-paste.
 */
export type FilterOption = {
  /**
   * The stable identifier used by the consumer to compare against its data
   * (e.g. an enum token like "active" or a normalised company name).
   */
  value: string;
  /**
   * The text shown in the popover row. Defaults to `value` when omitted —
   * useful when the human label and the comparison token are the same
   * (e.g. a free-text partner name).
   */
  label?: string;
  count?: number;
};

export type ColumnFilterPopoverProps = {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  mode?: "search" | "static";
  placeholder?: string;
  /** Optional testid prefix for the trigger button. */
  testIdPrefix?: string;
};

const MAX_VISIBLE = 200;

export function ColumnFilterPopover({
  label,
  options,
  selected,
  onChange,
  mode = "search",
  placeholder = "Tìm kiếm…",
  testIdPrefix,
}: ColumnFilterPopoverProps) {
  const [query, setQuery] = useState("");
  const isStatic = mode === "static";
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const isActive = selected.length > 0;

  const visibleOptions = useMemo(() => {
    if (isStatic) return options;
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    return options.filter((option) =>
      option.value.toLowerCase().includes(needle),
    );
  }, [options, query, isStatic]);

  // Static mode always renders the full list — usually only 2–3 entries.
  // Search mode caps the rendered list at MAX_VISIBLE and asks the user to
  // narrow the query.
  const shouldCap = !isStatic && visibleOptions.length > MAX_VISIBLE;
  const renderedOptions = shouldCap
    ? visibleOptions.slice(0, MAX_VISIBLE)
    : visibleOptions;

  const allVisibleSelected =
    renderedOptions.length > 0 &&
    renderedOptions.every((option) => selectedSet.has(option.value));

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((existing) => existing !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      // Drop only the visible options, keep any selection that lives outside
      // the current view (e.g. a previous query that hid them).
      const visibleValueSet = new Set(renderedOptions.map((option) => option.value));
      onChange(selected.filter((value) => !visibleValueSet.has(value)));
      return;
    }
    // Union: keep existing, add every visible option that is not yet present.
    const merged = new Set(selected);
    for (const option of renderedOptions) merged.add(option.value);
    onChange(Array.from(merged));
  };

  const clearAll = () => onChange([]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Lọc theo ${label}`}
          data-testid={testIdPrefix ? `${testIdPrefix}-trigger` : undefined}
          className={cn(
            "relative inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isActive && "text-primary",
          )}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          {isActive && (
            <Badge
              variant="default"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] leading-none"
            >
              {selected.length}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-2"
        data-testid={testIdPrefix ? `${testIdPrefix}-popover` : undefined}
      >
        {!isStatic && (
          <div className="px-1 pb-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              aria-label={`Tìm trong ${label}`}
              data-testid={testIdPrefix ? `${testIdPrefix}-search` : undefined}
              className="h-8 text-sm"
            />
          </div>
        )}

        <label
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
          data-testid={testIdPrefix ? `${testIdPrefix}-select-all` : undefined}
        >
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={toggleAllVisible}
            aria-label="Chọn tất cả"
          />
          <span className="font-medium">Chọn tất cả</span>
        </label>

        <div className="my-1 h-px bg-border" />

        <div
          className="max-h-72 overflow-auto"
          data-testid={testIdPrefix ? `${testIdPrefix}-list` : undefined}
        >
          {renderedOptions.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              Không có tuỳ chọn
            </div>
          ) : (
            renderedOptions.map((option) => {
              const isChecked = selectedSet.has(option.value);
              const displayLabel = option.label ?? option.value;
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle(option.value)}
                    aria-label={displayLabel}
                    data-testid={
                      testIdPrefix
                        ? `${testIdPrefix}-option-${option.value}`
                        : undefined
                    }
                  />
                  <span className="flex-1 truncate">{displayLabel}</span>
                  {typeof option.count === "number" && (
                    <span className="text-xs text-muted-foreground">
                      ({option.count})
                    </span>
                  )}
                </label>
              );
            })
          )}
          {shouldCap && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              Nhập thêm để thu hẹp kết quả
            </div>
          )}
        </div>

        <div className="mt-2 border-t pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={clearAll}
            disabled={selected.length === 0}
            data-testid={testIdPrefix ? `${testIdPrefix}-clear` : undefined}
          >
            Bỏ chọn
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
