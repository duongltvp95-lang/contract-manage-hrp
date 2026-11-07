import { Suspense } from "react";

import type { PartnerStatus } from "@schemas/partner";

import { PartnerImportSheet } from "@/components/partners/partner-import-sheet";
import { AddPartnerButton } from "@/components/partners/partner-name-sheet";
import { PartnersExportMenu } from "@/components/partners/partners-export-menu";
import { PartnersTable } from "@/components/partners/partners-table";
import { PartnersTableSkeleton } from "@/components/partners/partners-table-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import { canDeleteEntities } from "@/lib/delete-permissions";
import {
  PARTNERS_PAGE_SIZE_DEFAULT,
  listPartnersDirectoryPage,
} from "@/lib/services/partners";

/**
 * Partners list — round 37 Excel-style column filters + A10 server-side
 * pagination & folded search so directories > 1,000 rows never truncate.
 */

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

const ALLOWED_PARTNER_PAGE_SIZES = new Set([50, 100, 200]);

async function PartnersContent({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const me = await requireUser();
  const params = await searchParams;

  const rawSearch = firstString(params.q)?.trim() ?? "";
  const rawStatus = firstString(params.status);
  const status: PartnerStatus | undefined =
    rawStatus === "active" || rawStatus === "stopped" ? rawStatus : undefined;
  const rawCompany = firstString(params.company)?.trim() || undefined;
  const rawContracts = firstString(params.contracts);
  const contracts: "has" | "none" | undefined =
    rawContracts === "has" || rawContracts === "none" ? rawContracts : undefined;
  const page = parsePositiveInt(firstString(params.page), 1);
  const requestedPageSize = parsePositiveInt(
    firstString(params.pageSize),
    PARTNERS_PAGE_SIZE_DEFAULT,
  );
  const pageSize = ALLOWED_PARTNER_PAGE_SIZES.has(requestedPageSize)
    ? requestedPageSize
    : PARTNERS_PAGE_SIZE_DEFAULT;

  const result = await listPartnersDirectoryPage({
    organizationId: me.organizationId,
    search: rawSearch || undefined,
    status,
    company: rawCompany,
    contracts,
    page,
    pageSize,
  });

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader />

      {result.ok ? (
        <PartnersTable
          key={JSON.stringify([
            result.data.page,
            result.data.pageSize,
            rawSearch,
            status,
            rawCompany,
            contracts,
          ])}
          rows={result.data.rows}
          canDelete={canDeleteEntities(me)}
          pagination={{
            totalCount: result.data.totalCount,
            page: result.data.page,
            pageSize: result.data.pageSize,
            pageCount: result.data.pageCount,
            search: rawSearch,
            status,
            company: rawCompany,
            contracts,
          }}
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
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
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
