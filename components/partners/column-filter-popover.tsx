"use client";

import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  ChevronDown,
  Filter,
  FilterX,
  Search,
  X,
} from "lucide-react";
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
 * Excel-Style Column AutoFilter Popover (Task nâng cấp UX).
 *
 * Mang lại trải nghiệm bộ lọc chuẩn Microsoft Excel / Google Sheets:
 * 1. Phân vùng Sắp xếp nhanh (Sort A→Z, Z→A).
 * 2. Ô tìm kiếm giá trị với icon kính lúp + nút (X) xoá nhanh.
 * 3. Danh sách Checkbox đa lựa chọn với "(Chọn tất cả)", hỗ trợ giá trị "(Trống)".
 * 4. Footer hành động rõ ràng: Xóa lọc, Đóng, Áp dụng.
 * 5. Tương thích 100% với toàn bộ data-testid và kịch bản Playwright e2e.
 */

export type FilterOption = {
  value: string;
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
  testIdPrefix?: string;
  sortDirection?: "asc" | "desc" | null;
  onSort?: (direction: "asc" | "desc") => void;
  onClearSort?: () => void;
};

const MAX_VISIBLE = 250;

export function ColumnFilterPopover({
  label,
  options,
  selected,
  onChange,
  mode = "search",
  placeholder = "Tìm giá trị…",
  testIdPrefix,
  sortDirection,
  onSort,
  onClearSort,
}: ColumnFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const isStatic = mode === "static";
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const isActive = selected.length > 0;
  const isSorted = Boolean(sortDirection);

  const visibleOptions = useMemo(() => {
    if (isStatic) return options;
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    return options.filter((option) => {
      const text = (option.label ?? option.value).toLowerCase();
      return text.includes(needle);
    });
  }, [options, query, isStatic]);

  const shouldCap = !isStatic && visibleOptions.length > MAX_VISIBLE;
  const renderedOptions = shouldCap
    ? visibleOptions.slice(0, MAX_VISIBLE)
    : visibleOptions;

  const allVisibleSelected =
    renderedOptions.length > 0 &&
    renderedOptions.every((option) => selectedSet.has(option.value));

  const someVisibleSelected =
    renderedOptions.some((option) => selectedSet.has(option.value)) &&
    !allVisibleSelected;

  const toggle = (value: string) => {
    let next: string[];
    if (selectedSet.has(value)) {
      next = selected.filter((existing) => existing !== value);
    } else {
      next = [...selected, value];
    }
    onChange(next);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleValueSet = new Set(renderedOptions.map((option) => option.value));
      onChange(selected.filter((value) => !visibleValueSet.has(value)));
      return;
    }
    const merged = new Set(selected);
    for (const option of renderedOptions) merged.add(option.value);
    onChange(Array.from(merged));
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Bộ lọc ${label}`}
          data-testid={testIdPrefix ? `${testIdPrefix}-trigger` : undefined}
          className={cn(
            "group relative inline-flex h-6 items-center gap-0.5 rounded px-1 text-xs font-medium transition-all select-none",
            "hover:bg-muted/80 hover:text-foreground",
            isActive
              ? "bg-primary/10 text-primary font-semibold ring-1 ring-primary/20"
              : "text-muted-foreground/70",
          )}
        >
          {isActive ? (
            <Filter className="h-3 w-3 text-primary" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity" />
          )}

          {isSorted && (
            <span className="text-[10px] text-primary font-bold">
              {sortDirection === "asc" ? "↑" : "↓"}
            </span>
          )}

          {isActive && (
            <Badge
              variant="default"
              className="ml-0.5 h-3.5 min-w-3.5 px-1 text-[9px] leading-none rounded-full"
            >
              {selected.length}
            </Badge>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-72 p-0 shadow-xl border-border/80 text-xs overflow-hidden"
        data-testid={testIdPrefix ? `${testIdPrefix}-popover` : undefined}
      >
        {/* Header popover */}
        <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30">
          <span className="font-semibold text-foreground">
            Lọc {label}
          </span>
          {isActive && (
            <span className="text-[10px] font-medium text-primary">
              Đang chọn {selected.length}
            </span>
          )}
        </div>

        {/* Section 1: Sắp xếp Excel A→Z / Z→A */}
        {onSort && (
          <div className="border-b p-1 space-y-0.5 bg-background">
            <button
              type="button"
              onClick={() => onSort("asc")}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors hover:bg-accent",
                sortDirection === "asc" && "bg-accent/80 font-semibold text-primary",
              )}
            >
              <div className="flex items-center gap-2">
                <ArrowUpAZ className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Sắp xếp A → Z (Tăng dần)</span>
              </div>
              {sortDirection === "asc" && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>

            <button
              type="button"
              onClick={() => onSort("desc")}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors hover:bg-accent",
                sortDirection === "desc" && "bg-accent/80 font-semibold text-primary",
              )}
            >
              <div className="flex items-center gap-2">
                <ArrowDownAZ className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Sắp xếp Z → A (Giảm dần)</span>
              </div>
              {sortDirection === "desc" && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>

            {isSorted && onClearSort && (
              <button
                type="button"
                onClick={onClearSort}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span>Khôi phục thứ tự mặc định</span>
              </button>
            )}
          </div>
        )}

        {/* Section 2: Ô tìm kiếm Excel */}
        {!isStatic && (
          <div className="p-2 border-b bg-muted/10">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                aria-label={`Tìm trong ${label}`}
                data-testid={testIdPrefix ? `${testIdPrefix}-search` : undefined}
                className="h-8 pl-8 pr-7 text-xs bg-background"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-2 h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Chọn tất cả & Danh sách Checkbox */}
        <div className="p-2">
          <label
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted transition-colors select-none font-medium text-foreground"
            data-testid={testIdPrefix ? `${testIdPrefix}-select-all` : undefined}
          >
            <Checkbox
              checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
              onCheckedChange={toggleAllVisible}
              aria-label="Chọn tất cả"
            />
            <span className="flex-1">(Chọn tất cả)</span>
            <span className="text-[10px] text-muted-foreground font-normal">
              {renderedOptions.length} mục
            </span>
          </label>

          <div className="my-1 h-px bg-border/60" />

          {/* Vùng cuộn danh sách */}
          <div
            className="max-h-56 overflow-y-auto pr-1 space-y-0.5 select-none"
            data-testid={testIdPrefix ? `${testIdPrefix}-list` : undefined}
          >
            {renderedOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Không tìm thấy giá trị phù hợp
              </div>
            ) : (
              renderedOptions.map((option) => {
                const isChecked = selectedSet.has(option.value);
                const isBlank = option.value === "__BLANK__";
                const displayLabel = option.label ?? option.value;
                const isStatusActive = option.value === "active";
                const isStatusStopped = option.value === "stopped";

                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/80 transition-colors text-xs",
                      isChecked && "bg-muted/40 font-medium",
                    )}
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

                    {/* Badge / dot cho trạng thái nếu có */}
                    {isStatusActive && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                    )}
                    {isStatusStopped && (
                      <span className="h-2 w-2 rounded-full bg-slate-400 inline-block" />
                    )}

                    <span
                      className={cn(
                        "flex-1 truncate",
                        isBlank && "italic text-muted-foreground font-normal",
                      )}
                    >
                      {displayLabel}
                    </span>

                    {typeof option.count === "number" && (
                      <span className="text-[10px] font-mono text-muted-foreground/80 px-1 py-0.5 bg-muted rounded">
                        {option.count}
                      </span>
                    )}
                  </label>
                );
              })
            )}

            {shouldCap && (
              <div className="py-1 px-2 text-center text-[10px] text-muted-foreground italic">
                Hiển thị {MAX_VISIBLE} kết quả đầu tiên. Nhập từ khóa để lọc thêm.
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Footer hành động chuẩn Excel */}
        <div className="border-t p-2 bg-muted/20 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={clearAll}
            disabled={!isActive}
            data-testid={testIdPrefix ? `${testIdPrefix}-clear` : undefined}
          >
            <FilterX className="h-3 w-3 mr-1" />
            Xoá lọc
          </Button>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setOpen(false)}
            >
              Đóng
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setOpen(false)}
            >
              Áp dụng
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
