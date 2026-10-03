import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ContractDetail } from "@/components/contracts/contract-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { getContract, type ContractRow } from "@/lib/services/contracts";
import { getFileViewUrl, listContractFiles } from "@/lib/services/files";

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
  contract: ContractRow;
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

  return { id, requestedFileId, user, contract: contract.data };
}

async function ContractDetailContent({
  id,
  requestedFileId,
  organizationId,
  contract,
}: {
  id: string;
  requestedFileId: string | undefined;
  organizationId: string;
  contract: ContractRow;
}) {
  const files = await listContractFiles(organizationId, id);
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
      files={fileList}
      filesError={files.ok ? null : files.message}
      initialViewUrl={initialViewUrl}
      initialSelectedId={initial?.id ?? null}
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
  const { id, requestedFileId, user, contract } = await loadAuthorizedContract(
    params,
    searchParams,
  );

  return (
    <Suspense fallback={<ContractDetailSkeleton />}>
      <ContractDetailContent
        id={id}
        requestedFileId={requestedFileId}
        organizationId={user.organizationId}
        contract={contract}
      />
    </Suspense>
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
