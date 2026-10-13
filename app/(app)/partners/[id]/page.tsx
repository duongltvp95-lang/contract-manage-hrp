import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ContractsPagination } from "@/components/contracts/contracts-pagination";
import { ContractsTable } from "@/components/contracts/contracts-table";
import { ContractsTableSkeleton } from "@/components/contracts/contracts-table-skeleton";
import { RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { CompanyBadges, PartnerStatusBadge } from "@/components/partners/partner-badges";
import { DeletePartnerButton } from "@/components/partners/delete-partner-button";
import { PartnerStatusToggle } from "@/components/partners/partner-status-toggle";
import { NoPartnerContractsEmptyState } from "@/components/partners/partners-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { parseContractsQuery, type ContractsQuery } from "@/lib/contracts-query";
import { canDeleteEntities } from "@/lib/delete-permissions";
import { listContracts } from "@/lib/services/contracts";
import { getPartner, type PartnerDetail } from "@/lib/services/partners";
import { cn } from "@/lib/utils";

/**
 * Partner detail — feature round 2, part 2.
 *
 * The partner is loaded and authorized BEFORE the Suspense boundary, for the
 * same reason the contract detail page does it: `notFound()` can only set the
 * HTTP status while the response headers are still open, and a partner that does
 * not exist (or belongs to another organization — `getPartner` answers the same
 * way for both, so nothing leaks) must be a real 404.
 *
 * The contracts table is the same `ContractsTable` the /contracts page uses,
 * filtered server-side by `partner_id`. Sorting and pagination work here too:
 * the path segment is the authoritative filter, and the rest of the list state
 * comes from the URL as it does everywhere else.
 */

export const instant = false;

type PartnerParams = Promise<{ id: string }>;
type RawSearchParams = Record<string, string | string[] | undefined>;

async function loadPartner(params: PartnerParams): Promise<{
  id: string;
  organizationId: string;
  partner: PartnerDetail;
  canDelete: boolean;
}> {
  const { id } = await params;
  const me = await requireUser();

  const partner = await getPartner(id, { organizationId: me.organizationId });

  if (!partner.ok) {
    notFound();
  }

  return {
    id,
    organizationId: me.organizationId,
    partner: partner.data,
    canDelete: canDeleteEntities(me.email),
  };
}

function PartnerContractsTabs({
  basePath,
  scope,
  query,
}: {
  basePath: string;
  scope: "all" | "active" | "expired";
  query: ContractsQuery;
}) {
  const withScope = (next: "all" | "active" | "expired") => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.sort && query.sort !== "updated_at") params.set("sort", query.sort);
    if (query.dir && query.dir !== "desc") params.set("dir", query.dir);
    if (next !== "all") params.set("scope", next);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const tabCls = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border p-1"
      data-testid="partner-contracts-tabs"
    >
      <Link
        href={withScope("all")}
        data-testid="partner-contract-tab-all"
        className={tabCls(scope === "all")}
      >
        Tất cả
      </Link>
      <Link
        href={withScope("active")}
        data-testid="partner-contract-tab-active"
        className={tabCls(scope === "active")}
      >
        Đang hoạt động
      </Link>
      <Link
        href={withScope("expired")}
        data-testid="partner-contract-tab-expired"
        className={tabCls(scope === "expired")}
      >
        Đã hết hạn
      </Link>
    </div>
  );
}

