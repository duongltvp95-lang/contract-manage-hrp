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

import { z } from "zod";

import {
  partnerAbbreviationField,
  partnerAddressField,
  partnerNameField,
  partnerRegionField,
  partnerTaxCodeField,
  type PartnerStatus,
} from "@schemas/partner";

import { foldText } from "@/lib/partner-display";

export const PARTNER_IMPORT_MAX_ROWS = 500;
export const PARTNER_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export const PARTNER_IMPORT_MAX_ARCHIVE_ENTRIES = 200;
export const PARTNER_IMPORT_MAX_SINGLE_ENTRY_BYTES = 25 * 1024 * 1024;
export const PARTNER_IMPORT_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const PARTNER_IMPORT_MAX_PHYSICAL_ROW = 10_000;
export const PARTNER_IMPORT_MAX_SCAN_ROWS = 2_000;
export const PARTNER_IMPORT_MAX_SCAN_COLUMNS = 64;

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

type PartnerImportColumn =
  | "name"
  | "address"
  | "taxCode"
  | "region"
  | "abbreviation"
  | "status"
  | "company";

/**
 * Header aliases, already folded with `foldText`: an accented, unaccented or
 * English header all land on the same string, so the comparison is one exact
 * match against this table.
 */
const HEADER_ALIASES: Record<PartnerImportColumn, string[]> = {
  name: ["ten doi tac", "ten", "ten cong ty", "name"],
  address: ["dia chi", "address"],
  taxCode: ["ma so thue", "mst", "tax code", "tax_code"],
  region: ["khu vuc", "region"],
  abbreviation: ["ten viet tat", "viet tat", "abbreviation"],
  status: ["trang thai hop tac", "trang thai", "status"],
  company: ["cong ty", "company"],
};

/** The seeded company names the import recognises (round 10). */
export const KNOWN_COMPANY_NAMES = ["HRP", "HR VN"] as const;

/** A missing or empty "Công ty" cell defaults to HRP. */
export const DEFAULT_COMPANY = "HRP";

/**
 * The three scalar fields the import validates with the SAME field rules as the
 * form. `status` (defaults to active at the service) and `companyIds` (resolved
 * from the "Công ty" column) are handled separately, so the full `PartnerSchema`
 * is deliberately not used here.
 */
const importFieldsSchema = z.object({
  name: partnerNameField,
  address: partnerAddressField,
  taxCode: partnerTaxCodeField,
  region: partnerRegionField,
  abbreviation: partnerAbbreviationField,
});

/** Raw row as read from the workbook; validation resolves `companyText`. */
export type ParsedPartnerImportRow = {
  /** The Excel row number. The header is row 1; data starts at row 2. */
  rowNumber: number;
  name: string;
  address: string;
  taxCode: string;
  region: string;
  abbreviation: string;
  /** Raw "Trạng thái hợp tác" cell text; empty when the column is absent. */
  statusText: string;
  /** Raw "Công ty" cell text; empty when the column is absent. */
  companyText: string;
  /** Round 25 — true when the file actually has a "Công ty" column. */
  hasCompanyColumn: boolean;
};

