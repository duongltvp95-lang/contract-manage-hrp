import Link from "next/link";
import { Suspense } from "react";

import { PartnerImportSheet } from "@/components/partners/partner-import-sheet";
import { AddPartnerButton } from "@/components/partners/partner-name-sheet";
import { PartnersExportMenu } from "@/components/partners/partners-export-menu";
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
 * Round 37: the contract-count filter moved into the table itself (Excel-style
 * column filter popover), so the standalone `PartnersContractsFilter` on the
 * toolbar and the `?contracts=` URL param are gone. The list is now a pure
 * function of the session + `?status=`.
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

  const result = await listPartners({
    organizationId: me.organizationId,
    status,
  });

  return (
    <div className="space-y-6 p-8">
      <PageHeader />

      <div className="flex flex-wrap items-center gap-3">
        <PartnersTabs status={status} />
      </div>

      {result.ok ? (
        <PartnersTable
          key={`${status ?? "all"}`}
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
function PartnersTabs({
  status,
}: {
  status: "active" | "stopped" | undefined;
}) {
  const tabCls = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  const hrefFor = (next: "active" | "stopped" | undefined) => {
    return next ? `/partners?status=${next}` : "/partners";
  };

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border p-1"
      data-testid="partners-tabs"
    >
      <Link
        href={hrefFor(undefined)}
        data-testid="partner-tab-all"
        className={tabCls(!status)}
      >
        Tất cả
      </Link>
      <Link
        href={hrefFor("active")}
        data-testid="partner-tab-active"
        className={tabCls(status === "active")}
      >
        Đang hợp tác
      </Link>
      <Link
        href={hrefFor("stopped")}
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
        <PartnersExportMenu />
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
