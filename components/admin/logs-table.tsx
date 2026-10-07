"use client";

import {
  AUDIT_ACTION_LABELS,
  AUDIT_TARGET_KIND_LABELS,
} from "@schemas/audit-log";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAuditMetadata } from "@/lib/audit-display";
import type { AuditLogRow } from "@/lib/services/audit-logs";

/**
 * Audit log table — round 3, part 1; round 8, part 2.
 *
 * The actor's email is not stored on the row (only the profile id), so the
 * table falls back to a truncated id. The admin-only join lives in
 * `getActorEmail()` in a future round; for now, the row carries what it has.
 *
 * Action and target kind are localised through the shared label maps, and
 * `metadata` is rendered as a compact summary (`formatAuditMetadata`) rather
 * than a raw JSON blob.
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
    <div className="rounded-md border">
      <table className="w-full text-sm" data-testid="logs-table">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            <th className="px-3 py-2 font-medium">Thời gian</th>
            <th className="px-3 py-2 font-medium">Người thực hiện</th>
            <th className="px-3 py-2 font-medium">Hành động</th>
            <th className="px-3 py-2 font-medium">Đối tượng</th>
            <th className="px-3 py-2 font-medium">Chi tiết</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-testid="logs-row"
              className="border-b last:border-0"
            >
              <td className="px-3 py-2 font-mono text-xs">
                {formatDateTime(row.createdAt)}
              </td>
              <td className="px-3 py-2">
                <span className="font-mono text-xs" title={row.actorId}>
                  {row.actorId.slice(0, 8)}…
                </span>
                <Badge variant="outline" className="ml-2">
                  {row.actorRole}
                </Badge>
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
                <span className="break-all text-xs">
                  {formatAuditMetadata(row.metadata)}
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
