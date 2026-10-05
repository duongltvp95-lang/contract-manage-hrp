import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ContractsPagination } from "@/components/contracts/contracts-pagination";
import { ContractsTable } from "@/components/contracts/contracts-table";
import { ContractsTableSkeleton } from "@/components/contracts/contracts-table-skeleton";
import { RenamePartnerButton } from "@/components/partners/partner-name-sheet";
import { NoPartnerContractsEmptyState } from "@/components/partners/partners-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { parseContractsQuery } from "@/lib/contracts-query";
import { listContracts } from "@/lib/services/contracts";
import { getPartner, type PartnerRow } from "@/lib/services/partners";

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
  partner: PartnerRow;
}> {
  const { id } = await params;
  const me = await requireUser();

  const partner = await getPartner(id, { organizationId: me.organizationId });

  if (!partner.ok) {
    notFound();
  }

  return { id, organizationId: me.organizationId, partner: partner.data };
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
  // The path segment is authoritative: whatever `partnerId` the URL carries, the
  // page stays scoped to the partner it is showing.
  const query = { ...parseContractsQuery(searchParams), partnerId: id };

  const result = await listContracts({ organizationId, query });

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
    <>
      <ContractsTable
        rows={result.data.rows}
        query={query}
        total={result.data.total}
        basePath={`/partners/${id}`}
        emptyState={<NoPartnerContractsEmptyState />}
      />
      <ContractsPagination
        query={query}
        total={result.data.total}
        pageCount={result.data.pageCount}
        basePath={`/partners/${id}`}
      />
    </>
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
    <div className="space-y-6 p-8">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/partners">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Đối tác
          </Link>
        </Button>

        <div className="min-w-0 flex-1">
          <h1
            className="truncate text-2xl font-bold"
            data-testid="partner-detail-name"
          >
            {loaded.partner.name}
          </h1>
          <p className="text-muted-foreground">
            Hợp đồng đã ký với đối tác này.
          </p>
        </div>

        <RenamePartnerButton partner={loaded.partner} />
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
