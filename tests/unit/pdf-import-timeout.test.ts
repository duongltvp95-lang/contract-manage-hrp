import { describe, expect, it, vi } from "vitest";

const getDocumentSpy = vi.fn();

// Giả lập dynamic import("pdfjs-dist/legacy/build/pdf.mjs") bị chậm (200ms)
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: getDocumentSpy,
  };
});

import { extractPdfText } from "@/lib/ai/pdf-text";

describe("extractPdfText — Timeout xảy ra trong lúc dynamic import", () => {
  it("không gọi getDocument và trả về null nếu timeout xảy ra trước khi import hoàn tất", async () => {
    const dummyBuffer = Buffer.from("dummy pdf data");
    // timeoutMs = 50ms < 200ms của import
    const result = await extractPdfText(dummyBuffer, 50);

    expect(result).toBeNull();
    // getDocument tuyệt đối không được gọi vì isCancelled đã được kích hoạt
    expect(getDocumentSpy).not.toHaveBeenCalled();
  });
});
