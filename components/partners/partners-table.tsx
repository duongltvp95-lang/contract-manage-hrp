"use client";

import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AddPartnerButton, RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { CompanyBadges, PartnerStatusBadge } from "@/components/partners/partner-badges";
import { BulkDeletePartnersButton } from "@/components/partners/bulk-delete-partners-button";
import { DeletePartnerButton } from "@/components/partners/delete-partner-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { foldText } from "@/lib/partner-display";
import type { PartnerWithCount } from "@/lib/services/partners";

/**
 * Partners table — feature round 2, part 2 + part 3.
 *
 * Columns: Tên đối tác · Tên viết tắt · Mã số thuế · Khu vực · Trạng thái ·
 * Công ty · Số hợp đồng, plus the "Sửa" action. Address is deliberately NOT in
 * the table — it can run to a couple of lines and would crowd the row; the
 * detail page carries it.
 *
 * Round 30 — client-side column filters (name / abbreviation / region contain,
 * folded; company select). The filters AND together and run on the rows the
 * server already narrowed (status tab + contract-count filter). The bulk
 * select-all operates on the FILTERED list.
 */
export function PartnersTable({
  rows,
  canDelete = false,
}: {
  rows: PartnerWithCount[];
  canDelete?: boolean;
}) {
  const router = useRouter();
  // Round 24 — bulk selection. The page remounts this table with a `key` when
  // the tab changes, so a selection never survives a list change.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Round 30 — the client-side column filters.
  const [nameFilter, setNameFilter] = useState("");
  const [abbrFilter, setAbbrFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");

  const companyOptions = useMemo(
    () => [...new Set(rows.flatMap((row) => row.companies))].sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const name = foldText(nameFilter);
    const abbr = foldText(abbrFilter);
    const region = foldText(regionFilter);

    return rows.filter((row) => {
      if (name && !foldText(row.name).includes(name)) return false;
      if (abbr && !foldText(row.abbreviation ?? "").includes(abbr)) return false;
      if (region && !foldText(row.region ?? "").includes(region)) return false;
      if (companyFilter !== "all" && !row.companies.includes(companyFilter)) {
        return false;
      }
      return true;
    });
  }, [rows, nameFilter, abbrFilter, regionFilter, companyFilter]);

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

  const hasFilters =
    nameFilter !== "" ||
    abbrFilter !== "" ||
    regionFilter !== "" ||
    companyFilter !== "all";

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-6 w-6" />}
        title="Chưa có đối tác"
        description="Thêm đối tác để gắn vào hợp đồng và lọc theo đối tác."
        action={
          <AddPartnerButton />
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {canDelete && effectiveIds.length > 0 && (
        <BulkDeletePartnersButton
          ids={effectiveIds}
          names={new Map(rows.map((row) => [row.id, row.name]))}
          onDone={() => setSelectedIds([])}
        />
      )}
      <div className="rounded-xl shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Chọn tất cả đối tác"
                    data-testid="partner-select-all"
                  />
                </TableHead>
              )}
              <TableHead>
                Tên đối tác
                <Input
                  value={nameFilter}
                  onChange={(event) => setNameFilter(event.target.value)}
                  placeholder="Lọc theo tên"
                  aria-label="Lọc theo tên đối tác"
                  className="mt-1 h-7 max-w-44 text-xs font-normal"
                  data-testid="partner-filter-name"
                />
              </TableHead>
              <TableHead>
                Tên viết tắt
                <Input
                  value={abbrFilter}
                  onChange={(event) => setAbbrFilter(event.target.value)}
                  placeholder="Lọc viết tắt"
                  aria-label="Lọc theo tên viết tắt"
                  className="mt-1 h-7 max-w-32 text-xs font-normal"
                  data-testid="partner-filter-abbr"
                />
              </TableHead>
              <TableHead>Mã số thuế</TableHead>
              <TableHead>
                Khu vực
                <Input
                  value={regionFilter}
                  onChange={(event) => setRegionFilter(event.target.value)}
                  placeholder="Lọc khu vực"
                  aria-label="Lọc theo khu vực"
                  className="mt-1 h-7 max-w-36 text-xs font-normal"
                  data-testid="partner-filter-region"
                />
              </TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead>
                Công ty
                <Select
                  value={companyFilter}
                  onValueChange={setCompanyFilter}
                >
                  <SelectTrigger
                    className="mt-1 h-7 w-full min-w-28 max-w-36 text-xs font-normal"
                    aria-label="Lọc theo công ty"
                    data-testid="partner-filter-company"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    {companyOptions.map((company) => (
                      <SelectItem key={company} value={company}>
                        {company}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableHead>
              <TableHead className="text-center">Số hợp đồng</TableHead>
              <TableHead className="text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canDelete ? 9 : 8}
                  className="py-10 text-center text-sm text-muted-foreground"
                  data-testid="partners-filter-empty"
                >
                  Không có đối tác nào khớp bộ lọc
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                const href = `/partners/${row.id}`;

                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(href)}
                    data-testid="partner-row"
                    data-partner-name={row.name}
                    data-partner-tax-code={row.tax_code ?? ""}
                  >
                    {canDelete && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedSet.has(row.id)}
                          onCheckedChange={() => toggleRow(row.id)}
                          aria-label="Chọn đối tác"
                          data-testid={`partner-select-${row.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">
                      {/* A real link, so the row is reachable by keyboard too. */}
                      <Link
                        href={href}
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    {/* Round 26 — the abbreviation lives in its own column. */}
                    <TableCell
                      className="font-mono text-sm text-muted-foreground"
                      data-testid={`partner-abbr-cell-${row.id}`}
                    >
                      {row.abbreviation ?? ""}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {row.tax_code ? (
                        row.tax_code
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.region ?? ""}
                    </TableCell>
                    <TableCell>
                      <PartnerStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <CompanyBadges companies={row.companies} />
                    </TableCell>
                    <TableCell className="text-center">
                      {row.contract_count > 0 ? (
                        <Badge variant="secondary" data-testid="partner-contract-count">
                          {row.contract_count}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1">
                        <RenamePartnerButton partner={row} />
                        {canDelete && <DeletePartnerButton partnerId={row.id} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {hasFilters
            ? `${filteredRows.length} / ${rows.length} đối tác`
            : `${rows.length} đối tác`}
        </p>
      </div>
    </div>
  );
}

/** The empty state for a partner that has no contracts yet. */
export function NoPartnerContractsEmptyState() {
  return (
    <EmptyState
      icon={<Building2 className="h-6 w-6" />}
      title="Chưa có hợp đồng với đối tác này"
      description="Tạo hợp đồng và chọn đối tác này để nó xuất hiện ở đây."
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
