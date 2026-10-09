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
    updated?: boolean;
    matchedPartnerName?: string;
    error?: string;
  }[];
  summary: { total: number; ok: number; failed: number; updated: number };
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
    expect(report.summary).toEqual({ total: 3, ok: 2, failed: 1, updated: 0 });

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
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 0 });
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

  it("a tax code that already exists merges into that partner (round 25)", async () => {
    const buffer = await buildWorkbook([
      [`${TEST_PREFIX}Trùng MST ${stamp}`, "", taxInDb], // exists via seed
      [`${TEST_PREFIX}Không trùng ${stamp}`, "", "0511111131"],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 1 });

    // The duplicate row MERGED into the seeded partner (its name is overwritten).
    const merged = report.rows.find((row) => row.taxCode === taxInDb);
    expect(merged?.ok).toBe(true);
    expect(merged?.updated).toBe(true);
    expect(merged?.partnerId).toBe(seeded.id);

    const { data } = await admin
      .from("partners")
      .select("id, name")
      .eq("id", seeded.id)
      .single();
    expect(data?.name).toBe(`${TEST_PREFIX}Trùng MST ${stamp}`);

    // The other row was created normally.
    const { data: imported } = await admin
      .from("partners")
      .select("id")
      .eq("name", `${TEST_PREFIX}Không trùng ${stamp}`);
    expect(imported ?? []).toHaveLength(1);

    // The merge wrote an update_partner audit row.
    const { data: audit } = await admin
      .from("audit_logs")
      .select("target_id")
      .eq("action", "update_partner")
      .eq("target_id", seeded.id)
      .gte("created_at", startedAt);
    expect(audit ?? []).toHaveLength(1);
  }, 120_000);

  it("preview predicts the database match as Cập nhật without writing (round 25)", async () => {
    const buffer = await buildWorkbook([[`${TEST_PREFIX}Xem trước trùng ${stamp}`, "", taxInDb]]);

    const result = await postImport("preview", orgA.cookie, buffer);

    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.rows[0]?.ok).toBe(true);
    expect(report.rows[0]?.updated).toBe(true);
    // The earlier merge test may already have overwritten the seeded partner's
    // name — compare against its CURRENT name, not the original.
    const { data: current } = await admin
      .from("partners")
      .select("name")
      .eq("id", seeded.id)
      .single();
    expect(report.rows[0]?.matchedPartnerName).toBe(current?.name);
    expect(report.summary).toEqual({ total: 1, ok: 1, failed: 0, updated: 1 });

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
      expect(report.summary).toEqual({ total: 1, ok: 1, failed: 0, updated: 0 });

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
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 0 });

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
    expect(report.summary).toEqual({ total: 2, ok: 1, failed: 1, updated: 0 });

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

