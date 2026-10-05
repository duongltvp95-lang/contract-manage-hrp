"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  contractsHref,
  PAGE_SIZE_OPTIONS,
  type ContractsQuery,
  type PageSize,
} from "@/lib/contracts-query";

/**
 * Server-side pagination — plan section 53.
 *
 * Default 25 per page with 25/50/100 options; the page number and page size
 * live in the URL like every other piece of list state.
 */
export function ContractsPagination({
  query,
  total,
  pageCount,
  basePath = "/contracts",
}: {
  query: ContractsQuery;
  total: number;
  pageCount: number;
  /** Where this pagination lives; the partner page reuses it. */
  basePath?: string;
}) {
  const router = useRouter();

  const hrefFor = (patch: Partial<ContractsQuery>) => {
    const href = contractsHref(patch, query);
    return basePath === "/contracts" ? href : `${basePath}${href.slice("/contracts".length)}`;
  };

  const from = total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const to = Math.min(query.page * query.pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Hiển thị {from}–{to} trong {total} hợp đồng
      </p>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="pageSize" className="text-sm text-muted-foreground">
            Mỗi trang
          </Label>
          <Select
            value={String(query.pageSize)}
            onValueChange={(value) =>
              router.push(hrefFor({ pageSize: Number(value) as PageSize, page: 1 }))
            }
          >
            <SelectTrigger id="pageSize" className="w-[5.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
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
          disabled={query.page <= 1}
          onClick={() => router.push(hrefFor({ page: query.page - 1 }))}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Trước
        </Button>

        <span className="text-sm tabular-nums">
          Trang {query.page}/{pageCount}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={query.page >= pageCount}
          onClick={() => router.push(hrefFor({ page: query.page + 1 }))}
        >
          Sau
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
