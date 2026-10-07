import { AlertCircle, Clock, FileText } from "lucide-react";
import { Suspense } from "react";

import { ExpiringContracts } from "@/components/dashboard/expiring-contracts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RecentContracts } from "@/components/dashboard/recent-contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import {
  DASHBOARD_LIST_LIMIT,
  expiringWindowBounds,
  getContractMetrics,
  getExpiringContracts,
  getRecentContracts,
} from "@/lib/services/dashboard";

/**
 * Dashboard — plan sections 67, 68, 69, 70; W1-WEB-033.
 *
 * Three cards and two tables. **No chart** (plan section 67 and the owner
 * decision for M7), so no charting library is installed.
 *
 * The expiry arithmetic is not defined here: `getContractMetrics()` and
 * `getExpiringContracts()` both use `resolveExpiryPreset()` from
 * `lib/contracts-query.ts`, which is the same function behind the contracts-list
 * filter. One definition of "expiring soon" means the dashboard count and the
 * filtered list can never disagree.
 *
 * All three queries run in parallel; a failure in any of them is surfaced as one
 * Alert while the rest of the page still renders, because a dashboard half full
 * of real numbers is more useful than an error page.
 */

async function DashboardContent() {
  const user = await requireUser();

  const [metrics, recent, expiring] = await Promise.all([
    getContractMetrics(user.organizationId),
    getRecentContracts(user.organizationId, DASHBOARD_LIST_LIMIT),
    getExpiringContracts(user.organizationId, new Date(), DASHBOARD_LIST_LIMIT),
  ]);

  const failure = !metrics.ok ? metrics : !recent.ok ? recent : !expiring.ok ? expiring : null;
  const window = expiringWindowBounds();

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Tổng quan</h1>
        <p className="text-sm text-muted-foreground">
          Xin chào, {user.fullName ?? user.email}
        </p>
      </header>

      {failure && (
        <Alert variant="destructive">
          <AlertTitle>Không đọc được số liệu tổng quan</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          testId="metric-total"
          title="Tổng hợp đồng"
          value={metrics.ok ? metrics.data.total : "—"}
          hint="Không tính hợp đồng đã lưu trữ"
          icon={<FileText className="h-6 w-6" />}
        />
        <MetricCard
          testId="metric-expiring-soon"
          title="Sắp hết hạn"
          value={metrics.ok ? metrics.data.expiringSoon : "—"}
          hint={`Từ ${window.from} đến ${window.to}`}
          tone="warning"
          icon={<Clock className="h-6 w-6" />}
        />
        <MetricCard
          testId="metric-expired"
          title="Đã hết hạn"
          value={metrics.ok ? metrics.data.expired : "—"}
          hint={`Ngày hết hạn trước ${window.from}`}
          tone="danger"
          icon={<AlertCircle className="h-6 w-6" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hợp đồng gần đây</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.ok ? (
            <RecentContracts contracts={recent.data} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Không tải được danh sách hợp đồng gần đây.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hợp đồng sắp hết hạn</CardTitle>
        </CardHeader>
        <CardContent>
          {expiring.ok ? (
            <ExpiringContracts contracts={expiring.data} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Không tải được danh sách hợp đồng sắp hết hạn.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

/** Plan section 81 — the dashboard's loading state. */
function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-[7.5rem]" />
        ))}
      </div>

      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
    </div>
  );
}
