import "server-only";
import path from "path";

/**
 * Trích văn bản chọn được từ PDF bằng PDF.js.
 * Dùng legacy build cho Node.js (tránh warning).
 *
 * Chiến lược:
 * 1. Load PDF với PDF.js (chỉ server-side).
 * 2. Quét N trang đầu để tìm text.
 * 3. Nếu tổng text length >= minTextLength → có text layer → trả về text.
 * 4. Nếu không → có thể là scan → trả về null (dùng luồng base64).
 *
 * Lazy initialization: worker chỉ được khởi tạo khi function được gọi lần đầu.
 * Điều này tránh lỗi "Invalid PDF structure" khi module được import trong test
 * với buffer không phải PDF thật.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
let _pdfjsLib: Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>> | null = null;

async function getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.mjs") as Awaited<
    ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>
  >;

  // Dùng local worker (khớp version với pdf.mjs đã import)
  // file:// protocol bắt buộc trên Windows
  const workerPath = path.resolve(
    require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    "..",
    "pdf.worker.mjs",
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = `file:///${workerPath.replace(/\\/g, "/")}`;

  _pdfjsLib = pdfjsLib;
  return pdfjsLib;
}

export interface PdfTextResult {
  text: string;
  pageCount: number;
}

const DEFAULT_MAX_PAGES = 3;
const DEFAULT_MIN_TEXT_LENGTH = 100;

/**
 * Trích văn bản từ PDF.
 *
 * @param buffer - Buffer của file PDF.
 * @param options.maxPages - Số trang tối đa cần quét (mặc định 3).
 * @param options.minTextLength - Độ dài text tối thiểu để coi là có text layer (mặc định 100).
 * @returns { text, pageCount } nếu có text layer, hoặc null nếu có thể là scan / lỗi.
 */
export async function extractPdfText(
  buffer: Buffer,
  options?: { maxPages?: number; minTextLength?: number },
): Promise<PdfTextResult | null> {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const minTextLength = options?.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;

  try {
    const pdfjsLib = await getPdfJs();
    const uint8 = new Uint8Array(buffer);

    const pdf = await pdfjsLib.getDocument({
      data: uint8,
      useSystemFonts: true,
      disableFontFace: true,
    });

    const pageCount = pdf.numPages;
    const pagesToScan = Math.min(pageCount, maxPages);

    let totalText = "";

    for (let i = 1; i <= pagesToScan; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: { str?: string }) => item.str ?? "")
        .join(" ")
        .trim();

      totalText += pageText + "\n";
    }

    // Đủ text → có text layer → dùng được
    if (totalText.length >= minTextLength) {
      return { text: totalText.trim(), pageCount };
    }

    return null; // Text ít quá → có thể là scan
  } catch {
    // PDF không hợp lệ hoặc lỗi đọc → fallback xuống base64
    return null;
  }
}

/**
 * Kiểm tra nhanh PDF có text layer không.
 */
export async function hasPdfTextLayer(
  buffer: Buffer,
  options?: { maxPages?: number; minTextLength?: number },
): Promise<boolean> {
  const result = await extractPdfText(buffer, options);
  return result !== null;
}
