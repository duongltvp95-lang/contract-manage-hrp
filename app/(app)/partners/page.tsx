import { Suspense } from "react";

import { PartnerImportSheet } from "@/components/partners/partner-import-sheet";
import { AddPartnerButton } from "@/components/partners/partner-name-sheet";
import { PartnersTable } from "@/components/partners/partners-table";
import { PartnersTableSkeleton } from "@/components/partners/partners-table-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import { canDeleteEntities } from "@/lib/delete-permissions";
import { listPartners } from "@/lib/services/partners";

/**
 * Partners list — feature round 2, part 2.
 *
 * A pure function of the session: require the user, read the directory for that
 * organization, render. There is no filter state in the URL yet — the directory
 * is small and the combobox does the searching where it matters (inside the
 * contract form).
 */

async function PartnersContent() {
  const me = await requireUser();
  const result = await listPartners({ organizationId: me.organizationId });

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

export default function PartnersPage() {
  return (
    <Suspense fallback={<PartnersFallback />}>
      <PartnersContent />
    </Suspense>
  );
}
