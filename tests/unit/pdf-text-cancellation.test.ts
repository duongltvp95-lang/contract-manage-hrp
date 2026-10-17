import { describe, expect, it, vi } from "vitest";

const destroyLoadingTaskSpy = vi.fn().mockResolvedValue(undefined);
const destroyPdfSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: vi.fn(() => ({
      promise: new Promise((resolve) => {
        // Mô phỏng tác vụ parse PDF chậm (200ms) để kích hoạt timeout guard
        setTimeout(() => {
          resolve({
            numPages: 10,
            getPage: vi.fn().mockResolvedValue({
              getTextContent: vi.fn().mockResolvedValue({
                items: [{ str: "Nội dung hợp đồng..." }],
              }),
            }),
            destroy: destroyPdfSpy,
          });
        }, 200);
      }),
      destroy: destroyLoadingTaskSpy,
    })),
  };
});

import { extractPdfText } from "@/lib/ai/pdf-text";

describe("extractPdfText — Timeout & Hủy tác vụ đang chạy", () => {
  it("hủy loadingTask và trả về null khi thời gian đọc PDF vượt quá timeoutMs", async () => {
    const dummyBuffer = Buffer.from("dummy pdf data");
    const result = await extractPdfText(dummyBuffer, 50);
    expect(result).toBeNull();
    expect(destroyLoadingTaskSpy).toHaveBeenCalled();
  });
});
