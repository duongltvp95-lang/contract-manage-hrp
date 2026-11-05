import {
  isUsableContractPdfText,
  MIN_ANY_PAGE_CHARS,
  MIN_FIRST_PAGE_CHARS,
  PDF_TEXT_MAX_CHARACTERS,
  PDF_TEXT_MAX_PAGES,
} from "./pdf-text-shared";

/**
 * Trích xuất nhanh lớp văn bản PDF ngay trên trình duyệt trước khi tải tệp lên R2.
 *
 * Lưu ý quan trọng:
 * - Chỉ được import động (`await import("@/lib/ai/pdf-text-client")`) bên trong hàm xử lý
 *   sự kiện ở trình duyệt — KHÔNG import tĩnh ở đầu component để tránh lỗi SSR khi
 *   `pdfjs-dist` truy cập `document` / `window`.
 * - Dừng sớm tức thì (< 80ms) nếu tài liệu > 30 trang hoặc phát hiện trang scan/lai
 *   (trang 1 < 80 ký tự hoặc bất kỳ trang nào < 30 ký tự) để chuyển ngay sang luồng tải tệp gốc.
 */

export type ClientPdfTextOutcome =
  | {
      status: "usable";
      text: string;
      pageCount: number;
      elapsedMs: number;
    }
  | {
      status: "unusable";
      reason: "too_many_pages" | "empty_or_hybrid_page" | "truncated" | "quality_check";
      pageCount?: number;
      elapsedMs: number;
    }
  | {
      status: "error";
      errorName: string;
      elapsedMs: number;
    };

const CLIENT_PDF_TIMEOUT_MS = 2_500;

export async function extractClientUsablePdfText(
  data: ArrayBuffer | Uint8Array,
  timeoutMs: number = CLIENT_PDF_TIMEOUT_MS,
): Promise<ClientPdfTextOutcome> {
  const startedAt = Date.now();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) {
    return { status: "unusable", reason: "quality_check", elapsedMs: 0 };
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let isCancelled = false;
  let loadingTask: { destroy?: () => Promise<void> } | undefined;
  let currentPdf: { destroy?: () => Promise<void> } | undefined;

  const destroyDoc = () => {
    if (currentPdf && typeof currentPdf.destroy === "function") {
      currentPdf.destroy().catch(() => {});
      currentPdf = undefined;
    }
    if (loadingTask && typeof loadingTask.destroy === "function") {
      loadingTask.destroy().catch(() => {});
      loadingTask = undefined;
    }
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        isCancelled = true;
        destroyDoc();
        const err = new Error("Client PDF parse timeout");
        err.name = "TimeoutError";
        reject(err);
      }, Math.max(100, timeoutMs));
    });

    const parseProcess = async (): Promise<ClientPdfTextOutcome> => {
      const pdfjs = await import("pdfjs-dist");

      if (isCancelled) {
        return { status: "error", errorName: "TimeoutError", elapsedMs: Date.now() - startedAt };
      }

      const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
      if (isBrowser && !pdfjs.GlobalWorkerOptions.workerSrc) {
        try {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).toString();
        } catch {
          // Bỏ qua nếu môi trường bundler/test không hỗ trợ URL worker
        }
      } else if (!isBrowser && !pdfjs.GlobalWorkerOptions.workerSrc) {
        try {
          pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/build/pdf.worker.mjs";
        } catch {
          // ignore
        }
      }

      loadingTask = pdfjs.getDocument({
        data: bytes.slice(),
        useSystemFonts: true,
        disableFontFace: true,
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
        destroyDoc();
        return { status: "error", errorName: "TimeoutError", elapsedMs: Date.now() - startedAt };
      }

      // Dừng sớm ngay nếu vượt quá 30 trang: tài liệu bắt buộc đọc toàn bộ bằng Gemini Files API
      if (pdf.numPages > PDF_TEXT_MAX_PAGES) {
        const pageCount = pdf.numPages;
        destroyDoc();
        return {
          status: "unusable",
          reason: "too_many_pages",
          pageCount,
          elapsedMs: Date.now() - startedAt,
        };
      }

      const pageTexts: string[] = [];
      const pageCharCounts: number[] = [];
      let outputCharacters = 0;

      for (let i = 1; i <= pdf.numPages; i++) {
        if (isCancelled) {
          destroyDoc();
          return { status: "error", errorName: "TimeoutError", elapsedMs: Date.now() - startedAt };
        }
        const page = await pdf.getPage(i);
        if (isCancelled) {
          destroyDoc();
          return { status: "error", errorName: "TimeoutError", elapsedMs: Date.now() - startedAt };
        }
        const content = await page.getTextContent();
        if (isCancelled) {
          destroyDoc();
          return { status: "error", errorName: "TimeoutError", elapsedMs: Date.now() - startedAt };
        }

        const itemTexts: string[] = [];
        for (const item of content.items) {
          if (!("str" in item) || typeof item.str !== "string" || !item.str) continue;
          itemTexts.push(item.str);
        }

        const pageText = itemTexts.join(" ").trim();
        const pageLen = pageText.length;
        const minRequired = i === 1 ? MIN_FIRST_PAGE_CHARS : MIN_ANY_PAGE_CHARS;

        // Dừng sớm tức thì nếu trang 1 hoặc bất kỳ trang nào là ảnh scan / watermark (< ngưỡng)
        if (pageLen < minRequired) {
          const pageCount = pdf.numPages;
          destroyDoc();
          return {
            status: "unusable",
            reason: "empty_or_hybrid_page",
            pageCount,
            elapsedMs: Date.now() - startedAt,
          };
        }

        const sepLen = pageTexts.length > 0 ? 2 : 0;
        if (outputCharacters + sepLen + pageLen > PDF_TEXT_MAX_CHARACTERS) {
          const pageCount = pdf.numPages;
          destroyDoc();
          return {
            status: "unusable",
            reason: "truncated",
            pageCount,
            elapsedMs: Date.now() - startedAt,
          };
        }

        pageCharCounts.push(pageLen);
        pageTexts.push(pageText);
        outputCharacters += sepLen + pageLen;
      }

      const pageCount = pdf.numPages;
      destroyDoc();

      const fullText = pageTexts.join("\n\n").trim();
      if (!isUsableContractPdfText(fullText, { isTruncated: false, pageCharCounts })) {
        return {
          status: "unusable",
          reason: "quality_check",
          pageCount,
          elapsedMs: Date.now() - startedAt,
        };
      }

      return {
        status: "usable",
        text: fullText,
        pageCount,
        elapsedMs: Date.now() - startedAt,
      };
    };

    return await Promise.race([parseProcess(), timeoutPromise]);
  } catch (err) {
    destroyDoc();
    return {
      status: "error",
      errorName: err instanceof Error ? err.name || "Error" : "UnknownError",
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
