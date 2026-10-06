/**
 * Partner import from Excel — feature round 7, part 1.
 *
 * PURE module: no Supabase, no Next.js, no `server-only`. The same rules are
 * reused by the server actions, the test-only probe route and the unit suite, so
 * "what does a valid import file look like?" is answered in exactly one place.
 *
 * exceljs is loaded dynamically inside `parsePartnerWorkbook`, mirroring the
 * audit-log export route: the ≈ 925 KB library stays out of any bundle that
 * does not actually parse a workbook, and the rest of this module stays
 * importable from client code (the file picker in part 2 needs the size/type
 * rules without pulling exceljs into the browser).
 */

import type ExcelJS from "exceljs";

import { PartnerSchema } from "@schemas/partner";

import { foldText } from "@/lib/partner-display";

export const PARTNER_IMPORT_MAX_ROWS = 500;
export const PARTNER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The accepted MIME types — one: a real .xlsx workbook.
 *
 * A file named `*.xlsx` sent with the generic `application/octet-stream` type is
 * also accepted (Excel on Windows sends that), but only when the NAME ends in
 * `.xlsx`. Everything else is refused before any parsing happens.
 */
export const PARTNER_IMPORT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export type PartnerImportFileLike = {
  name?: string;
  type?: string;
  size?: number;
};

export type PartnerImportFileFailure = {
  code: "invalid_file_type" | "file_too_large";
  message: string;
};

/**
 * Size and type gate, run BEFORE the file is read.
 *
 * Pure and cheap on purpose: the upload dialog in part 2 calls this as the user
 * picks a file, long before anything touches the network.
 */
export function validatePartnerImportFile(
  file: PartnerImportFileLike,
): { ok: true } | ({ ok: false } & PartnerImportFileFailure) {
  const type = String(file.type ?? "").toLowerCase();
  const name = String(file.name ?? "");
  const isXlsxMime = PARTNER_IMPORT_MIME_TYPES.includes(type);
  const isGenericType = type === "" || type === "application/octet-stream";
  const isXlsxName = name.toLowerCase().endsWith(".xlsx");

  if (!isXlsxMime && !(isGenericType && isXlsxName)) {
    return {
      ok: false,
      code: "invalid_file_type",
      message: "File không đúng định dạng. Vui lòng lưu file dạng .xlsx và tải lên lại.",
    };
  }

  if (file.size !== undefined && file.size > PARTNER_IMPORT_MAX_BYTES) {
    return {
      ok: false,
      code: "file_too_large",
      message: `File quá lớn. Giới hạn ${PARTNER_IMPORT_MAX_BYTES / (1024 * 1024)} MB mỗi lần tải lên.`,
    };
  }

  return { ok: true };
}

type PartnerImportColumn = "name" | "address" | "taxCode";

/**
 * Header aliases, already folded with `foldText`: an accented, unaccented or
 * English header all land on the same string, so the comparison is one exact
 * match against this table.
 */
const HEADER_ALIASES: Record<PartnerImportColumn, string[]> = {
  name: ["ten doi tac", "ten", "ten cong ty", "name"],
  address: ["dia chi", "address"],
  taxCode: ["ma so thue", "mst", "tax code", "tax_code"],
};

export type PartnerImportRow = {
  /** The Excel row number. The header is row 1; data starts at row 2. */
  rowNumber: number;
  name: string;
  address: string;
  taxCode: string;
  ok: boolean;
  error?: string;
};

export type PartnerImportParseFailure = {
  code:
    | "file_too_large"
    | "missing_name_column"
    | "too_many_rows"
    | "unreadable_file";
  message: string;
};

type ParseResult =
  | { ok: true; rows: PartnerImportRow[] }
  | ({ ok: false } & PartnerImportParseFailure);

/**
 * Turns an exceljs cell value into plain text.
 *
 * Strings pass through; numbers become their decimal string (a tax code entered
 * as a number keeps its digits); rich text contributes its text; a formula
 * contributes its cached result. Anything else (dates, objects we cannot read)
 * is treated as empty rather than guessed.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const record = value as unknown as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (record.result !== undefined && record.result !== null) {
      return cellText(record.result as ExcelJS.CellValue);
    }
  }
  return "";
}

function detectColumns(
  headerRow: ExcelJS.Row,
): Partial<Record<PartnerImportColumn, number>> {
  const found: Partial<Record<PartnerImportColumn, number>> = {};

  // `eachCell` with includeEmpty=false walks only the filled cells.
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const text = foldText(cellText(cell.value));
    if (!text) return;

    for (const key of Object.keys(HEADER_ALIASES) as PartnerImportColumn[]) {
      if (found[key] === undefined && HEADER_ALIASES[key].includes(text)) {
        found[key] = columnNumber;
      }
    }
  });

  return found;
}

/**
 * Reads one workbook into per-row records.
 *
 * The buffer may be an `ArrayBuffer` (what `File.arrayBuffer()` yields in the
 * actions) or a `Uint8Array` (what exceljs itself writes back — the unit suite
 * builds its fixtures with it). exceljs accepts both.
 *
 * Row 1 is the header; the name column is mandatory, address and tax code are
 * optional columns (a missing column simply yields empty values). Completely
 * empty rows are skipped. More than `PARTNER_IMPORT_MAX_ROWS` data rows is an
 * error, not a truncation — silently importing half a file is worse than
 * asking the user to split it.
 */
