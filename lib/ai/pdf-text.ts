import "server-only";

/**
 * Trích xuất văn bản thuần từ PDF có text layer (không phải scan).
 *
 * Mục đích (G2 v2 — sửa BUG-1):
 * - File này từng bị missing trong repo (handover 2026-10-17 ghi nhầm là có).
 * - `lib/ai/gemini.ts` đang dynamic import nó nhưng luôn throw.
 * - Tạo lại để PDF text extraction hoạt động → gửi text thuần cho Gemini
 *   nhanh hơn base64 cho PDF scan-mode.
 *
 * Return `null` khi:
 * - PDF không có text layer (scan/image-only).
 * - Text quá ngắn (< 50 ký tự) — coi như không trích được.
 * - Timeout 8s (PDF quá nặng).
 * - Lỗi parse.
 *
 * Dùng pdfjs-dist@6.x (đã có trong package.json).
 */

export type PdfTextResult = {
  text: string;
  pageCount: number;
  isTruncated?: boolean;
};

const MIN_TEXT_LENGTH = 50; // < 50 ký tự coi như scan
const TIMEOUT_MS = 8_000;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_CHARACTERS = 24_000;

export type PdfTextLimits = {
  maxPages?: number;
  maxCharacters?: number;
};

export async function extractPdfText(
  buffer: Buffer,
  timeoutMs: number = TIMEOUT_MS,
  limits: PdfTextLimits = {},
): Promise<PdfTextResult | null> {
  if (!buffer || buffer.length === 0) return null;

  const maxPages = Math.max(1, Math.floor(limits.maxPages ?? DEFAULT_MAX_PAGES));
  const maxCharacters = Math.max(
    MIN_TEXT_LENGTH,
    Math.floor(limits.maxCharacters ?? DEFAULT_MAX_CHARACTERS),
  );

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let isCancelled = false;
  let loadingTask: { destroy?: () => Promise<void> } | undefined;
  let currentPdf: { destroy?: () => Promise<void> } | undefined;

  try {
    // Timeout guard — giới hạn toàn bộ quá trình đọc PDF (bao gồm cả load doc và toàn bộ vòng lặp getTextContent)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        isCancelled = true;
        if (loadingTask && typeof loadingTask.destroy === "function") {
          loadingTask.destroy().catch(() => {});
        }
        if (currentPdf && typeof currentPdf.destroy === "function") {
          currentPdf.destroy().catch(() => {});
        }
        reject(new Error("PDF parse timeout"));
      }, Math.max(50, timeoutMs));
    });

    const parseProcess = async (): Promise<PdfTextResult | null> => {
      // Dynamic import legacy build dành riêng cho môi trường Node.js server, tránh in warning ra stderr
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (isCancelled) {
        return null;
      }

      // pdfjs v6: cần set workerSrc khi dùng Worker; trên Node server fallback chạy fake worker an toàn.
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";
      } catch {
        // ignore — fallback về fake worker
      }

      if (isCancelled) {
        return null;
      }

      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        disableFontFace: true,
        // Tránh fetch CMaps/font ngoài — chỉ dùng standard fonts built-in.
        verbosity: 0,
      });

      const pdf = await (loadingTask as {
        promise: Promise<{
          numPages: number;
          getPage: (i: number) => Promise<{
            getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
          }>;
          destroy?: () => Promise<void>;
        }>;
      }).promise;

      currentPdf = pdf;
      if (isCancelled) {
        if (pdf && typeof pdf.destroy === "function") {
          pdf.destroy().catch(() => {});
        }
        return null;
      }

      const pageTexts: string[] = [];
      let outputCharacters = 0;
      let textTruncated = false;
      const pagesToRead = Math.min(pdf.numPages, maxPages);
      for (let i = 1; i <= pagesToRead; i++) {
        if (isCancelled) {
          if (pdf && typeof pdf.destroy === "function") {
            pdf.destroy().catch(() => {});
          }
          return null;
        }
        const page = await pdf.getPage(i);
        if (isCancelled) {
          if (pdf && typeof pdf.destroy === "function") {
            pdf.destroy().catch(() => {});
          }
          return null;
        }
        const content = await page.getTextContent();
        if (isCancelled) {
          if (pdf && typeof pdf.destroy === "function") {
            pdf.destroy().catch(() => {});
          }
          return null;
        }
        const itemTexts: string[] = [];
        let pageCharacters = 0;
        for (const item of content.items) {
          if (!("str" in item) || typeof item.str !== "string" || !item.str) continue;
          const separator = itemTexts.length > 0 ? " " : "";
          const pageSeparator = pageTexts.length > 0 && itemTexts.length === 0 ? "\n\n" : "";
          const remaining = maxCharacters - outputCharacters - pageCharacters - separator.length - pageSeparator.length;
          if (remaining <= 0) {
            textTruncated = true;
            break;
          }
          const value = item.str.slice(0, remaining);
          itemTexts.push(value);
          pageCharacters += separator.length + value.length;
          if (value.length < item.str.length) {
            textTruncated = true;
            break;
          }
        }

        const pageText = itemTexts.join(" ").trim();
        if (pageText) {
          const pageSeparator = pageTexts.length > 0 ? "\n\n" : "";
          const remaining = maxCharacters - outputCharacters - pageSeparator.length;
          const boundedPageText = pageText.slice(0, Math.max(0, remaining));
          if (boundedPageText) {
            pageTexts.push(boundedPageText);
            outputCharacters += pageSeparator.length + boundedPageText.length;
          }
          if (boundedPageText.length < pageText.length) textTruncated = true;
        }

        if (textTruncated) {
          break;
        }
      }

      if (pdf && typeof pdf.destroy === "function") {
        pdf.destroy().catch(() => {});
      }

      const isTruncated = pdf.numPages > pagesToRead || textTruncated;
      let fullText = pageTexts.join("\n\n").trim();
      if (isTruncated) {
        const note = `\n\n[Lưu ý: Nội dung đã được giới hạn ở ${pagesToRead} trang đầu và tối đa ${maxCharacters} ký tự.]`;
        fullText = `${fullText.slice(0, Math.max(0, maxCharacters - note.length))}${note}`;
      }
      if (fullText.length < MIN_TEXT_LENGTH) {
        return null;
      }

      return { text: fullText, pageCount: pdf.numPages, isTruncated };
    };

    return await Promise.race([parseProcess(), timeoutPromise]);
  } catch {
    // Mọi lỗi (timeout, parse fail, worker load fail, import fail) → coi như không trích được.
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export interface UsableTextOptions {
  isTruncated?: boolean;
}

/**
 * Kiểm tra xem lớp văn bản trích xuất từ PDF có đủ chất lượng và nội dung pháp lý
 * để thay thế việc gửi hình ảnh/file gốc lên Gemini không.
 * Nếu text bị cắt ngắn (isTruncated), quá ngắn (< 250 ký tự), OCR nhiễu/rác, hoặc
 * thiếu các cấu trúc pháp lý cơ bản (tiêu đề, các bên, điều khoản), trả về false
 * để hệ thống gửi tệp gốc cho Gemini nhận diện thị giác/file đầy đủ.
 */
export function isUsableContractPdfText(
  text: string | null | undefined,
  options?: UsableTextOptions,
): boolean {
  if (options?.isTruncated) {
    // Tài liệu vượt quá 10 trang hoặc 12.000 ký tự: gửi file gốc lên Gemini để
    // xử lý toàn bộ các trang (tránh mất trang phụ lục/chữ ký sau trang 10).
    return false;
  }
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 250) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 25) return false;

  // Lọc nhiễu OCR: tỷ lệ ký tự chữ và số so với tổng ký tự không khoảng trắng >= 65%
  const cleanAlphaNum = trimmed.replace(/[^\p{L}\p{N}]/gu, "").length;
  const nonWhitespace = trimmed.replace(/\s+/g, "").length;
  if (nonWhitespace === 0 || cleanAlphaNum / nonWhitespace < 0.65) {
    return false;
  }

  // Lọc chuỗi dính liền bất thường (OCR hỏng khoảng trắng)
  const abnormalLongWords = words.filter((w) => w.length > 35).length;
  if (abnormalLongWords > 0 && abnormalLongWords / words.length > 0.05) {
    return false;
  }

  // Yêu cầu tối thiểu 2 trong 3 nhóm dấu hiệu cấu trúc pháp lý hợp đồng:
  // 1. Tiêu đề / bản chất văn bản
  const hasTitle = /(?:h[ợo]p\s*đ[ồo]ng|ph[ụu]\s*l[ụu]c|tho[ảa]\s*thu[ậa]n|contract|agreement|addendum|annex)/i.test(trimmed);
  // 2. Chủ thể tham gia / đại diện / quốc hiệu
  const hasParties = /(?:b[êe]n\s*[ab]|c[ộo]ng\s*h[òo]a\s*x[ãa]\s*h[ộo]i|đ[ộo]c\s*l[ậa]p\s*-\s*t[ựu]\s*do|đ[ạa]i\s*di[ệe]n|công\s*ty|party\s*[ab]|company)/i.test(trimmed);
  // 3. Điều khoản / giá trị / thanh toán / chữ ký
  const hasTerms = /(?:đi[ềe]u\s*\d+|đi[ềe]u\s*kho[ảa]n|quy[ềe]n\s*v[àa]\s*ngh[iĩ]a\s*v[ụu]|gi[áa]\s*tr[ịi]|thanh\s*to[áa]n|hi[ệe]u\s*l[ựu]c|ch[ữu]\s*k[ýy]|article\s*\d+|terms\s*(?:and|&)\s*conditions)/i.test(trimmed);

  const matchedGroups = (hasTitle ? 1 : 0) + (hasParties ? 1 : 0) + (hasTerms ? 1 : 0);
  return matchedGroups >= 2;
}

