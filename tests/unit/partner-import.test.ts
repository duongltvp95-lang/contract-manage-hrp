import { describe, expect, it } from "vitest";

import {
  PARTNER_IMPORT_MAX_BYTES,
  PARTNER_IMPORT_MAX_ROWS,
  buildPartnerImportTemplate,
  parsePartnerWorkbook,
  summarisePartnerImport,
  validatePartnerImportFile,
  validatePartnerImportRows,
} from "@/lib/partner-import";

/**
 * Round 7, part 1 — the pure import pipeline.
 *
 * Workbooks are built with exceljs (the same library that parses them), so the
 * tests exercise real .xlsx bytes rather than a hand-rolled fake.
 */

async function buildWorkbook(
  header: (string | number | null)[],
  rows: (string | number | null)[][],
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Đối tác");

  sheet.addRow(header.map((cell) => cell ?? ""));
  for (const row of rows) {
    sheet.addRow(row.map((cell) => cell ?? ""));
  }

  // `writeBuffer()` returns a Buffer, which IS a Uint8Array — parse accepts it.
  return (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
}

describe("parsePartnerWorkbook", () => {
  it("maps the accented Vietnamese headers", async () => {
    const buffer = await buildWorkbook(
      ["Tên đối tác", "Địa chỉ", "Mã số thuế"],
      [
        ["Công ty A", "Hà Nội", "0312345678"],
        ["Công ty B", "", "0312345679"],
      ],
    );

    const result = await parsePartnerWorkbook(buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      name: "Công ty A",
      address: "Hà Nội",
      taxCode: "0312345678",
      ok: true,
    });
    expect(result.rows[1]).toMatchObject({
      rowNumber: 3,
      name: "Công ty B",
      address: "",
      taxCode: "0312345679",
    });
  });

  it("maps unaccented and English header variants", async () => {
    const cases: [string, string, string][] = [
      ["Ten doi tac", "Dia chi", "MST"],
      ["TÊN ĐỐI TÁC", "ĐỊA CHỈ", "MÃ SỐ THUẾ"],
      ["name", "address", "tax code"],
      ["Tên", "Address", "tax_code"],
    ];

    for (const header of cases) {
      const buffer = await buildWorkbook(header, [["Công ty X", "TP HCM", "0311111111"]]);
      const result = await parsePartnerWorkbook(buffer);

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      expect(result.rows[0]).toMatchObject({
        name: "Công ty X",
        address: "TP HCM",
        taxCode: "0311111111",
      });
    }
  });

  it("reports the missing name column with the required header names", async () => {
    const buffer = await buildWorkbook(["Địa chỉ", "Mã số thuế"], [["Hà Nội", "0312345678"]]);

    const result = await parsePartnerWorkbook(buffer);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("missing_name_column");
    expect(result.message).toContain("Tên đối tác");
  });

  it("skips completely empty rows", async () => {
    const buffer = await buildWorkbook(
      ["Tên đối tác", "Địa chỉ", "Mã số thuế"],
      [
        ["Công ty A", "Hà Nội", "0312345678"],
        ["", "", ""],
        [null, null, null],
        ["Công ty B", "", "0312345679"],
      ],
    );

    const result = await parsePartnerWorkbook(buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.map((row) => row.name)).toEqual(["Công ty A", "Công ty B"]);
  });

  it("rejects more than the maximum number of data rows", async () => {
    const rows = Array.from({ length: PARTNER_IMPORT_MAX_ROWS + 1 }, (_, index) => [
      `Công ty ${index}`,
      "",
      `03${String(index).padStart(8, "0")}`,
    ]);

    const buffer = await buildWorkbook(["Tên đối tác", "Mã số thuế"], rows);
    const result = await parsePartnerWorkbook(buffer);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("too_many_rows");
    expect(result.message).toContain(String(PARTNER_IMPORT_MAX_ROWS));
  }, 60_000);

  it("rejects unreadable bytes", async () => {
    const result = await parsePartnerWorkbook(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("unreadable_file");
  });

  it("enforces the byte limit before parsing", async () => {
    const oversized = new ArrayBuffer(PARTNER_IMPORT_MAX_BYTES + 1);

    const result = await parsePartnerWorkbook(oversized);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("file_too_large");
  });
});

describe("validatePartnerImportRows", () => {
  it("passes a valid row through, trimmed", () => {
    const [row] = validatePartnerImportRows([
      { rowNumber: 2, name: "  Công ty A  ", address: "  Hà Nội  ", taxCode: " 0312345678 " },
    ]);

    expect(row).toMatchObject({
      name: "Công ty A",
      address: "Hà Nội",
      taxCode: "0312345678",
      ok: true,
    });
  });

  it("applies the PartnerSchema rules — no second rulebook", () => {
    const rows = validatePartnerImportRows([
      { rowNumber: 2, name: "", address: "", taxCode: "" },
      { rowNumber: 3, name: "a".repeat(201), address: "", taxCode: "" },
      { rowNumber: 4, name: "Công ty", address: "b".repeat(501), taxCode: "" },
      { rowNumber: 5, name: "Công ty", address: "", taxCode: "12345" },
    ]);

    expect(rows[0]).toMatchObject({ ok: false, error: "Tên đối tác không được để trống" });
    expect(rows[1]).toMatchObject({ ok: false, error: "Tên đối tác tối đa 200 ký tự" });
    expect(rows[2]).toMatchObject({ ok: false, error: "Địa chỉ tối đa 500 ký tự" });
    expect(rows[3]?.error).toContain("Mã số thuế phải gồm 10 chữ số");
  });

  it("flags every row that shares a tax code inside the file", () => {
    const rows = validatePartnerImportRows([
      { rowNumber: 2, name: "Công ty A", address: "", taxCode: "0312345678" },
      { rowNumber: 3, name: "Công ty B", address: "", taxCode: "0312345679" },
      { rowNumber: 4, name: "Công ty A (nhánh)", address: "", taxCode: "0312345678" },
    ]);

    expect(rows[0].ok).toBe(false);
    expect(rows[1].ok).toBe(true);
    expect(rows[2].ok).toBe(false);
    expect(rows[0].error).toContain("bị trùng trong file");
    expect(rows[2].error).toContain("bị trùng trong file");
  });

  it("does not treat empty tax codes as duplicates", () => {
    const rows = validatePartnerImportRows([
      { rowNumber: 2, name: "Công ty A", address: "", taxCode: "" },
      { rowNumber: 3, name: "Công ty B", address: "", taxCode: "" },
    ]);

    expect(rows.every((row) => row.ok)).toBe(true);
  });
});

describe("validatePartnerImportFile", () => {
  it("accepts a real .xlsx MIME type", () => {
    expect(
      validatePartnerImportFile({
        name: "danh-sach.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 100,
      }).ok,
    ).toBe(true);
  });

  it("accepts a .xlsx file sent with a generic type", () => {
    // Excel on Windows sends octet-stream; the extension still proves the shape.
    expect(
      validatePartnerImportFile({ name: "danh-sach.xlsx", type: "application/octet-stream" }).ok,
    ).toBe(true);
  });

  it("rejects anything else with the 'save as .xlsx' message", () => {
    const result = validatePartnerImportFile({ name: "danh-sach.csv", type: "text/csv" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("invalid_file_type");
    expect(result.message).toContain("lưu file dạng .xlsx");

    const renamed = validatePartnerImportFile({
      name: "danh-sach.bin",
      type: "application/octet-stream",
    });
    expect(renamed.ok).toBe(false);
  });

  it("rejects an oversized file before anything is read", () => {
    const result = validatePartnerImportFile({
      name: "danh-sach.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: PARTNER_IMPORT_MAX_BYTES + 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("file_too_large");
    expect(result.message).toContain("5 MB");
  });
});

describe("summarisePartnerImport", () => {
  it("counts the two halves of the report", () => {
    const report = summarisePartnerImport([
      { rowNumber: 2, name: "A", address: "", taxCode: "", ok: true, partnerId: "x" },
      { rowNumber: 3, name: "B", address: "", taxCode: "", ok: false, error: "lỗi" },
      { rowNumber: 4, name: "C", address: "", taxCode: "", ok: true, partnerId: "y" },
    ]);

    expect(report.summary).toEqual({ total: 3, ok: 2, failed: 1 });
  });
});

describe("buildPartnerImportTemplate", () => {
  it("produces a workbook that parses back to the expected headers and row", async () => {
    const template = await buildPartnerImportTemplate();
    const parsed = await parsePartnerWorkbook(template);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      name: "Công ty TNHH Ví dụ",
      taxCode: "0312345678",
    });
    expect(parsed.rows[0]?.address).toContain("TP. Hồ Chí Minh");
  });
});
