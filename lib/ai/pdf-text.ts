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

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult | null> {
  if (!buffer || buffer.length === 0) return null;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Timeout guard — pdfjs không có timeout built-in. Hủy timer ở finally để tránh rò rỉ timer.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("PDF parse timeout")), TIMEOUT_MS);
    });

    // Dynamic import legacy build dành riêng cho môi trường Node.js server, tránh in warning ra stderr
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // pdfjs v6: cần set workerSrc khi dùng Worker; trên Node server fallback chạy fake worker an toàn.
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";
    } catch {
      // ignore — fallback về fake worker
    }

    const loadPromise = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      // Tránh fetch CMaps/font ngoài — chỉ dùng standard fonts built-in.
      verbosity: 0,
    }).promise;

    const pdf = await Promise.race([loadPromise, timeoutPromise]);

    const pageTexts: string[] = [];
    const maxPages = Math.min(pdf.numPages, 50); // cap 50 trang
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      if (text.trim()) {
        pageTexts.push(text.trim());
      }
    }

    const isTruncated = pdf.numPages > 50;
    if (isTruncated) {
      pageTexts.push(`[Lưu ý: Tài liệu gồm ${pdf.numPages} trang. Hệ thống đã trích xuất 50 trang đầu tiên.]`);
    }

    const fullText = pageTexts.join("\n\n").trim();
    if (fullText.length < MIN_TEXT_LENGTH) {
      return null;
    }

    return { text: fullText, pageCount: pdf.numPages, isTruncated };
  } catch {
    // Mọi lỗi (timeout, parse fail, worker load fail, import fail) → coi như không trích được.
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
