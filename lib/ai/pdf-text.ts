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
 * Dùng pdfjs-dist@6.x (đã có trong package.json) — entry `build/pdf.mjs`.
 */

export type PdfTextResult = {
  text: string;
  pageCount: number;
};

const MIN_TEXT_LENGTH = 50; // < 50 ký tự coi như scan
const TIMEOUT_MS = 8_000;

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult | null> {
  if (!buffer || buffer.length === 0) return null;

  // Dynamic import để tránh bundle pdfjs vào client (lib/ai/gemini.ts chỉ chạy server).
  // Nếu pdfjs chưa cài hoặc path sai → throw, caller (gemini.ts) nuốt lỗi qua try-catch.
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    return null;
  }

  try {
    // pdfjs v6: cần set workerSrc khi dùng Worker; nếu chạy Node server (không có Worker global)
    // thì có thể tắt worker bằng `useWorkerFetch: false` + `isEvalSupported: false`.
    // Tuy nhiên đơn giản nhất: set GlobalWorkerOptions.workerPort = null để chạy inline.
    if (pdfjs.GlobalWorkerOptions) {
      // Trỏ worker tới file local. Nếu file không tồn tại, pdfjs vẫn fallback chạy
      // fake worker (chậm hơn nhưng vẫn chạy được).
      try {
        pdfjs.GlobalWorkerOptions.workerSrc =
          "pdfjs-dist/legacy/build/pdf.worker.mjs";
      } catch {
        // ignore
      }
    }

    // Timeout guard — pdfjs không có timeout built-in.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("PDF parse timeout")), TIMEOUT_MS);
    });

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

    const fullText = pageTexts.join("\n\n").trim();
    if (fullText.length < MIN_TEXT_LENGTH) {
      return null;
    }

    return { text: fullText, pageCount: pdf.numPages };
  } catch {
    // Mọi lỗi (timeout, parse fail, worker load fail) → coi như không trích được.
    return null;
  }
}
