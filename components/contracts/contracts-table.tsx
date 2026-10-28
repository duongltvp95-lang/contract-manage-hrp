"use client";

import { AlertTriangle, ArrowDown, ArrowUp, CalendarPlus, ChevronsUpDown, FilePlus2, Paperclip, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { CompanyBadges } from "@/components/partners/partner-badges";
import { BulkDeleteContractsButton } from "@/components/contracts/bulk-delete-contracts-button";
import { DeleteContractButton } from "@/components/contracts/delete-contract-button";
import { RenewContractDialog } from "@/components/contracts/renew-contract-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  contractsHref,
  hasActiveFilters,
  type ContractsQuery,
  type SortField,
} from "@/lib/contracts-query";
import { formatDateOnly, formatDateTime, formatDuration } from "@/lib/format";
import { partnerDisplayName } from "@/lib/partner-display";
import type { ContractListItem } from "@/lib/services/contracts";

/**
 * Contracts table — plan section 48.
 *
 * shadcn `Table` is enough: sorting, filtering and pagination are all
 * server-side, so there is nothing here that would justify TanStack Table
 * (plan section 49 — upgrade only when the table itself gets complex).
 *
 * Sortable columns: contract_number, signed_date, expiry_date, updated_at.
 * `partner_text` and `duration_text` are not sortable in Wave 1.
 */
