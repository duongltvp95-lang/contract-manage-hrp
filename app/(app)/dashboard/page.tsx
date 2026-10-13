import { AlertCircle, ArrowUpRight, Clock, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ExpiringContracts } from "@/components/dashboard/expiring-contracts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RecentContracts } from "@/components/dashboard/recent-contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { formatDateOnly } from "@/lib/format";
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
      <header className="flex flex-wrap items-center justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Tổng quan</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Hệ thống ổn định
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Xin chào, <span className="font-medium text-foreground">{user.fullName ?? user.email}</span> · Theo dõi hợp đồng theo thời gian thực
          </p>
        </div>
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
          badgeText={metrics.ok ? `${metrics.data.active} còn hiệu lực` : undefined}
          hint="Không tính hợp đồng đã lưu trữ"
          icon={<FileText className="h-5 w-5" />}
        />
        <MetricCard
          testId="metric-expiring-soon"
          title="Sắp hết hạn"
          value={metrics.ok ? metrics.data.expiringSoon : "—"}
          badgeText="Trong 90 ngày"
          hint={`Từ ${formatDateOnly(window.from)} đến ${formatDateOnly(window.to)}`}
          tone="warning"
          icon={<Clock className="h-5 w-5" />}
        />
        <MetricCard
          testId="metric-expired"
          title="Đã hết hạn"
          value={metrics.ok ? metrics.data.expired : "—"}
          badgeText={metrics.ok && metrics.data.expired > 0 ? "Cần xử lý" : undefined}
          hint={`Ngày hết hạn trước ${formatDateOnly(window.from)}`}
          tone="danger"
          icon={<AlertCircle className="h-5 w-5" />}
        />
      </div>

      <Card className="rounded-2xl border border-border/80 shadow-sm bg-card overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/40">
          <CardTitle className="text-base font-semibold tracking-tight">Hợp đồng gần đây</CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground hover:text-emerald-600 gap-1 h-8">
            <Link href="/contracts">
              Xem tất cả <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
          {recent.ok ? (
            <RecentContracts contracts={recent.data} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Không tải được danh sách hợp đồng gần đây.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border/80 shadow-sm bg-card overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/40">
          <CardTitle className="text-base font-semibold tracking-tight">Hợp đồng sắp hết hạn</CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground hover:text-emerald-600 gap-1 h-8">
            <Link href="/contracts?preset=d90">
              Xem tất cả <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
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
