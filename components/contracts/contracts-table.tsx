"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, FilePlus2, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDateOnly, formatDateTime } from "@/lib/format";
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
}) {
  const router = useRouter();

  const hrefFor = (patch: Partial<ContractsQuery>) => {
    const href = contractsHref(patch, query);
    return basePath === "/contracts" ? href : `${basePath}${href.slice("/contracts".length)}`;
  };

  if (rows.length === 0) {
    return <>{emptyState ?? <ContractsEmptyState query={query} basePath={basePath} />}</>;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              field="contract_number"
              label="Số hợp đồng"
              query={query}
              hrefFor={hrefFor}
            />
            <TableHead>Đối tác</TableHead>
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = `/contracts/${row.id}`;
            return (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(href)}
              >
                <TableCell className="font-medium">
                  {/* Real link so keyboard and screen-reader users can open the row. */}
                  <Link
                    href={href}
                    className="hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.contract_number ?? "(chưa có số)"}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[22rem] truncate">
                  {/* The linked partner's name wins; the free-text column is the
                      fallback for contracts that predate the directory. */}
                  {partnerDisplayName(row)}
                </TableCell>
                <TableCell>{formatDateOnly(row.signed_date)}</TableCell>
                <TableCell>
                  <div>{row.duration_text ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateOnly(row.expiry_date)}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {row.file_count > 0 ? (
                    <Badge variant="secondary">{row.file_count}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(row.updated_at)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {total} hợp đồng
      </p>
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