export function ContractsTable({
  rows,
  query,
  total,
  basePath = "/contracts",
  emptyState,
  canDelete = false,
  scope = "active",
}: {
  rows: ContractListItem[];
  query: ContractsQuery;
  total: number;
  /**
   * Where this table lives. The partner detail page reuses it with
   * `basePath="/partners/<id>"`, so the sort links stay on that page instead of
   * throwing the user back to the full list.
   */
  basePath?: string;
  /** Replaces the default empty state (the partner page has its own wording). */
  emptyState?: ReactNode;
  /** Round 19 — show the delete action (delete-admin emails only). */
  canDelete?: boolean;
  /** Round 19/20 — preserved in the sort links. */
  scope?: "active" | "expired" | "expiring" | "archived" | "all" | "undated";
}) {
  const router = useRouter();
  // Round 24 — bulk selection. The page remounts this table with a `key` when
  // the tab/page/sort changes, so a selection never survives a list change.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectedSet = new Set(selectedIds);
  const allSelected =
    rows.length > 0 && rows.every((row) => selectedSet.has(row.id));

  const toggleRow = (id: string) => {
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((existing) => existing !== id)
        : [...previous, id],
    );
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : rows.map((row) => row.id));
  };

  const hrefFor = (patch: Partial<ContractsQuery>) => {
    let href = contractsHref(patch, query);
    if (scope && scope !== "active") {
      href = `${href}${href.includes("?") ? "&" : "?"}scope=${scope}`;
    }
    return basePath === "/contracts" ? href : `${basePath}${href.slice("/contracts".length)}`;
  };

  if (rows.length === 0) {
    return <>{emptyState ?? <ContractsEmptyState query={query} basePath={basePath} />}</>;
  }

  return (
    <div className="space-y-3">
      {canDelete && selectedIds.length > 0 && (
        <BulkDeleteContractsButton
          ids={selectedIds}
          onDone={() => setSelectedIds([])}
        />
      )}
      <div className="rounded-2xl border border-border/80 shadow-sm bg-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent">
              {canDelete && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Chọn tất cả hợp đồng"
                    data-testid="contract-select-all"
                  />
                </TableHead>
              )}
              <SortableHead
                field="contract_number"
                label="Số hợp đồng"
                query={query}
                hrefFor={hrefFor}
              />
            <TableHead>Đối tác</TableHead>
            <TableHead>Công ty</TableHead>
            <SortableHead
              field="signed_date"
              label="Ngày ký"
              query={query}
              hrefFor={hrefFor}
            />
            <TableHead>Thời hạn / Hết hạn</TableHead>
            <TableHead className="text-center">Tệp</TableHead>
            <SortableHead
              field="updated_at"
              label="Cập nhật"
              query={query}
              hrefFor={hrefFor}
            />
            {canDelete && <TableHead className="text-right">Thao tác</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = `/contracts/${row.id}`;
            const todayStr = format(new Date(), "yyyy-MM-dd");
            const isExpired = Boolean(row.expiry_date && row.expiry_date < todayStr);
            const partnerName = partnerDisplayName(row);
            const initial = partnerName && partnerName !== "—" ? partnerName.trim().charAt(0).toUpperCase() : null;

            return (
              <TableRow
                key={row.id}
                className="cursor-pointer hover:bg-emerald-500/[0.02] transition-colors"
                onClick={() => router.push(href)}
              >
                {canDelete && (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedSet.has(row.id)}
                      onCheckedChange={() => toggleRow(row.id)}
                      aria-label="Chọn hợp đồng"
                      data-testid={`contract-select-${row.id}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium">
                  {/* Real link so keyboard and screen-reader users can open the row. */}
                  <Link
                    href={href}
                    className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.contract_number ?? "(chưa có số)"}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[22rem]">
                  {/* The linked partner's name wins; the free-text column is the
                      fallback for contracts that predate the directory. */}
                  {partnerName !== "—" ? (
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-xs font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20">
                        {initial}
                      </div>
                      <span className="truncate">{partnerName}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.companies.length > 0 ? (
                    <CompanyBadges companies={row.companies} />
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDateOnly(row.signed_date)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {formatDuration(row.duration_text, row.signed_date, row.expiry_date)}
                    </span>
                    {isExpired && (
                      <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Badge
                          variant="outline"
                          className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] px-1.5 py-0 font-normal leading-normal"
                        >
                          Hết hạn
                        </Badge>
                        <RenewContractDialog
                          contract={{
                            id: row.id,
                            contract_number: row.contract_number,
                            signed_date: row.signed_date,
                            expiry_date: row.expiry_date,
                            duration_text: row.duration_text,
                          }}
                          trigger={
                            <button
                              type="button"
                              className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:underline font-medium inline-flex items-center gap-0.5"
                              title="Gia hạn hợp đồng này"
                            >
                              <CalendarPlus className="h-3 w-3" />
                              Gia hạn
                            </button>
                          }
                        />
                      </div>
                    )}
                  </div>
                  <div className={cn("text-xs mt-1", isExpired ? "text-red-600/90 dark:text-red-400/90 font-medium" : "text-muted-foreground")}>
                    {formatDateOnly(row.expiry_date)}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {row.file_count > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-xs font-medium text-foreground">
                      <Paperclip className="h-3 w-3 text-muted-foreground" />
                      {row.file_count}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Chưa có tệp
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(row.updated_at)}
                </TableCell>
                {canDelete && (
                  <TableCell
                    className="text-right"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DeleteContractButton contractId={row.id} />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
        </Table>
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground bg-muted/10">
          {total} hợp đồng
        </p>
      </div>
    </div>
  );
}

function SortableHead({
  field,
  label,
  query,
  hrefFor,
}: {
  field: SortField;
  label: string;
  query: ContractsQuery;
  hrefFor: (patch: Partial<ContractsQuery>) => string;
}) {
  const active = query.sort === field;
  // First click sorts ascending; clicking the active column flips it.
  const nextDir = active && query.dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ChevronsUpDown : query.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={hrefFor({ sort: field, dir: nextDir, page: 1 })}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {label}
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </Link>
    </TableHead>
  );
}

/** Plan section 82 — the two empty states read differently on purpose. */
function ContractsEmptyState({
  query,
  basePath,
}: {
  query: ContractsQuery;
  basePath: string;
}) {
  if (hasActiveFilters(query)) {
    return (
      <EmptyState
        icon={<SearchX className="h-6 w-6" />}
        title="Không tìm thấy hợp đồng phù hợp"
        description="Thử từ khoá khác hoặc bỏ bớt bộ lọc."
        action={
          <Button variant="outline" asChild>
            <Link href={basePath}>Xoá bộ lọc</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<FilePlus2 className="h-6 w-6" />}
      title="Chưa có hợp đồng"
      description="Tạo hợp đồng đầu tiên để bắt đầu quản lý."
      action={
        <Button asChild>
          <Link href="/contracts/new">
            <Plus className="mr-2 h-4 w-4" />
            Thêm hợp đồng
          </Link>
        </Button>
      }
    />
  );
}
