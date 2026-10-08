"use server";

import {
  buildPartnerImportTemplate,
  PARTNER_IMPORT_TEMPLATE_FILENAME,
  parsePartnerWorkbook,
  summarisePartnerImport,
  validatePartnerImportFile,
  validatePartnerImportRows,
  type PartnerImportReport,
  type PartnerImportRow,
  type PartnerImportRowReport,
} from "@/lib/partner-import";
import {
  createPartner,
  deletePartner,
  importPartners,
  listCompanies,
  previewPartnerImport,
  searchPartners,
  setPartnerStatus,
  updatePartner,
  type Company,
  type PartnerDetail,
  type PartnerImportServiceRow,
  type PartnerSearchRow,
} from "@/lib/services/partners";
import type { PartnerStatus } from "@schemas/partner";
import {
  authorized,
  fromService,
  validationFailure,
  type ActionResult,
} from "@/lib/server-action";

/**
 * Server actions for the partner directory — feature round 2, part 2.
 *
 * There is no delete action here, and there will not be one. The database
 * revokes DELETE from `authenticated` and defines no DELETE policy, so such an
 * action could not work even if someone added it — the UI and the API agree that
 * a partner referenced by contracts is removed only by an explicit owner
 * decision taken with those contracts in view.
 *
 * `organizationId` always comes from the session via `authorized()`; it is never
 * read from the arguments.
 */

export async function createPartnerAction(
  input: unknown,
): Promise<ActionResult<PartnerDetail>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const result = await createPartner((input ?? {}) as Record<string, unknown>, {
    organizationId: access.user.organizationId,
  });

  return fromService(result);
}

/**
 * Quick search for the combobox (round 6). The term comes from the user's
 * keystrokes; the organization always comes from the session.
 */
export async function searchPartnersAction(
  term: unknown,
): Promise<ActionResult<PartnerSearchRow[]>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const query = typeof term === "string" ? term : "";
  const result = await searchPartners(query);

  return fromService(result);
}

export async function updatePartnerAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult<PartnerDetail>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin đối tác", [
      { path: "id", message: "Không xác định được đối tác cần sửa" },
    ]);
  }

  const result = await updatePartner(id, (input ?? {}) as Record<string, unknown>, {
    organizationId: access.user.organizationId,
  });

  return fromService(result);
}

/**
 * Round 10 — the org's companies (HRP / HR VN), for the partner form's checkbox
 * list. The organization always comes from the session.
 */
export async function listCompaniesAction(): Promise<ActionResult<Company[]>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  return fromService(await listCompanies({ organizationId: access.user.organizationId }));
}

/**
 * Round 10 — flips a partner between đang hợp tác / đã dừng hợp tác.
 */
export async function setPartnerStatusAction(
  id: unknown,
  status: unknown,
): Promise<ActionResult<PartnerDetail>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin đối tác", [
      { path: "id", message: "Không xác định được đối tác cần đổi trạng thái" },
    ]);
  }

  if (status !== "active" && status !== "stopped") {
    return validationFailure("Trạng thái không hợp lệ", [
      { path: "status", message: "Trạng thái phải là active hoặc stopped" },
    ]);
  }

  return fromService(
    await setPartnerStatus(id, status as PartnerStatus, {
      organizationId: access.user.organizationId,
    }),
  );
}

// ---------------------------------------------------------------------------
// Round 7, part 1 — import từ Excel
// ---------------------------------------------------------------------------

/**
 * Reads, type-checks, parses and schema-validates the uploaded workbook.
 *
 * Both import actions re-parse the FILE from scratch: the client never sends a
 * list of rows, so "what gets imported" is always what the file actually
 * contains, not what a crafted request claims.
 */
async function readPartnerImportRows(
  formData: FormData,
): Promise<
  { ok: true; rows: PartnerImportRow[] } | { ok: false; message: string }
> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, message: "Vui lòng chọn một file .xlsx để tải lên." };
  }

  const checked = validatePartnerImportFile({
    name: file.name,
    type: file.type,
    size: file.size,
  });

  if (!checked.ok) {
    return { ok: false, message: checked.message };
  }

  const parsed = await parsePartnerWorkbook(await file.arrayBuffer());

  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }

  return { ok: true, rows: validatePartnerImportRows(parsed.rows) };
}

/**
 * Preview: per-row report with a summary. Nothing is written.
 *
 * Rows that failed the schema or carry an in-file duplicate tax code keep their
 * error; the valid ones additionally get the database-duplicate check (scoped
 * to the caller's organization).
 */
export async function previewPartnersImportAction(
  formData: FormData,
): Promise<ActionResult<PartnerImportReport>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const read = await readPartnerImportRows(formData);
  if (!read.ok) {
    return validationFailure(read.message, [{ path: "file", message: read.message }]);
  }

  const reportRows: PartnerImportRowReport[] = [];
  const validRows: PartnerImportServiceRow[] = [];

  for (const row of read.rows) {
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
      companies: row.companies,
    });
  }

  const preview = await previewPartnerImport(validRows, {
    organizationId: access.user.organizationId,
  });

  if (!preview.ok) return fromService(preview);

  return { ok: true, data: summarisePartnerImport([...reportRows, ...preview.data]) };
}

/**
 * Import: parse + validate + insert the valid rows, one by one.
 *
 * A row that fails validation is reported and skipped; a row that collides with
 * an existing tax code is refused; everything else is inserted. One bad row
 * never stops the batch.
 */
export async function importPartnersAction(
  formData: FormData,
): Promise<ActionResult<PartnerImportReport>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const read = await readPartnerImportRows(formData);
  if (!read.ok) {
    return validationFailure(read.message, [{ path: "file", message: read.message }]);
  }

  const reportRows: PartnerImportRowReport[] = [];
  const validRows: PartnerImportServiceRow[] = [];

  for (const row of read.rows) {
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
      companies: row.companies,
    });
  }

  const imported = await importPartners(validRows, {
    organizationId: access.user.organizationId,
  });

  if (!imported.ok) return fromService(imported);

  return { ok: true, data: summarisePartnerImport([...reportRows, ...imported.data]) };
}

/**
 * Round 7, part 2 — the downloadable sample workbook.
 *
 * The bytes are generated on the server and returned as base64 (a server action
 * returns JSON, not a file), so the client turns them into a download itself.
 */
export async function partnerImportTemplateAction(): Promise<
  ActionResult<{ fileName: string; base64: string }>
> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const bytes = await buildPartnerImportTemplate();
  const base64 = Buffer.from(bytes).toString("base64");

  return {
    ok: true,
    data: { fileName: PARTNER_IMPORT_TEMPLATE_FILENAME, base64 },
  };
}

/** Round 19 — hard-delete a partner (owner-email-gated in the service). */
export async function deletePartnerAction(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin đối tác", [
      { path: "id", message: "Không xác định được đối tác cần xoá" },
    ]);
  }

  return fromService(
    await deletePartner(id, { organizationId: access.user.organizationId }),
  );
}
