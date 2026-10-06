import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LogsFilterSchema } from "@schemas/audit-log";

import { LogsExportButton } from "@/components/admin/logs-export-button";
import { LogsFilterForm } from "@/components/admin/logs-filter-form";
import { LogsTable } from "@/components/admin/logs-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import {
  countAuditLogs,
  listAuditLogs,
} from "@/lib/services/audit-logs";

/**
 * Admin audit log — feature round 3, part 1.
 *
 * Two-tier access: the proxy already redirected anonymous / disabled accounts,
 * and the page refuses anyone who is not an administrator. The service layer
 * repeats the same check on every read, so a future "view logs" button on a
 * non-admin page would still 403.
 *
 * The page is a Server Component. The filter form and the table are the only
 * interactive bits; the table renders server-side, the form is a thin client
 * component that turns URL query strings into a GET. Export is a plain link
 * to the API route.
 */

async function AdminLogsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== "admin") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      raw[key] = value;
    } else if (Array.isArray(value) && value[0]) {
      raw[key] = value[0];
    }
  }
  const parsed = LogsFilterSchema.safeParse(raw);
  const filter = parsed.success
    ? parsed.data
    : { page: 1, pageSize: 50 } as const;

  const [list, count] = await Promise.all([
    listAuditLogs(user.organizationId, filter),
    countAuditLogs(user.organizationId, filter),
  ]);

  if (!list.ok) {
    return (
      <Alert variant="destructive" data-testid="logs-error">
        <AlertTitle>Không tải được nhật ký</AlertTitle>
        <AlertDescription>{list.message}</AlertDescription>
      </Alert>
    );
  }

  const total = count.ok ? count.data.total : list.data.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / filter.pageSize));

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Nhật ký quản trị</h1>
          <p className="text-sm text-muted-foreground">
            Tổng cộng {total} dòng. Mỗi dòng ghi lại một thao tác của quản trị
            viên trong tổ chức của bạn.
          </p>
        </div>
        <LogsExportButton filter={filter} />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Bộ lọc</CardTitle>
        </CardHeader>
        <CardContent>
          <LogsFilterForm initial={filter} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danh sách</CardTitle>
        </CardHeader>
        <CardContent>
          <LogsTable rows={list.data.rows} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground" data-testid="logs-pagination">
        Trang {filter.page} / {totalPages}
      </p>
    </div>
  );
}

export default function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<AdminLogsSkeleton />}>
      <AdminLogsContent searchParams={searchParams} />
    </Suspense>
  );
}

function AdminLogsSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32" />
      <Skeleton className="h-64" />
    </div>
  );
}
