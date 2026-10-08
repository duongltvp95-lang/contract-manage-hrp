import Link from "next/link";
import { Suspense } from "react";

import { PartnerImportSheet } from "@/components/partners/partner-import-sheet";
import { AddPartnerButton } from "@/components/partners/partner-name-sheet";
import { PartnersTable } from "@/components/partners/partners-table";
import { PartnersTableSkeleton } from "@/components/partners/partners-table-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import { canDeleteEntities } from "@/lib/delete-permissions";
import { listPartners } from "@/lib/services/partners";
import { cn } from "@/lib/utils";

/**
 * Partners list — feature round 2, part 2; round 20 adds status tabs.
 *
 * A pure function of the session + `?status=`: require the user, read the
 * directory for that organization, render. The status filter lives in the URL
 * like the contracts scope, so it is shareable and back/forward works.
 */

type RawSearchParams = Record<string, string | string[] | undefined>;

async function PartnersContent({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const me = await requireUser();
  const params = await searchParams;
  const status =
    params.status === "active" || params.status === "stopped"
      ? params.status
      : undefined;

  const result = await listPartners({ organizationId: me.organizationId, status });

  return (
    <div className="space-y-6 p-8">
      <PageHeader />

      <PartnersTabs status={status} />

      {result.ok ? (
        <PartnersTable
          rows={result.data}
          canDelete={canDeleteEntities(me.email)}
        />
      ) : (
        // Plan section 80: a readable message, never a raw stack trace.
        <Alert variant="destructive">
          <AlertTitle>Không tải được danh sách đối tác</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Round 20 — all / active / stopped partner tabs. */
function PartnersTabs({ status }: { status: "active" | "stopped" | undefined }) {
  const tabCls = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border p-1"
      data-testid="partners-tabs"
    >
      <Link
        href="/partners"
        data-testid="partner-tab-all"
        className={tabCls(!status)}
      >
        Tất cả
      </Link>
      <Link
        href="/partners?status=active"
        data-testid="partner-tab-active"
        className={tabCls(status === "active")}
      >
        Đang hợp tác
      </Link>
      <Link
        href="/partners?status=stopped"
        data-testid="partner-tab-stopped"
        className={tabCls(status === "stopped")}
      >
        Đã dừng hợp tác
      </Link>
    </div>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Đối tác</h1>
        <p className="text-muted-foreground">
          Danh bạ đối tác của tổ chức, dùng để gắn vào hợp đồng.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AddPartnerButton />
        <PartnerImportSheet />
      </div>
    </header>
  );
}

/** Doubles as the Suspense fallback, so the page never jumps (plan section 81). */
function PartnersFallback() {
  return (
    <div className="space-y-6 p-8">
      <PageHeader />
      <PartnersTableSkeleton />
    </div>
  );
}

export default function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <Suspense fallback={<PartnersFallback />}>
      <PartnersContent searchParams={searchParams} />
    </Suspense>
  );
}
