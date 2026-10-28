import { AlertCircle, AlertTriangle, ArrowUpRight, Clock, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ExpiringContracts } from "@/components/dashboard/expiring-contracts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RecentContracts } from "@/components/dashboard/recent-contracts";
import { UndatedContracts } from "@/components/dashboard/undated-contracts";
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
  getUndatedContracts,
} from "@/lib/services/dashboard";

/**
 * Dashboard — plan sections 67, 68, 69, 70; W1-WEB-033; Round 48.
 *
 * Four metric cards and three contract tables:
 * 1. Recent Contracts
 * 2. Expiring Contracts (within 90 days)
 * 3. Undated / Indefinite Contracts (needs check in notes)
 */

async function DashboardContent() {
  const user = await requireUser();

  const [metrics, recent, expiring, undated] = await Promise.all([
    getContractMetrics(user.organizationId),
    getRecentContracts(user.organizationId, DASHBOARD_LIST_LIMIT),
    getExpiringContracts(user.organizationId, new Date(), DASHBOARD_LIST_LIMIT),
    getUndatedContracts(user.organizationId, DASHBOARD_LIST_LIMIT),
  ]);

  const failure =
    !metrics.ok ? metrics
    : !recent.ok ? recent
    : !expiring.ok ? expiring
    : !undated.ok ? undated
    : null;
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <MetricCard
          testId="metric-undated"
          title="Không thời hạn"
          value={undated.ok ? undated.data.total : "—"}
          badgeText={undated.ok && undated.data.total > 0 ? "Cần kiểm tra" : undefined}
          hint="Chưa có ngày ký / ngày hết hạn"
          tone="warning"
          icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
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
            <Link href="/contracts?preset=expiring90">
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

      <Card className="rounded-2xl border border-border/80 shadow-sm bg-card overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/40">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold tracking-tight">
                Hợp đồng không xác định hiệu lực
              </CardTitle>
              {undated.ok && undated.data.total > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 border border-amber-500/30">
                  {undated.data.total} hợp đồng
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Các hợp đồng chưa có ngày ký, thiếu ngày hết hạn hoặc là hợp đồng vô thời hạn / không giới hạn
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground hover:text-amber-600 gap-1 h-8">
            <Link href="/contracts?scope=undated">
              Xem tất cả <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <Alert className="border-amber-300/80 bg-amber-50/70 text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <AlertTitle className="font-semibold text-amber-950 dark:text-amber-200">
              Cảnh báo: Cần kiểm tra lại điều khoản hiệu lực hợp đồng
            </AlertTitle>
            <AlertDescription className="text-xs sm:text-sm text-amber-900/90 dark:text-amber-300/90 mt-1">
              Danh sách các hợp đồng không có ngày ký, không có ngày hết hạn hoặc không giới hạn thời hạn. Vui lòng kiểm tra lại điều khoản hiệu lực của từng hợp đồng.
            </AlertDescription>
          </Alert>

          {undated.ok ? (
            <UndatedContracts contracts={undated.data.rows} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Không tải được danh sách hợp đồng cần lưu ý ngày.
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[7.5rem]" />
        ))}
      </div>

      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
    </div>
  );
}