suite("partner import — merge (round 25)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let startedAt: string;

  const stamp = Date.now().toString(36);
  // Tax codes must be 10 digits.
  const numericStamp = String(Date.now()).slice(-8);

  // The full template header set — the Công ty column drives the company rule.
  const fullHeaders = [
    "Tên đối tác",
    "Tên viết tắt",
    "Khu vực",
    "Địa chỉ",
    "Mã số thuế",
    "Công ty",
    "Trạng thái hợp tác",
  ];

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    orgA = await signInAsAdmin();
  }, 180_000);

  afterAll(async () => {
    if (admin) await sweepTestRows(admin);
    if (admin && startedAt) {
      await admin
        .from("audit_logs")
        .delete()
        .in("action", ["import_partners", "update_partner"])
        .gte("created_at", startedAt);
    }
  }, 180_000);

  it("two rows with the same tax code and company merge into one partner", async () => {
    const buffer = await buildWorkbookWithHeaders(fullHeaders, [
      [`${TEST_PREFIX}Trùng file A ${stamp}`, "TA", "Bắc Ninh", `Địa chỉ A ${stamp}`, `05${numericStamp}`, "HRP", "Đang hợp tác"],
      [`${TEST_PREFIX}Trùng file B ${stamp}`, "TB", "Hà Nội", `Địa chỉ B ${stamp}`, `05${numericStamp}`, "HRP", "Đang hợp tác"],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);
    expect(result.status).toBe(200);

    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 1 });

    // One partner whose name was overwritten by the SECOND row.
    const { data } = await admin
      .from("partners")
      .select("name")
      .eq("tax_code", `05${numericStamp}`);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe(`${TEST_PREFIX}Trùng file B ${stamp}`);

    // The merge wrote an update_partner audit row.
    const { data: audit } = await admin
      .from("audit_logs")
      .select("target_id")
      .eq("action", "update_partner")
      .gte("created_at", startedAt);
    expect(audit ?? []).toHaveLength(1);
  }, 120_000);

  it("the same tax code under a different company creates a second partner", async () => {
    const buffer = await buildWorkbookWithHeaders(fullHeaders, [
      [`${TEST_PREFIX}Khác công ty A ${stamp}`, "", "", "", `06${numericStamp}`, "HRP", ""],
      [`${TEST_PREFIX}Khác công ty B ${stamp}`, "", "", "", `06${numericStamp}`, "HR VN", ""],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);
    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 0 });

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("tax_code", `06${numericStamp}`);
    expect(data).toHaveLength(2);
  }, 120_000);

  it("the same name under the same company merges even with different tax codes", async () => {
    const buffer = await buildWorkbookWithHeaders(fullHeaders, [
      [`${TEST_PREFIX}Trùng tên ${stamp}`, "", "", "Địa chỉ 1", `07${numericStamp}`, "HRP", ""],
      [`${TEST_PREFIX}Trùng tên ${stamp}`, "", "", "Địa chỉ 2", `08${numericStamp}`, "HRP", ""],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);
    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 1 });

    const { data } = await admin
      .from("partners")
      .select("id")
      .like("name", `${TEST_PREFIX}Trùng tên ${stamp}%`);
    expect(data).toHaveLength(1);
  }, 120_000);

  it("two rows sharing only the address merge", async () => {
    const sharedAddress = `Địa chỉ X ${stamp}`;
    const buffer = await buildWorkbook([
      [`${TEST_PREFIX}Chung địa chỉ A ${stamp}`, sharedAddress, `11${numericStamp}`],
      [`${TEST_PREFIX}Chung địa chỉ B ${stamp}`, sharedAddress, `12${numericStamp}`],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);
    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 1 });

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("address", sharedAddress);
    expect(data).toHaveLength(1);
  }, 120_000);

  it("two rows sharing only the region merge (stronger keys differ)", async () => {
    const sharedRegion = `Vùng ${stamp}`;
    const buffer = await buildWorkbookWithHeaders(
      ["Tên đối tác", "Khu vực", "Mã số thuế"],
      [
        [`${TEST_PREFIX}Chung khu vực A ${stamp}`, sharedRegion, `13${numericStamp}`],
        [`${TEST_PREFIX}Chung khu vực B ${stamp}`, sharedRegion, `14${numericStamp}`],
      ],
    );

    const result = await postImport("import", orgA.cookie, buffer);
    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 1 });

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("region", sharedRegion);
    expect(data).toHaveLength(1);
  }, 120_000);

  it("rows that share nothing stay separate", async () => {
    const buffer = await buildWorkbook([
      [`${TEST_PREFIX}Khác hẳn A ${stamp}`, `Địa chỉ khác A ${stamp}`, `15${numericStamp}`],
      [`${TEST_PREFIX}Khác hẳn B ${stamp}`, `Địa chỉ khác B ${stamp}`, `16${numericStamp}`],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);
    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 0 });

    const { data } = await admin
      .from("partners")
      .select("id")
      .like("name", `${TEST_PREFIX}Khác hẳn%`);
    expect(data).toHaveLength(2);
  }, 120_000);

  it("rows without a tax code always create new partners", async () => {
    const buffer = await buildWorkbookWithHeaders(["Tên đối tác"], [
      [`${TEST_PREFIX}Không MST A ${stamp}`],
      [`${TEST_PREFIX}Không MST B ${stamp}`],
    ]);

    const result = await postImport("import", orgA.cookie, buffer);
    const report = result.body as ImportReport;
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, updated: 0 });

    const { data } = await admin
      .from("partners")
      .select("id")
      .like("name", `${TEST_PREFIX}Không MST%`);
    expect(data).toHaveLength(2);
  }, 120_000);
});