async function PartnerContracts({
  id,
  organizationId,
  searchParams,
}: {
  id: string;
  organizationId: string;
  searchParams: RawSearchParams;
}) {
  const rawScope = typeof searchParams.scope === "string" ? searchParams.scope : undefined;
  const scope: "all" | "active" | "expired" =
    rawScope === "active" || rawScope === "expired" ? rawScope : "all";

  // The path segment is authoritative: whatever `partnerId` the URL carries, the
  // page stays scoped to the partner it is showing.
  const query = { ...parseContractsQuery(searchParams), partnerId: id };

  const result = await listContracts({ organizationId, query, scope });

  if (!result.ok) {
    // Plan section 80: a readable message, never a raw stack trace.
    return (
      <Alert variant="destructive">
        <AlertTitle>Không tải được danh sách hợp đồng</AlertTitle>
        <AlertDescription>{result.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PartnerContractsTabs
        basePath={`/partners/${id}`}
        scope={scope}
        query={query}
      />
      <ContractsTable
        rows={result.data.rows}
        query={query}
        total={result.data.total}
        basePath={`/partners/${id}`}
        scope={scope}
        emptyState={<NoPartnerContractsEmptyState />}
      />
      <ContractsPagination
        query={query}
        total={result.data.total}
        pageCount={result.data.pageCount}
        basePath={`/partners/${id}`}
        scope={scope}
      />
    </div>
  );
}

export default async function PartnerDetailPage({
  params,
  searchParams,
}: {
  params: PartnerParams;
  searchParams: Promise<RawSearchParams>;
}) {
  const [loaded, rawSearchParams] = await Promise.all([loadPartner(params), searchParams]);

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/partners">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Đối tác
          </Link>
        </Button>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="truncate text-2xl font-bold"
              data-testid="partner-detail-name"
            >
              {loaded.partner.name}
            </h1>
            <PartnerStatusBadge status={loaded.partner.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CompanyBadges companies={loaded.partner.companies} />
          </div>
          <p className="text-muted-foreground">
            Hợp đồng đã ký với đối tác này.
          </p>
          {/* Round 2 part 3: address + tax code are OPTIONAL fields, so each line
              shows only when populated. `whitespace-pre-line` keeps newlines a
              user typed in the textarea (multi-line Vietnamese addresses). */}
          {(loaded.partner.address ||
            loaded.partner.tax_code ||
            loaded.partner.region ||
            loaded.partner.abbreviation) && (
            <dl
              className="grid gap-x-6 gap-y-1 pt-2 text-sm sm:grid-cols-[auto_1fr]"
              data-testid="partner-detail-meta"
            >
              {loaded.partner.tax_code && (
                <>
                  <dt className="font-medium text-muted-foreground">
                    Mã số thuế
                  </dt>
                  <dd
                    className="font-mono"
                    data-testid="partner-detail-tax-code"
                  >
                    {loaded.partner.tax_code}
                  </dd>
                </>
              )}
              {loaded.partner.address && (
                <>
                  <dt className="font-medium text-muted-foreground sm:self-start">
                    Địa chỉ
                  </dt>
                  <dd
                    className="whitespace-pre-line"
                    data-testid="partner-detail-address"
                  >
                    {loaded.partner.address}
                  </dd>
                </>
              )}
              {loaded.partner.region && (
                <>
                  <dt className="font-medium text-muted-foreground">Khu vực</dt>
                  <dd data-testid="partner-detail-region">
                    {loaded.partner.region}
                  </dd>
                </>
              )}
              {loaded.partner.abbreviation && (
                <>
                  <dt className="font-medium text-muted-foreground">
                    Tên viết tắt
                  </dt>
                  <dd className="font-mono" data-testid="partner-detail-abbreviation">
                    {loaded.partner.abbreviation}
                  </dd>
                </>
              )}
            </dl>
          )}
        </div>

        <div className="flex items-center gap-2">
          <PartnerStatusToggle
            partnerId={loaded.partner.id}
            status={loaded.partner.status}
          />
          <RenamePartnerButton partner={loaded.partner} />
          {loaded.canDelete && (
            <DeletePartnerButton
              partnerId={loaded.partner.id}
              label="Xoá đối tác"
              redirectTo="/partners"
            />
          )}
        </div>
      </header>

      <Suspense fallback={<ContractsTableSkeleton />}>
        <PartnerContracts
          id={loaded.id}
          organizationId={loaded.organizationId}
          searchParams={rawSearchParams}
        />
      </Suspense>
    </div>
  );
}
