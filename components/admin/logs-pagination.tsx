"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LogsFilter } from "@schemas/audit-log";

const LOGS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function LogsPagination({
  filter,
  total,
  totalPages,
}: {
  filter: LogsFilter;
  total: number;
  totalPages: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const createHref = (newPage: number, newPageSize?: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(newPage));
    if (newPageSize) {
      next.set("pageSize", String(newPageSize));
    }
    const query = next.toString();
    return `/admin/logs${query ? `?${query}` : ""}`;
  };

  const from = total === 0 ? 0 : (filter.page - 1) * filter.pageSize + 1;
  const to = Math.min(filter.page * filter.pageSize, total);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 pt-2"
      data-testid="logs-pagination"
    >
      <p className="text-sm text-muted-foreground">
        Hiển thị {from}–{to} trong {total} dòng nhật ký
      </p>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="logsPageSize" className="text-sm text-muted-foreground">
            Mỗi trang
          </Label>
          <Select
            value={String(filter.pageSize)}
            onValueChange={(value) =>
              router.push(createHref(1, Number(value)))
            }
          >
            <SelectTrigger id="logsPageSize" className="w-[5.5rem]" data-testid="logs-pagesize-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOGS_PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={filter.page <= 1}
          onClick={() => router.push(createHref(filter.page - 1))}
          data-testid="logs-pagination-prev"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Trước
        </Button>

        <span className="text-sm tabular-nums">
          Trang {filter.page}/{totalPages}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={filter.page >= totalPages}
          onClick={() => router.push(createHref(filter.page + 1))}
          data-testid="logs-pagination-next"
        >
          Sau
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