export async function parsePartnerWorkbook(
  buffer: ArrayBuffer | Uint8Array,
): Promise<ParseResult> {
  // Size is checked before the parse, on the raw bytes.
  if (buffer.byteLength > PARTNER_IMPORT_MAX_BYTES) {
    return {
      ok: false,
      code: "file_too_large",
      message: `File quá lớn. Giới hạn ${PARTNER_IMPORT_MAX_BYTES / (1024 * 1024)} MB mỗi lần tải lên.`,
    };
  }

  // Dynamic import, like the audit-log export: keep exceljs out of every bundle
  // that does not parse a workbook.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  try {
    // exceljs accepts both shapes at runtime; its types only declare the legacy
    // Buffer shape, so the value is handed over as whatever load() expects.
    const loadable =
      buffer instanceof ArrayBuffer ? Buffer.from(new Uint8Array(buffer)) : Buffer.from(buffer);
    await workbook.xlsx.load(
      loadable as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    return {
      ok: false,
      code: "unreadable_file",
      message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
    };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      ok: false,
      code: "unreadable_file",
      message: "File không có sheet nào. Vui lòng kiểm tra lại file .xlsx và thử lại.",
    };
  }

  const columns = detectColumns(sheet.getRow(1));

  if (columns.name === undefined) {
    return {
      ok: false,
      code: "missing_name_column",
      message:
        "File cần có cột tên đối tác. Các tiêu đề được nhận diện: “Tên đối tác”, “Tên”, “Tên công ty” hoặc “Name”.",
    };
  }

  const rows: PartnerImportRow[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const name = cellText(row.getCell(columns.name));
    const address =
      columns.address !== undefined ? cellText(row.getCell(columns.address)) : "";
    const taxCode =
      columns.taxCode !== undefined ? cellText(row.getCell(columns.taxCode)) : "";

    // A row with nothing in any mapped column is a spacer, not an error.
    if (!name.trim() && !address.trim() && !taxCode.trim()) continue;

    if (rows.length >= PARTNER_IMPORT_MAX_ROWS) {
      return {
        ok: false,
        code: "too_many_rows",
        message: `Vượt quá giới hạn ${PARTNER_IMPORT_MAX_ROWS} dòng dữ liệu mỗi lần tải lên. Vui lòng chia nhỏ file.`,
      };
    }

    rows.push({ rowNumber, name, address, taxCode, ok: true });
  }

  return { ok: true, rows };
}

/**
 * Validates parsed rows with the SAME `PartnerSchema` the form uses — no second
 * set of rules — and flags a tax code that appears more than once inside the
 * file. Every duplicated row is marked, not just the second one, so the fix is
 * obvious from the report alone.
 */
export function validatePartnerImportRows(
  rows: Pick<PartnerImportRow, "rowNumber" | "name" | "address" | "taxCode">[],
): PartnerImportRow[] {
  const validated = rows.map((row): PartnerImportRow => {
    const parsed = PartnerSchema.safeParse({
      name: row.name,
      address: row.address,
      taxCode: row.taxCode,
    });

    if (!parsed.success) {
      return {
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      };
    }

    return {
      rowNumber: row.rowNumber,
      name: parsed.data.name,
      address: parsed.data.address ?? "",
      taxCode: parsed.data.taxCode ?? "",
      ok: true,
    };
  });

  const occurrences = new Map<string, number>();
  for (const row of validated) {
    const code = row.taxCode.trim();
    if (!code) continue;
    occurrences.set(code, (occurrences.get(code) ?? 0) + 1);
  }

  return validated.map((row) => {
    const code = row.taxCode.trim();
    if (code && (occurrences.get(code) ?? 0) > 1) {
      return {
        ...row,
        ok: false,
        error: `Mã số thuế “${code}” bị trùng trong file`,
      };
    }
    return row;
  });
}

export type PartnerImportRowReport = PartnerImportRow & {
  /** Set when this row was actually imported. */
  partnerId?: string;
};

export type PartnerImportSummary = {
  total: number;
  /** Preview: số dòng hợp lệ. Import: số dòng đã nhập. */
  ok: number;
  /** Preview: số dòng không hợp lệ. Import: số dòng lỗi (kể cả trùng DB). */
  failed: number;
};

export type PartnerImportReport = {
  rows: PartnerImportRowReport[];
  summary: PartnerImportSummary;
};

/** Builds the report shape both actions return. Pure, so it is unit-tested. */
export function summarisePartnerImport(rows: PartnerImportRowReport[]): PartnerImportReport {
  const okCount = rows.filter((row) => row.ok).length;

  return {
    rows,
    summary: {
      total: rows.length,
      ok: okCount,
      failed: rows.length - okCount,
    },
  };
}

export const PARTNER_IMPORT_TEMPLATE_FILENAME = "mau-nhap-doi-tac.xlsx";

/**
 * The downloadable sample workbook: the three recognised headers plus one
 * example row.
 *
 * Generated with the same exceljs that parses uploads, so the template is
 * guaranteed to parse. The unit suite asserts exactly that — the template is
 * round-tripped through `parsePartnerWorkbook`.
 */
export async function buildPartnerImportTemplate(): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Đối tác");

  sheet.columns = [
    { header: "Tên đối tác", key: "name", width: 36 },
    { header: "Địa chỉ", key: "address", width: 44 },
    { header: "Mã số thuế", key: "taxCode", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  sheet.addRow({
    name: "Công ty TNHH Ví dụ",
    address: "123 Đường ABC, Quận 1, TP. Hồ Chí Minh",
    taxCode: "0312345678",
  });

  return (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
}
