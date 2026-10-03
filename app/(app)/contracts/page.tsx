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
import { parseContractsQuery } from "@/lib/contracts-query";
import { listContracts } from "@/lib/services/contracts";

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

  const result = await listContracts({
    // authoritative, from the session
    organizationId: me.organizationId,
    query,
  });

  return (
    <div className="space-y-6 p-8">
      <PageHeader />

      <ContractsToolbar query={query} />

      {result.ok ? (
        <>
          <ContractsTable
            rows={result.data.rows}
            query={query}
            total={result.data.total}
          />
          <ContractsPagination
            query={query}
            total={result.data.total}
            pageCount={result.data.pageCount}
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

function PageHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Hợp đồng</h1>
        <p className="text-muted-foreground">
          Tìm kiếm, lọc và quản lý hợp đồng của tổ chức.
        </p>
      </div>
      <Button asChild>
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
    <div className="space-y-6 p-8">
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
