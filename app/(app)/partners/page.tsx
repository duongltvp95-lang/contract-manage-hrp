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

/**
 * Partners list — round 37 trở đi dùng Excel-style column filter trong bảng
 * (Tên / Tên viết tắt / MST / Khu vực / Trạng thái / Công ty / Số hợp đồng),
 * nên trang chỉ còn dữ liệu thuần từ session.
 */

type RawSearchParams = Record<string, string | string[] | undefined>;

async function PartnersContent({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const me = await requireUser();
  await searchParams;

  const result = await listPartners({
    organizationId: me.organizationId,
  });

  return (
    <div className="space-y-6 p-8">
      <PageHeader />

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
