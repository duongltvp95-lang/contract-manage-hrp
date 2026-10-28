import { AlertCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";

import { CompanyBadges } from "@/components/partners/partner-badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateOnly } from "@/lib/format";
import type { DashboardContractRow } from "@/lib/services/dashboard";

/**
 * Bảng hiển thị các hợp đồng không có ngày ký, không có ngày hết hạn
 * hoặc không giới hạn thời hạn trên trang tổng quan (Dashboard).
 * Có cảnh báo nổi bật yêu cầu người dùng kiểm tra lại thông tin ở ghi chú.
 */
function formatUndatedDuration(durationText?: string | null): string {
  const text = (durationText ?? "").trim();
  if (
    !text ||
    /không\s*giới\s*hạn|vô\s*thời\s*hạn|không\s*thời\s*hạn|không\s*xác\s*định/i.test(text)
  ) {
    return "Không xác định thời hạn";
  }
  return text;
}

export function UndatedContracts({ contracts }: { contracts: DashboardContractRow[] }) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        title="Không có hợp đồng nào cần lưu ý"
        description="Tất cả các hợp đồng hiện tại đều có đầy đủ ngày ký và ngày hết hạn xác định."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden shadow-xs bg-card">
      <Table data-testid="undated-contracts-table">
        <TableHeader className="bg-muted/30">
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-semibold text-xs">Số hợp đồng</TableHead>
            <TableHead className="font-semibold text-xs">Đối tác</TableHead>
            <TableHead className="font-semibold text-xs">Công ty</TableHead>
            <TableHead className="font-semibold text-xs">Ngày ký</TableHead>
            <TableHead className="font-semibold text-xs">Ngày hết hạn / Thời hạn</TableHead>
            <TableHead className="font-semibold text-xs min-w-[220px]">Ghi chú & Cảnh báo</TableHead>
            <TableHead className="font-semibold text-xs text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {contracts.map((contract) => {
            const hasSigned = Boolean(contract.signed_date);
            const hasExpiry = Boolean(contract.expiry_date);
            const hasNotes = Boolean(contract.notes && contract.notes.trim().length > 0);

            return (
              <TableRow key={contract.id} className="hover:bg-amber-500/[0.03] transition-colors">
                <TableCell className="font-medium whitespace-nowrap">
                  <Link
                    href={`/contracts/${contract.id}`}
                    className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    {contract.contract_number ?? "Chưa đặt số"}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[14rem] truncate font-medium">
                  {contract.partnerName ?? contract.partner_text ?? "—"}
                </TableCell>
                <TableCell>
                  {contract.companies.length > 0 ? (
                    <CompanyBadges companies={contract.companies} />
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {hasSigned ? (
                    <span className="text-sm text-foreground">
                      {formatDateOnly(contract.signed_date)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                      <AlertCircle className="h-3 w-3 text-amber-600 shrink-0" /> Chưa có ngày ký
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {hasExpiry ? (
                    <span className="text-sm text-foreground">
                      {formatDateOnly(contract.expiry_date)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-purple-500/15 text-purple-800 dark:text-purple-300 border border-purple-500/30">
                      {formatUndatedDuration(contract.duration_text)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {hasNotes ? (
                    <div className="flex flex-col gap-1 max-w-[22rem]">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        Cần kiểm tra lại:
                      </span>
                      <p
                        className="text-xs text-foreground/80 bg-muted/60 rounded-md px-2 py-1 border border-border/50 line-clamp-2 font-normal"
                        title={contract.notes ?? ""}
                      >
                        {contract.notes}
                      </p>
                    </div>
                  ) : (
                    <span className="inline-flex items-start gap-1.5 text-xs bg-rose-500/10 px-2.5 py-1.5 rounded-md border border-rose-500/20">
                      <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                      <span className="flex flex-col">
                        <span className="font-semibold text-rose-700 dark:text-rose-400">Cảnh báo</span>
                        <span className="text-rose-600/80 dark:text-rose-400/70 font-normal">Kiểm tra lại điều khoản hiệu lực hợp đồng</span>
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-7 text-xs text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 hover:bg-emerald-500/10"
                  >
                    <Link href={`/contracts/${contract.id}`}>Chi tiết</Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
