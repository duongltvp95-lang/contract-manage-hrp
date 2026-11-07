"use client";

import { FileSpreadsheet, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AUDIT_LOGS_EXPORT_MAX_ROWS,
  type LogsFilter,
} from "@schemas/audit-log";

/**
 * Export buttons — round 3, part 1 (hardened in A12).
 *
 * Plain links to the API route, with the same filter query string. The browser
 * follows the link; the server replies with a `Content-Disposition: attachment`
 * header and the file downloads.
 *
 * No "loading" state is shown: the click is a navigation, and the browser is
 * already showing the page underneath. A spinner would add complexity for no
 * observable benefit (the buttons are visible while the download is in flight
 * on the very next page).
 */
export function LogsExportButton({
  filter,
  total,
}: {
  filter: LogsFilter;
  total?: number;
}) {
  const query = buildQuery(filter);
  const queryPrefix = query ? `${query}&` : "";
  const willTruncate =
    typeof total === "number" && total > AUDIT_LOGS_EXPORT_MAX_ROWS;

  return (
    <div className="flex flex-col items-end gap-1" data-testid="logs-export">
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" data-testid="logs-export-txt">
          <a
            href={`/api/admin/logs/export?${queryPrefix}format=txt`}
            download
            aria-label="Xuất nhật ký dạng văn bản"
          >
            <FileText className="mr-2 h-4 w-4" />
            Xuất .txt
          </a>
        </Button>
        <Button asChild variant="outline" data-testid="logs-export-xlsx">
          <a
            href={`/api/admin/logs/export?${queryPrefix}format=xlsx`}
            download
            aria-label="Xuất nhật ký dạng Excel"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Xuất .xlsx
          </a>
        </Button>
      </div>
      <p
        className={
          willTruncate
            ? "text-xs font-medium text-amber-700 dark:text-amber-400"
            : "text-xs text-muted-foreground"
        }
        data-testid="logs-export-cap-hint"
      >
        {willTruncate
          ? `Bộ lọc khớp ${total.toLocaleString("vi-VN")} dòng — mỗi lượt xuất tối đa ${AUDIT_LOGS_EXPORT_MAX_ROWS.toLocaleString("vi-VN")} dòng mới nhất (lọc theo ngày để xuất phần còn lại).`
          : `Xuất theo bộ lọc hiện tại (tối đa ${AUDIT_LOGS_EXPORT_MAX_ROWS.toLocaleString("vi-VN")} dòng/lượt).`}
      </p>
    </div>
  );
}

function buildQuery(filter: LogsFilter): string {
  const params = new URLSearchParams();
  if (filter.actorId) params.set("actorId", filter.actorId);
  if (filter.action) params.set("action", filter.action);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  // Export paginates up to AUDIT_LOGS_EXPORT_MAX_ROWS across the filtered set.
  return params.toString();
}