export type PartnerImportRow = {
  rowNumber: number;
  name: string;
  address: string;
  taxCode: string;
  region: string;
  abbreviation: string;
  /** Resolved status; null = column missing/empty (service defaults to active). */
  status: PartnerStatus | null;
  /** Resolved company names (e.g. ["HRP", "HR VN"]), at least one. */
  companies: string[];
  /** Round 25 — true when the file actually has a "Công ty" column. */
  hasCompanyColumn: boolean;
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
  | { ok: true; rows: ParsedPartnerImportRow[] }
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
  headerRow: ExcelJS.Row | undefined,
): Partial<Record<PartnerImportColumn, number>> {
  const found: Partial<Record<PartnerImportColumn, number>> = {};
  if (!headerRow) return found;

  // `eachCell` with includeEmpty=false walks only the filled cells.
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    if (columnNumber > PARTNER_IMPORT_MAX_SCAN_COLUMNS) return;
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

const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_ENCRYPTED_FLAG_MASK = 0x0001;

type XlsxArchiveEntrySlice = {
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
};

/**
 * Inspects the PKZIP Central Directory and Local File Header offsets BEFORE
 * handing bytes to `exceljs` so zip bombs, ZIP64 archives, encrypted entries,
 * or workbooks with excessive XML inflation are rejected cheaply in O(entryCount).
 */
export function inspectXlsxArchiveBounds(
  bytes: Uint8Array,
): { ok: true; entries: XlsxArchiveEntrySlice[] } | ({ ok: false } & PartnerImportParseFailure) {
  if (bytes.byteLength < 22) {
    return {
      ok: false,
      code: "unreadable_file",
      message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== ZIP_LOCAL_FILE_HEADER_SIG) {
    return {
      ok: false,
      code: "unreadable_file",
      message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
    };
  }

  const minEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIR_SIG) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    return {
      ok: false,
      code: "unreadable_file",
      message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
    };
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  if (
    totalEntries === 0xffff ||
    centralDirSize === 0xffffffff ||
    centralDirOffset === 0xffffffff
  ) {
    return {
      ok: false,
      code: "file_too_large",
      message:
        "Nội dung giải nén của file vượt giới hạn an toàn. Vui lòng lưu lại file .xlsx gọn nhẹ hơn.",
    };
  }

  if (
    totalEntries === 0 ||
    centralDirOffset > eocdOffset ||
    centralDirSize > eocdOffset - centralDirOffset
  ) {
    return {
      ok: false,
      code: "unreadable_file",
      message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
    };
  }

  if (totalEntries > PARTNER_IMPORT_MAX_ARCHIVE_ENTRIES) {
    return {
      ok: false,
      code: "file_too_large",
      message:
        "File .xlsx chứa quá nhiều thành phần nội bộ. Vui lòng lưu lại thành workbook đơn giản và thử lại.",
    };
  }

  const centralDirEnd = centralDirOffset + centralDirSize;
  let cursor = centralDirOffset;
  let totalUncompressed = 0;
  const entries: XlsxArchiveEntrySlice[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralDirEnd) {
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_DIR_HEADER_SIG) {
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const nextCursor = cursor + 46 + fileNameLen + extraLen + commentLen;

    if (nextCursor > centralDirEnd) {
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    if (
      (flags & ZIP_ENCRYPTED_FLAG_MASK) !== 0 ||
      (compressionMethod !== ZIP_METHOD_STORED && compressionMethod !== ZIP_METHOD_DEFLATE)
    ) {
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      uncompressedSize > PARTNER_IMPORT_MAX_SINGLE_ENTRY_BYTES
    ) {
      return {
        ok: false,
        code: "file_too_large",
        message:
          "Nội dung giải nén của file vượt giới hạn an toàn. Vui lòng xoá các vùng dữ liệu thừa và thử lại.",
      };
    }

    if (
      (compressionMethod === ZIP_METHOD_STORED && compressedSize !== uncompressedSize) ||
      (compressionMethod === ZIP_METHOD_DEFLATE && compressedSize === 0 && uncompressedSize > 0) ||
      localHeaderOffset + 30 > centralDirOffset ||
      view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER_SIG
    ) {
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    if (dataStart > centralDirOffset || compressedSize > centralDirOffset - dataStart) {
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > PARTNER_IMPORT_MAX_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        code: "file_too_large",
        message:
          "Nội dung giải nén của file vượt giới hạn an toàn. Vui lòng xoá các vùng dữ liệu thừa và thử lại.",
      };
    }

    entries.push({
      compressionMethod,
      compressedSize,
      uncompressedSize,
      dataStart,
    });
    cursor = nextCursor;
  }

  return { ok: true, entries };
}

/**
 * Verifies actual DEFLATE inflation bounds chunk-by-chunk without buffering
 * decompressed output (`A05`). Prevents spoofed-header PKZIP bombs (where the
 * Central Directory lies about `uncompressedSize`) from triggering unbounded
 * RAM allocation inside `exceljs` / `JSZip`.
 */
async function verifyXlsxInflatedStreams(
  bytes: Uint8Array,
  entries: XlsxArchiveEntrySlice[],
): Promise<{ ok: true } | ({ ok: false } & PartnerImportParseFailure)> {
  if (typeof DecompressionStream === "undefined") {
    return { ok: true };
  }

  let totalActualUncompressed = 0;

  for (const entry of entries) {
    if (entry.compressionMethod === ZIP_METHOD_STORED || entry.compressedSize === 0) {
      totalActualUncompressed += entry.uncompressedSize;
      if (totalActualUncompressed > PARTNER_IMPORT_MAX_UNCOMPRESSED_BYTES) {
        return {
          ok: false,
          code: "file_too_large",
          message:
            "Nội dung giải nén của file vượt giới hạn an toàn. Vui lòng xoá các vùng dữ liệu thừa và thử lại.",
        };
      }
      continue;
    }

    const slice = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    const remainingBudget = PARTNER_IMPORT_MAX_UNCOMPRESSED_BYTES - totalActualUncompressed;
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    let writeError: unknown = null;
    const pumpPromise = (async () => {
      try {
        const chunkSize = 16 * 1024;
        for (let offset = 0; offset < slice.byteLength; offset += chunkSize) {
          const end = Math.min(slice.byteLength, offset + chunkSize);
          await writer.write(slice.subarray(offset, end) as unknown as BufferSource);
        }
        await writer.close();
      } catch (error) {
        writeError = error;
      }
    })();

    let entryInflated = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        entryInflated += value.byteLength;
        if (
          entryInflated > PARTNER_IMPORT_MAX_SINGLE_ENTRY_BYTES ||
          entryInflated > remainingBudget
        ) {
          await reader.cancel().catch(() => {});
          await writer.abort().catch(() => {});
          await pumpPromise;
          return {
            ok: false,
            code: "file_too_large",
            message:
              "Nội dung giải nén của file vượt giới hạn an toàn. Vui lòng xoá các vùng dữ liệu thừa và thử lại.",
          };
        }
      }
    } catch {
      await reader.cancel().catch(() => {});
      await writer.abort().catch(() => {});
      await pumpPromise;
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    await pumpPromise;
    if (writeError || entryInflated !== entry.uncompressedSize) {
      return {
        ok: false,
        code: "unreadable_file",
        message: "Không đọc được file. Vui lòng kiểm tra lại file .xlsx và thử lại.",
      };
    }

    totalActualUncompressed += entryInflated;
  }

  return { ok: true };
}

function readRowCellText(row: ExcelJS.Row, columnNumber: number | undefined): string {
  if (columnNumber === undefined) return "";
  const sparseRow = row as ExcelJS.Row & {
    findCell?: (col: number) => ExcelJS.Cell | undefined;
  };
  const cell =
    typeof sparseRow.findCell === "function"
      ? sparseRow.findCell(columnNumber)
      : row.getCell(columnNumber);
  if (!cell) return "";
  return cellText(cell as unknown as ExcelJS.CellValue);
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

  const rawBytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const archiveBounds = inspectXlsxArchiveBounds(rawBytes);
  if (!archiveBounds.ok) {
    return archiveBounds;
  }

  const streamBounds = await verifyXlsxInflatedStreams(rawBytes, archiveBounds.entries);
  if (!streamBounds.ok) {
    return streamBounds;
  }

  // Dynamic import, like the audit-log export: keep exceljs out of every bundle
  // that does not parse a workbook.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  try {
    // exceljs accepts both shapes at runtime; its types only declare the legacy
    // Buffer shape, so the value is handed over as whatever load() expects.
    const loadable = Buffer.from(rawBytes);
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

  if (sheet.rowCount > PARTNER_IMPORT_MAX_PHYSICAL_ROW) {
    return {
      ok: false,
      code: "too_many_rows",
      message: `Vùng dữ liệu của sheet trải tới dòng ${sheet.rowCount} (tối đa ${PARTNER_IMPORT_MAX_PHYSICAL_ROW} dòng vật lý). Vui lòng xoá các dòng trống thừa bên dưới và thử lại.`,
    };
  }

  const sparseSheet = sheet as ExcelJS.Worksheet & {
    findRow?: (rowNumber: number) => ExcelJS.Row | undefined;
  };
  const headerRow =
    typeof sparseSheet.findRow === "function" ? sparseSheet.findRow(1) : sheet.getRow(1);
  const columns = detectColumns(headerRow);

  if (columns.name === undefined) {
    return {
      ok: false,
      code: "missing_name_column",
      message:
        "File cần có cột tên đối tác. Các tiêu đề được nhận diện: “Tên đối tác”, “Tên”, “Tên công ty” hoặc “Name”.",
    };
  }

  const rows: ParsedPartnerImportRow[] = [];
  let visitedNonEmptyRows = 0;
  let failure: PartnerImportParseFailure | null = null;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (failure || rowNumber <= 1) return;

    if (rowNumber > PARTNER_IMPORT_MAX_PHYSICAL_ROW) {
      failure = {
        code: "too_many_rows",
        message: `Vùng dữ liệu của sheet trải tới dòng ${rowNumber} (tối đa ${PARTNER_IMPORT_MAX_PHYSICAL_ROW} dòng vật lý). Vui lòng xoá các dòng trống thừa bên dưới và thử lại.`,
      };
      return;
    }

    visitedNonEmptyRows += 1;
    if (visitedNonEmptyRows > PARTNER_IMPORT_MAX_SCAN_ROWS) {
      failure = {
        code: "too_many_rows",
        message: `Sheet có quá nhiều dòng chứa dữ liệu ngoài vùng cột nhập (tối đa ${PARTNER_IMPORT_MAX_SCAN_ROWS} dòng quét). Vui lòng dọn bớt dữ liệu thừa và chia nhỏ file.`,
      };
      return;
    }

    const name = readRowCellText(row, columns.name);
    const address = readRowCellText(row, columns.address);
    const taxCode = readRowCellText(row, columns.taxCode);
    const region = readRowCellText(row, columns.region);
    const abbreviation = readRowCellText(row, columns.abbreviation);
    const statusText = readRowCellText(row, columns.status);
    const companyText = readRowCellText(row, columns.company);

    // A row with nothing in any mapped column is a spacer, not an error.
    if (
      !name.trim() &&
      !address.trim() &&
      !taxCode.trim() &&
      !region.trim() &&
      !abbreviation.trim() &&
      !statusText.trim() &&
      !companyText.trim()
    ) {
      return;
    }

    if (rows.length >= PARTNER_IMPORT_MAX_ROWS) {
      failure = {
        code: "too_many_rows",
        message: `Vượt quá giới hạn ${PARTNER_IMPORT_MAX_ROWS} dòng dữ liệu mỗi lần tải lên. Vui lòng chia nhỏ file.`,
      };
      return;
    }

    rows.push({
      rowNumber,
      name,
      address,
      taxCode,
      region,
      abbreviation,
      statusText,
      companyText,
      hasCompanyColumn: columns.company !== undefined,
    });
  });

  if (failure) {
    return { ok: false, ...(failure as PartnerImportParseFailure) };
  }

  return { ok: true, rows };
}

