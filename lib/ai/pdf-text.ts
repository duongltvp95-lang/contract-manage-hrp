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

export async function extractPdfText(
  buffer: Buffer,
  timeoutMs: number = TIMEOUT_MS,
): Promise<PdfTextResult | null> {
  if (!buffer || buffer.length === 0) return null;

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
      const maxPages = Math.min(pdf.numPages, 50); // cap 50 trang
      for (let i = 1; i <= maxPages; i++) {
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
        const text = content.items
          .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
          .join(" ");
        if (text.trim()) {
          pageTexts.push(text.trim());
        }
      }

      if (pdf && typeof pdf.destroy === "function") {
        pdf.destroy().catch(() => {});
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
