import { NextResponse, type NextRequest } from "next/server";

import { resolveAccess } from "@/lib/auth";
import {
  parsePartnerWorkbook,
  summarisePartnerImport,
  validatePartnerImportFile,
  validatePartnerImportRows,
  type PartnerImportRowReport,
} from "@/lib/partner-import";
import {
  importPartners,
  previewPartnerImport,
  type PartnerImportServiceRow,
} from "@/lib/services/partners";
import { statusForCode } from "@/lib/services/types";

/**
 * TEST FIXTURE — not part of the application.
 *
 * The two import server actions take a `FormData` and are invoked from the
 * browser; a Vitest process cannot call them. This route gives the integration
 * suite the same pipeline over plain HTTP, with the organization coming from
 * the session exactly as the actions take it — never from the request body.
 *
 * It re-parses the uploaded file from scratch, like the actions do; it does NOT
 * accept a list of rows.
 *
 * Lives under `tests/`, is copied into `app/api/partners-import-probe/` by
 * `tests/integration/global-setup.ts` for the duration of the run, answers 404
 * unless `TEST_PROBE=1`, and is never part of a production build.
 */

export async function POST(request: NextRequest) {
  if (process.env.TEST_PROBE !== "1" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const access = await resolveAccess();
  if (access.status !== "ok") {
    return NextResponse.json(
      { error: "unauthenticated", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const action = String(formData?.get("action") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Vui lòng chọn một file .xlsx để tải lên.", code: "validation" },
      { status: 422 },
    );
  }

  const checked = validatePartnerImportFile({
    name: file.name,
    type: file.type,
    size: file.size,
  });

  if (!checked.ok) {
    return NextResponse.json(
      { error: checked.message, code: checked.code },
      { status: 422 },
    );
  }

  const parsed = await parsePartnerWorkbook(await file.arrayBuffer());

  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.message, code: parsed.code },
      { status: 422 },
    );
  }

  const validated = validatePartnerImportRows(parsed.rows);
  const reportRows: PartnerImportRowReport[] = [];
  const validRows: PartnerImportServiceRow[] = [];

  for (const row of validated) {
    if (!row.ok) {
      reportRows.push(row);
      continue;
    }
    validRows.push({
      rowNumber: row.rowNumber,
      name: row.name,
      address: row.address,
      taxCode: row.taxCode,
      region: row.region,
      abbreviation: row.abbreviation,
      status: row.status,
      companies: row.companies,
      hasCompanyColumn: row.hasCompanyColumn,
    });
  }

  const result =
    action === "import"
      ? await importPartners(validRows, { organizationId: access.user.organizationId })
      : await previewPartnerImport(validRows, { organizationId: access.user.organizationId });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: statusForCode(result.code) },
    );
  }

  return NextResponse.json(summarisePartnerImport([...reportRows, ...result.data]), {
    status: 200,
  });
}
