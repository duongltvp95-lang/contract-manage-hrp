import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

import { ContractDetail } from "@/components/contracts/contract-detail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { canDeleteEntities } from "@/lib/delete-permissions";
import {
  getContract,
  type ContractDetail as ContractDetailRow,
} from "@/lib/services/contracts";
import { getFileViewUrl, listContractFiles } from "@/lib/services/files";
import { searchPartners } from "@/lib/services/partners";

/**
 * Contract detail — plan sections 54-60, 65, 66.
 *
 * The page owns data access (contract + files); the Client Component owns the
 * viewer, the document selector, the Edit Sheet and the Archive dialog.
 *
 * `instant = false`: this route reads its own `params` and the session, so it is
 * allowed to block on the server. Without it the build rejects a dynamic route
 * whose shared sidebar reads `usePathname()` in a Client Component.
 */

export const instant = false;

/**
 * KNOWN LIMITATION — the HTTP status of a not-found contract.
 *
 * With `cacheComponents` this route is a Partial Prerender (`◐`): Next flushes a
 * static shell with `200` before the page body runs, so the `notFound()` below
 * swaps the UI but cannot change the status line. A production build therefore
 * answers `200` with the not-found page, while `next dev` answers `404` and hid
 * the difference until the end-to-end suite was run against a real build.
 *
 * `export const dynamic` would fix it and is rejected by the build:
 * "Route segment config 'dynamic' is not compatible with
 * `nextConfig.cacheComponents`". The remaining options — a per-request existence
 * check in `proxy.ts`, or turning `cacheComponents` off — are not worth a
 * duplicated database query on the hot path for a status code no user sees.
 *
 * What matters is intact and asserted: the not-found page is rendered, and no
 * contract data leaks. See docs/milestones/M8, deviation 12.
 */

type DetailParams = Promise<{ id: string }>;
type DetailSearchParams = Promise<{ file?: string }>;

/**
 * Authorization runs BEFORE the Suspense boundary, on purpose.
 *
 * `notFound()` can only set the HTTP status while the response headers are still
 * open. Called inside a boundary that has already started streaming, Next has
 * sent `200` already and the not-found page arrives with a `200` status — right
 * to look at, wrong for anything that reads status codes (monitoring, crawlers,
 * clients). Another organization's contract must answer a real `404`.
 *
 * This also means a user who cannot see the contract never gets the skeleton,
 * and only the slower viewer data (files + a signed URL) streams.
 */
async function loadAuthorizedContract(
  params: DetailParams,
  searchParams: DetailSearchParams,
): Promise<{
  id: string;
  requestedFileId: string | undefined;
  user: CurrentUser;
  contract: ContractDetailRow;
  canViewArchived: boolean;
}> {
  const { id } = await params;
  const { file: requestedFileId } = await searchParams;
  const user = await requireUser();

  const contract = await getContract(id, user.organizationId);

  if (!contract.ok) {
    // Also covers another organization's contract: `getContract` answers the
    // same way for "missing" and "not yours", so nothing leaks.
    notFound();
  }

  // Round 19: an archived contract is only viewable by the delete-admin emails.
  const canViewArchived =
    contract.data.archived_at === null || canDeleteEntities(user.email);

  return { id, requestedFileId, user, contract: contract.data, canViewArchived };
}

async function ContractDetailContent({
  id,
  requestedFileId,
  organizationId,
  contract,
  canDelete,
}: {
  id: string;
  requestedFileId: string | undefined;
  organizationId: string;
  contract: ContractDetailRow;
  canDelete: boolean;
}) {
  // The partner directory's first page is read alongside the files so the Edit
  // Sheet's combobox has its options on first paint; typing searches the whole
  // directory through a server action (round 6).
  const [files, partners] = await Promise.all([
    listContractFiles(organizationId, id),
    searchPartners(""),
  ]);

  const fileList = files.ok ? files.data : [];

  // `?file=<id>` deep-links a specific document; anything unknown falls back to
  // the newest file, which is how `listContractFiles` orders them.
  const initial =
    fileList.find((item) => item.id === requestedFileId) ?? fileList[0] ?? null;

  // Plan section 59: the detail page authorizes and presigns the opened document
  // on the server, so the viewer has something to render on first paint instead
  // of waiting for a client round trip. Switching files happens client-side.
  let initialViewUrl = null;
  if (initial) {
    const signed = await getFileViewUrl(initial.id, organizationId);
    initialViewUrl = signed.ok ? signed.data : null;
  }

  return (
    <ContractDetail
      contract={contract}
      partners={partners.ok ? partners.data : []}
      files={fileList}
      filesError={files.ok ? null : files.message}
      initialViewUrl={initialViewUrl}
      initialSelectedId={initial?.id ?? null}
      canDelete={canDelete}
    />
  );
}

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams;
  searchParams: DetailSearchParams;
}) {
  const { id, requestedFileId, user, contract, canViewArchived } =
    await loadAuthorizedContract(params, searchParams);

  if (!canViewArchived) {
    return <ArchivedForbidden />;
  }

  return (
    <Suspense fallback={<ContractDetailSkeleton />}>
      <ContractDetailContent
        id={id}
        requestedFileId={requestedFileId}
        organizationId={user.organizationId}
        contract={contract}
        canDelete={canDeleteEntities(user.email)}
      />
    </Suspense>
  );
}

/** Round 19 — an archived contract is only shown to the delete-admin emails. */
function ArchivedForbidden() {
  return (
    <div className="p-6" data-testid="contract-archived-forbidden">
      <Alert>
        <AlertTitle>Hợp đồng đã lưu trữ</AlertTitle>
        <AlertDescription>
          Hợp đồng đã lưu trữ. Chỉ quản trị viên được uỷ quyền mới xem được.
        </AlertDescription>
      </Alert>
      <Button asChild variant="outline" className="mt-4">
        <Link href="/contracts">Về danh sách hợp đồng</Link>
      </Button>
    </div>
  );
}

function ContractDetailSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <Skeleton className="h-[28rem]" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}
