import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  seedPartner,
  signInAsAdmin,
  sweepTestRows,
  type SeededPartner,
  type TestSession,
} from "./helpers";

/**
 * Round 7, part 1 — partner import against the real backend.
 *
 * The pipeline runs through the test-only probe route (the real server actions
 * are browser-invoked and cannot be called from Vitest). The probe re-parses
 * the uploaded file from scratch, so these tests exercise the same bytes a
 * browser would send.
 */

const suite = hasLiveBackend ? describe : describe.skip;

async function buildWorkbook(rows: (string | null)[][]): Promise<Uint8Array> {
  return buildWorkbookWithHeaders(["Tên đối tác", "Địa chỉ", "Mã số thuế"], rows);
}

async function buildWorkbookWithHeaders(
  headers: string[],
  rows: (string | null)[][],
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Đối tác");

  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row.map((cell) => cell ?? ""));
  }

  return (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
}

async function postImport(
  action: "preview" | "import",
  cookie: string,
  buffer: Uint8Array,
  filename = "danh-sach.xlsx",
): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  form.append("action", action);
  form.append(
    "file",
    new Blob([buffer as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );

  const response = await fetch(`${BASE_URL}/api/partners-import-probe`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

type ImportReport = {
  rows: {
    rowNumber: number;
    name: string;
    address: string;
    taxCode: string;
    ok: boolean;
    partnerId?: string;
    error?: string;
  }[];
  summary: { total: number; ok: number; failed: number };
};

suite("partner import — Excel (round 7)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;
  let seeded: SeededPartner;

  const stamp = Date.now().toString(36);
  // Tax codes must be 10 DIGITS — the base36 stamp can contain letters, so the
  // suffix comes from the decimal clock instead.
  const numericStamp = String(Date.now()).slice(-8);
  const taxInDb = `03${numericStamp}`;
  const taxOther = `04${numericStamp}`;
  let startedAt: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    startedAt = new Date().toISOString();

    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "partnerimport");

    seeded = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Đối tác đã có ${stamp}`,
      taxCode: taxInDb,
    });
  }, 180_000);

  afterAll(async () => {
    if (seeded) await seeded.cleanup();
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);

    // Round 8: an import now writes an `import_partners` audit row (NULL target,
    // so sweepTestRows does not remove it). Clear the rows this file produced.
    if (admin && startedAt) {
      await admin
        .from("audit_logs")
        .delete()
        .eq("action", "import_partners")
        .gte("created_at", startedAt);
    }
  }, 180_000);

  it("refuses an anonymous caller with 401", async () => {
    const buffer = await buildWorkbook([["Công ty ẩn danh", "", "0211111111"]]);
    const result = await postImport("import", "", buffer);

    expect(result.status).toBe(401);
  });

  it("preview parses, validates and reports — without writing anything", async () => {
    const buffer = await buildWorkbook([
      [`${TEST_PREFIX}Nhập hợp lệ ${stamp}`, "Hà Nội", "0511111111"],
      ["", "Dòng này thiếu tên", ""],
      [`${TEST_PREFIX}Nhập hợp lệ 2 ${stamp}`, "", "0511111112"],
    ]);

    const result = await postImport("preview", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 3, ok: 2, failed: 1 });

    const invalid = report.rows.find((row) => row.rowNumber === 3);
    expect(invalid?.ok).toBe(false);
    expect(invalid?.error).toBe("Tên đối tác không được để trống");

    // Preview writes nothing — neither the valid nor the invalid row exists.
    const { data } = await admin
      .from("partners")
      .select("id")
      .like("name", `${TEST_PREFIX}Nhập hợp lệ%`);
    expect(data ?? []).toHaveLength(0);
  }, 120_000);

  it("imports the valid rows into the session organization", async () => {
    const buffer = await buildWorkbook([
      [`${TEST_PREFIX}Nhập thật A ${stamp}`, "Đà Nẵng", "0511111121"],
      [`${TEST_PREFIX}Nhập thật B ${stamp}`, "", "0511111122"],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0 });
    expect(report.rows.every((row) => typeof row.partnerId === "string")).toBe(true);

    const { data } = await admin
      .from("partners")
      .select("name, address, tax_code, organization_id")
      .like("name", `${TEST_PREFIX}Nhập thật%`)
      .order("name");

    expect(data).toHaveLength(2);
    expect(data?.[0]).toMatchObject({
      name: `${TEST_PREFIX}Nhập thật A ${stamp}`,
      address: "Đà Nẵng",
      tax_code: "0511111121",
      organization_id: ORG_A,
    });
    expect(data?.[1]?.tax_code).toBe("0511111122");
    expect(data?.[1]?.address).toBeNull();
  }, 120_000);

  it("a tax code that already exists fails only that row", async () => {
    const buffer = await buildWorkbook([
      [`${TEST_PREFIX}Trùng MST ${stamp}`, "", taxInDb], // exists via seed
      [`${TEST_PREFIX}Không trùng ${stamp}`, "", "0511111131"],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 1, failed: 1 });

    const duplicated = report.rows.find((row) => row.taxCode === taxInDb);
    expect(duplicated?.ok).toBe(false);
    expect(duplicated?.error).toContain("Mã số thuế đã được dùng");

    // The failing row was NOT inserted; the other one was.
    const { data } = await admin
      .from("partners")
      .select("name")
      .like("name", `${TEST_PREFIX}Trùng MST%`);
    expect(data ?? []).toHaveLength(0);

    const { data: imported } = await admin
      .from("partners")
      .select("id")
      .eq("name", `${TEST_PREFIX}Không trùng ${stamp}`);
    expect(imported ?? []).toHaveLength(1);
  }, 120_000);

  it("preview flags the database duplicate without writing", async () => {
    const buffer = await buildWorkbook([[`${TEST_PREFIX}Xem trước trùng ${stamp}`, "", taxInDb]]);

    const result = await postImport("preview", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.rows[0]?.ok).toBe(false);
    expect(report.rows[0]?.error).toContain("Mã số thuế đã được dùng");

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("name", `${TEST_PREFIX}Xem trước trùng ${stamp}`);
    expect(data ?? []).toHaveLength(0);
  }, 120_000);

  it("another organization's tax code is not a conflict", async () => {
    // `taxOther` exists in ORG_A via the seed? No — seed uses `taxInDb`. Create
    // an ORG_A partner with `taxOther` first, then import the same code as ORG_B.
    const orgAOnly = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Chỉ org A ${stamp}`,
      taxCode: taxOther,
    });

    try {
      const buffer = await buildWorkbook([[`${TEST_PREFIX}Org B dùng MST ${stamp}`, "", taxOther]]);
      const result = await postImport("import", orgB.cookie, buffer);

      expect(result.status).toBe(200);

      const report = result.body as ImportReport;
      expect(report.rows[0]?.ok).toBe(true);
      expect(report.summary).toEqual({ total: 1, ok: 1, failed: 0 });

      // The new row lives in ORG_B; ORG_A keeps its own partner with the same
      // code. Partners are organization-scoped.
      const { data: inB } = await admin
        .from("partners")
        .select("organization_id")
        .eq("name", `${TEST_PREFIX}Org B dùng MST ${stamp}`)
        .single();
      expect(inB?.organization_id).toBe(ORG_B);
    } finally {
      await orgAOnly.cleanup();
    }
  }, 120_000);

  it("imports the status column — stopped and active (round 22)", async () => {
    const buffer = await buildWorkbookWithHeaders(
      ["Tên đối tác", "Mã số thuế", "Trạng thái hợp tác"],
      [
        [`${TEST_PREFIX}Status dừng ${stamp}`, "0511111141", "Đã dừng hợp tác"],
        [`${TEST_PREFIX}Status đang ${stamp}`, "0511111142", "Đang hợp tác"],
      ],
    );

    const result = await postImport("import", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0 });

    const { data } = await admin
      .from("partners")
      .select("name, status")
      .like("name", `${TEST_PREFIX}Status%`)
      .order("name");

    expect(data).toHaveLength(2);
    const stopped = data?.find((row) => row.name.includes("dừng"));
    const active = data?.find((row) => row.name.includes("đang"));
    expect(stopped?.status).toBe("stopped");
    expect(active?.status).toBe("active");
  }, 120_000);

  it("a row with an unrecognised status fails alone (round 22)", async () => {
    const buffer = await buildWorkbookWithHeaders(
      ["Tên đối tác", "Mã số thuế", "Trạng thái hợp tác"],
      [
        [`${TEST_PREFIX}Status lạ ${stamp}`, "0511111151", "Tạm dừng"],
        [`${TEST_PREFIX}Status ok ${stamp}`, "0511111152", "Đang hợp tác"],
      ],
    );

    const result = await postImport("import", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 1, failed: 1 });

    const bad = report.rows.find((row) => row.rowNumber === 2);
    expect(bad?.ok).toBe(false);
    expect(bad?.error).toContain("Đang hợp tác");
    expect(bad?.error).toContain("Đã dừng hợp tác");

    // Only the good row was written.
    const { data: goodRows } = await admin
      .from("partners")
      .select("id")
      .eq("name", `${TEST_PREFIX}Status ok ${stamp}`);
    expect(goodRows ?? []).toHaveLength(1);

    const { data: badRows } = await admin
      .from("partners")
      .select("id")
      .eq("name", `${TEST_PREFIX}Status lạ ${stamp}`);
    expect(badRows ?? []).toHaveLength(0);
  }, 120_000);
});