/**
 * Turns the raw "Công ty" cell into resolved company names.
 *
 * Missing / empty defaults to `["HRP"]`. Values are split on comma/semicolon,
 * trimmed and diacritics-folded, then matched against `KNOWN_COMPANY_NAMES`. An
 * unrecognised token is an error for that row.
 */
function resolveCompanies(
  rawText: string,
): { ok: true; companies: string[] } | { ok: false; error: string } {
  const trimmed = rawText.trim();
  if (!trimmed) return { ok: true, companies: [DEFAULT_COMPANY] };

  const tokens = trimmed
    .split(/[,;，；]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const foldedKnown = new Map(KNOWN_COMPANY_NAMES.map((name) => [foldText(name), name]));
  const companies: string[] = [];

  for (const token of tokens) {
    const matched = foldedKnown.get(foldText(token));
    if (!matched) {
      return { ok: false, error: `Không nhận diện được công ty “${token}”` };
    }
    if (!companies.includes(matched)) companies.push(matched);
  }

  return { ok: true, companies: companies.length > 0 ? companies : [DEFAULT_COMPANY] };
}

/**
 * Turns the raw "Trạng thái hợp tác" cell into the status enum — round 22.
 *
 * Missing / empty → null (the service defaults to active). The accepted
 * spellings are folded with `foldText` (lowercase, no diacritics, đ→d), so
 * "Đã dừng hợp tác", "NGỪNG HỢP TÁC", "stopped" and "active" all resolve.
 * Anything else is an error for that row, with the valid values listed.
 */
function resolveStatus(
  rawText: string,
): { ok: true; status: PartnerStatus | null } | { ok: false; error: string } {
  const trimmed = rawText.trim();
  if (!trimmed) return { ok: true, status: null };

  const folded = foldText(trimmed);
  if (folded === "dang hop tac" || folded === "active") {
    return { ok: true, status: "active" };
  }
  if (
    folded === "da dung hop tac" ||
    folded === "ngung hop tac" ||
    folded === "dung hop tac" ||
    folded === "stopped"
  ) {
    return { ok: true, status: "stopped" };
  }

  return {
    ok: false,
    error: `Không nhận diện được trạng thái “${trimmed}”. Giá trị hợp lệ: “Đang hợp tác” hoặc “Đã dừng hợp tác”.`,
  };
}

/**
 * Validates parsed rows with the SAME `PartnerSchema` the form uses — no second
 * set of rules — resolves the status and company columns, and flags a tax code
 * that appears more than once inside the file. Every duplicated row is marked,
 * not just the second one, so the fix is obvious from the report alone.
 */
export function validatePartnerImportRows(
  rows: ParsedPartnerImportRow[],
): PartnerImportRow[] {
  const validated = rows.map((row): PartnerImportRow => {
    const parsed = importFieldsSchema.safeParse({
      name: row.name,
      address: row.address,
      taxCode: row.taxCode,
      region: row.region,
      abbreviation: row.abbreviation,
    });

    if (!parsed.success) {
      return {
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        region: row.region,
        abbreviation: row.abbreviation,
        status: null,
        companies: [DEFAULT_COMPANY],
        hasCompanyColumn: row.hasCompanyColumn,
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      };
    }

    const status = resolveStatus(row.statusText);
    if (!status.ok) {
      return {
        rowNumber: row.rowNumber,
        name: parsed.data.name,
        address: parsed.data.address ?? "",
        taxCode: parsed.data.taxCode ?? "",
        region: parsed.data.region ?? "",
        abbreviation: parsed.data.abbreviation ?? "",
        status: null,
        companies: [DEFAULT_COMPANY],
        hasCompanyColumn: row.hasCompanyColumn,
        ok: false,
        error: status.error,
      };
    }

    const companies = resolveCompanies(row.companyText);
    if (!companies.ok) {
      return {
        rowNumber: row.rowNumber,
        name: parsed.data.name,
        address: parsed.data.address ?? "",
        taxCode: parsed.data.taxCode ?? "",
        region: parsed.data.region ?? "",
        abbreviation: parsed.data.abbreviation ?? "",
        status: status.status,
        companies: [DEFAULT_COMPANY],
        hasCompanyColumn: row.hasCompanyColumn,
        ok: false,
        error: companies.error,
      };
    }

    return {
      rowNumber: row.rowNumber,
      name: parsed.data.name,
      address: parsed.data.address ?? "",
      taxCode: parsed.data.taxCode ?? "",
      region: parsed.data.region ?? "",
      abbreviation: parsed.data.abbreviation ?? "",
      status: status.status,
      companies: companies.companies,
      hasCompanyColumn: row.hasCompanyColumn,
      ok: true,
    };
  });

  // Round 25: the in-file duplicate flag is GONE — two rows with the same tax
  // code (or any other key) now merge into one partner instead of failing.
  return validated;
}

export type PartnerImportRowReport = PartnerImportRow & {
  /** Set when this row was actually imported (created or merged). */
  partnerId?: string;
  /** Round 25 — true when the row MERGED into (or will merge into) an existing partner. */
  updated?: boolean;
  /** Round 25 — the partner this row will overwrite (preview only). */
  matchedPartnerName?: string;
};

export type PartnerImportSummary = {
  total: number;
  /** Preview: số dòng hợp lệ. Import: số dòng đã nhập (mới + cập nhật). */
  ok: number;
  /** Preview: số dòng không hợp lệ. Import: số dòng lỗi (kể cả trùng DB). */
  failed: number;
  /** Round 25 — số dòng ghi đè lên đối tác đã có. */
  updated: number;
};

export type PartnerImportReport = {
  rows: PartnerImportRowReport[];
  summary: PartnerImportSummary;
};

/** Builds the report shape both actions return. Pure, so it is unit-tested. */
export function summarisePartnerImport(rows: PartnerImportRowReport[]): PartnerImportReport {
  const okCount = rows.filter((row) => row.ok).length;
  const updatedCount = rows.filter((row) => row.updated).length;

  return {
    rows,
    summary: {
      total: rows.length,
      ok: okCount,
      failed: rows.length - okCount,
      updated: updatedCount,
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
    { header: "Tên viết tắt", key: "abbreviation", width: 16 },
    { header: "Khu vực", key: "region", width: 20 },
    { header: "Địa chỉ", key: "address", width: 44 },
    { header: "Mã số thuế", key: "taxCode", width: 16 },
    { header: "Công ty", key: "company", width: 16 },
    { header: "Trạng thái hợp tác", key: "status", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  sheet.addRow({
    name: "Công ty TNHH Ví dụ",
    abbreviation: "CTYVD",
    region: "Miền Nam",
    address: "123 Đường ABC, Quận 1, TP. Hồ Chí Minh",
    taxCode: "0312345678",
    company: "HRP",
    status: "Đang hợp tác",
  });

  return (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
}
