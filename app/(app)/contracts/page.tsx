import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ContractsPagination } from "@/components/contracts/contracts-pagination";
import { ContractsTable } from "@/components/contracts/contracts-table";
import { ContractsTableSkeleton } from "@/components/contracts/contracts-table-skeleton";
import { ContractsToolbar } from "@/components/contracts/contracts-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { contractsHref, parseContractsQuery, type ContractsQuery } from "@/lib/contracts-query";
import { canDeleteEntities } from "@/lib/delete-permissions";
import { listContracts } from "@/lib/services/contracts";
import { getContractMetrics } from "@/lib/services/dashboard";
import { cn } from "@/lib/utils";

/**
 * Contracts list — plan sections 48-53, 80-82.
 *
 * All list state lives in the URL, so this page is a pure function of
 * `searchParams`: parse -> query the database -> render. Search, filters,
 * sorting and pagination are all applied in SQL by `listContracts()`.
 */

type RawSearchParams = Record<string, string | string[] | undefined>;

async function ContractsContent({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const me = await requireUser();
  const params = await searchParams;
  const query = parseContractsQuery(params);

  // Round 19/20: the archived tab is owner-email-gated (a non-privileged user
  // who edits the URL is forced back to active); the expired tab is for everyone.
  const canDelete = canDeleteEntities(me.email);
  const raw = params.scope;
  const requestedScope = raw === "expired" || raw === "archived" ? raw : "active";
  const scope = requestedScope === "archived" && !canDelete ? "active" : requestedScope;

  const [result, metricsResult] = await Promise.all([
    listContracts({
      organizationId: me.organizationId,
      query,
      scope,
    }),
    getContractMetrics(me.organizationId),
  ]);

  const counts = metricsResult.ok
    ? {
        active: metricsResult.data.active,
        expired: metricsResult.data.expired,
        archived: metricsResult.data.archived,
      }
    : undefined;

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader />

      <ContractsTabs scope={scope} canDelete={canDelete} query={query} counts={counts} />

      <ContractsToolbar query={query} scope={scope} />

      {result.ok ? (
        <>
          <ContractsTable
            key={JSON.stringify([scope, query])}
            rows={result.data.rows}
            query={query}
            total={result.data.total}
            canDelete={canDelete}
            scope={scope}
          />
          <ContractsPagination
            query={query}
            total={result.data.total}
            pageCount={result.data.pageCount}
            scope={scope}
          />
        </>
      ) : (
        // Plan section 80: a readable message, never a raw stack trace.
        <Alert variant="destructive">
          <AlertTitle>Không tải được danh sách hợp đồng</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Round 20 — active/expired tabs for everyone; archived stays delete-admin only. */
function ContractsTabs({
  scope,
  canDelete,
  query,
  counts,
}: {
  scope: "active" | "expired" | "archived";
  canDelete: boolean;
  query: ContractsQuery;
  counts?: { active: number; expired: number; archived: number };
}) {
  const base = contractsHref({}, query);
  const withScope = (next: "active" | "expired" | "archived") =>
    next === "active"
      ? base
      : `${base}${base.includes("?") ? "&" : "?"}scope=${next}`;

  const tabCls = (active: boolean) =>
    cn(
      "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-150",
      active
        ? "bg-emerald-600 text-white shadow-sm font-semibold"
        : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
    );

  const badgeCls = (active: boolean) =>
    cn(
      "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums leading-none",
      active
        ? "bg-white/20 text-white"
        : "bg-muted text-muted-foreground",
    );

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-muted/40 p-1 shadow-xs backdrop-blur"
      data-testid="contracts-tabs"
    >
      <Link
        href={withScope("active")}
        data-testid="contract-tab-active"
        className={tabCls(scope === "active")}
      >
        <span>Còn hiệu lực</span>
        {counts !== undefined && (
          <span className={badgeCls(scope === "active")}>{counts.active}</span>
        )}
      </Link>
      <Link
        href={withScope("expired")}
        data-testid="contract-tab-expired"
        className={tabCls(scope === "expired")}
      >
        <span>Đã hết hạn</span>
        {counts !== undefined && (
          <span className={badgeCls(scope === "expired")}>{counts.expired}</span>
        )}
      </Link>
      {canDelete && (
        <Link
          href={withScope("archived")}
          data-testid="contract-tab-archived"
          className={tabCls(scope === "archived")}
        >
          <span>Đã lưu trữ</span>
          {counts !== undefined && (
            <span className={badgeCls(scope === "archived")}>{counts.archived}</span>
          )}
        </Link>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Hợp đồng</h1>
        <p className="text-muted-foreground">
          Tìm kiếm, lọc và quản lý hợp đồng của tổ chức.
        </p>
      </div>
      <Button asChild className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-sm hover:shadow-md transition-all duration-200">
        <Link href="/contracts/new">
          <Plus className="mr-2 h-4 w-4" />
          Thêm hợp đồng
        </Link>
      </Button>
    </header>
  );
}

/** Doubles as the Suspense fallback, so the page never jumps (plan section 81). */
function ContractsFallback() {
  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader />
      <div className="h-9 w-full max-w-sm rounded-md bg-muted" />
      <ContractsTableSkeleton />
    </div>
  );
}

export default function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <Suspense fallback={<ContractsFallback />}>
      <ContractsContent searchParams={searchParams} />
    </Suspense>
  );
}
