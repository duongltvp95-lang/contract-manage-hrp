import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  signInAsAdmin,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 23 — partner export route.
 */

const suite = hasLiveBackend ? describe : describe.skip;

const HRP = "00000000-0000-4000-8000-000000000001";
const HRVN = "00000000-0000-4000-8000-000000000002";

async function fetchExport(
  cookie: string,
  query = "",
): Promise<{ status: number; body: Buffer | null; filename: string | null }> {
  const response = await fetch(`${BASE_URL}/api/partners/export${query}`, {
    headers: cookie ? { cookie } : {},
  });

  if (response.status !== 200) {
    return { status: response.status, body: null, filename: null };
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
    filename,
  };
}

async function readSheet(buffer: Buffer): Promise<{
  headers: string[];
  rows: Record<string, string>[];
}> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    headers[column - 1] = String(cell.value);
  });

  const rows: Record<string, string>[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      const cell = row.getCell(index + 1);
      const value = cell.value;
      record[header] =
        value === null || value === undefined
          ? ""
          : typeof value === "object" && "text" in value
            ? String((value as { text: unknown }).text)
            : String(value);
    });
    rows.push(record);
  }

  return { headers, rows };
}

suite("partner export (round 23)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;

  const stamp = Date.now().toString(36);
  const numericStamp = String(Date.now()).slice(-8);
  const partnerAName = `${TEST_PREFIX}Xuất A ${stamp}`;
  const partnerBName = `${TEST_PREFIX}Xuất B ${stamp}`;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "partnerexport");

    // Partner A: stopped, two companies, one contract.
    const { data: partnerA } = await admin
      .from("partners")
      .insert({
        organization_id: ORG_A,
        name: partnerAName,
        abbreviation: "XA",
        region: "Miền Bắc",
        tax_code: `05${numericStamp}`,
        status: "stopped",
      })
      .select("id")
      .single();
    await admin.from("partner_companies").insert([
      { partner_id: partnerA!.id, company_id: HRP },
      { partner_id: partnerA!.id, company_id: HRVN },
    ]);
    await admin.from("contracts").insert({
      organization_id: ORG_A,
      contract_number: `${TEST_PREFIX}HĐ xuất ${stamp}`,
      partner_id: partnerA!.id,
    });

    // Partner B: active, no companies, no contracts.
    await admin
      .from("partners")
      .insert({ organization_id: ORG_A, name: partnerBName, status: "active" })
      .select("id")
      .single();
  }, 180_000);

  afterAll(async () => {
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("exports all partners with the right headers and columns", async () => {
    const result = await fetchExport(orgA.cookie);
    expect(result.status).toBe(200);
    expect(result.filename).toMatch(/^doi-tac-\d{8}\.xlsx$/);

    const sheet = await readSheet(result.body!);
    expect(sheet.headers).toEqual([
      "Tên đối tác",
      "Tên viết tắt",
      "Mã số thuế",
      "Địa chỉ",
      "Khu vực",
      "Công ty",
      "Trạng thái hợp tác",
      "Số hợp đồng",
      "Ngày tạo",
      "Cập nhật lúc",
    ]);

    // Owner data may exist alongside; assert OUR two rows, not a global count.
    const rowA = sheet.rows.find((row) => row["Tên đối tác"] === partnerAName);
    const rowB = sheet.rows.find((row) => row["Tên đối tác"] === partnerBName);
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();

    expect(rowA?.["Tên viết tắt"]).toBe("XA");
    expect(rowA?.["Mã số thuế"]).toBe(`05${numericStamp}`);
    expect(rowA?.["Khu vực"]).toBe("Miền Bắc");
    // Company names are sorted alphabetically ("HR VN" < "HRP" because of the space).
    expect(rowA?.["Công ty"]).toBe("HR VN, HRP");
    expect(rowA?.["Trạng thái hợp tác"]).toBe("Đã dừng hợp tác");
    expect(rowA?.["Số hợp đồng"]).toBe("1");

    expect(rowB?.["Công ty"]).toBe("");
    expect(rowB?.["Trạng thái hợp tác"]).toBe("Đang hợp tác");
    expect(rowB?.["Số hợp đồng"]).toBe("0");
  }, 120_000);

  it("scopes by status and names the file accordingly", async () => {
    const active = await fetchExport(orgA.cookie, "?status=active");
    expect(active.status).toBe(200);
    expect(active.filename).toMatch(/^doi-tac-dang-hop-tac-\d{8}\.xlsx$/);
    const activeSheet = await readSheet(active.body!);
    expect(activeSheet.rows.some((row) => row["Tên đối tác"] === partnerAName)).toBe(false);
    expect(activeSheet.rows.some((row) => row["Tên đối tác"] === partnerBName)).toBe(true);

    const stopped = await fetchExport(orgA.cookie, "?status=stopped");
    expect(stopped.status).toBe(200);
    expect(stopped.filename).toMatch(/^doi-tac-da-dung-hop-tac-\d{8}\.xlsx$/);
    const stoppedSheet = await readSheet(stopped.body!);
    expect(stoppedSheet.rows.some((row) => row["Tên đối tác"] === partnerAName)).toBe(true);
    expect(stoppedSheet.rows.some((row) => row["Tên đối tác"] === partnerBName)).toBe(false);
  }, 120_000);

  it("refuses anonymous callers and never leaks org A partners to org B", async () => {
    const anon = await fetchExport("");
    expect(anon.status).toBe(401);

    const orgBExport = await fetchExport(orgB.cookie);
    expect(orgBExport.status).toBe(200);
    const sheet = await readSheet(orgBExport.body!);
    expect(sheet.rows.some((row) => row["Tên đối tác"] === partnerAName)).toBe(false);
    expect(sheet.rows.some((row) => row["Tên đối tác"] === partnerBName)).toBe(false);
  }, 120_000);
});
