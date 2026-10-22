"use client";

import {
  AUDIT_ACTION_LABELS,
  AUDIT_TARGET_KIND_LABELS,
} from "@schemas/audit-log";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAuditSentence } from "@/lib/audit-display";
import type { AuditLogRow } from "@/lib/services/audit-logs";

/**
 * Audit log table — round 3, part 1; round 8, part 2; round 9, part 2.
 *
 * The actor is shown by name (`actorName`, resolved by `listAuditLogs`) rather
 * than a truncated UUID; a missing name becomes "[Người dùng đã xoá]". The
 * detail column is a natural Vietnamese sentence (`formatAuditSentence`) instead
 * of a metadata key/value summary.
 */
export function LogsTable({ rows }: { rows: AuditLogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="logs-empty">
        Chưa có dòng nhật ký nào khớp bộ lọc.
      </p>
    );
  }

  return (
    <div className="rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm" data-testid="logs-table">
        <thead>
          <tr className="border-b bg-gray-50 text-left dark:bg-gray-900">
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Thời gian</th>
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Người thực hiện</th>
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Hành động</th>
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Đối tượng</th>
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Chi tiết</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-testid="logs-row"
              className="border-b transition-colors last:border-0 hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              <td className="px-3 py-2 font-mono text-xs">
                {formatDateTime(row.createdAt)}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm text-foreground" title={row.actorId}>
                      {row.actorName || row.actorEmail || "[Người dùng đã xoá]"}
                    </span>
                    <Badge variant="outline" className="text-[11px] px-1.5 py-0">
                      {row.actorRole}
                    </Badge>
                  </div>
                  {row.actorEmail && row.actorName && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {row.actorEmail}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                {AUDIT_ACTION_LABELS[row.action] ?? row.action}
              </td>
              <td className="px-3 py-2">
                <span className="font-mono text-xs">
                  {AUDIT_TARGET_KIND_LABELS[row.targetKind] ?? row.targetKind}
                  {row.targetId ? ` · ${row.targetId.slice(0, 8)}…` : ""}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="break-words text-xs">
                  {formatAuditSentence(row)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Skeleton kept here so the page that loads it does not need a separate import. */
export function LogsTableSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}
