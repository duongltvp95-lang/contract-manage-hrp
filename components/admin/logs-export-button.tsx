"use client";

import { FileSpreadsheet, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LogsFilter } from "@schemas/audit-log";

/**
 * Export buttons — round 3, part 1.
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
export function LogsExportButton({ filter }: { filter: LogsFilter }) {
  const query = buildQuery(filter);
  return (
    <div className="flex items-center gap-2" data-testid="logs-export">
      <Button asChild variant="outline" data-testid="logs-export-txt">
        <a
          href={`/api/admin/logs/export?${query}&format=txt`}
          download
          aria-label="Xuất nhật ký dạng văn bản"
        >
          <FileText className="mr-2 h-4 w-4" />
          Xuất .txt
        </a>
      </Button>
      <Button asChild variant="outline" data-testid="logs-export-xlsx">
        <a
          href={`/api/admin/logs/export?${query}&format=xlsx`}
          download
          aria-label="Xuất nhật ký dạng Excel"
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Xuất .xlsx
        </a>
      </Button>
    </div>
  );
}

function buildQuery(filter: LogsFilter): string {
  const params = new URLSearchParams();
  if (filter.actorId) params.set("actorId", filter.actorId);
  if (filter.action) params.set("action", filter.action);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  // Export ignores page/pageSize: the whole filtered set is downloaded.
  return params.toString();
}
