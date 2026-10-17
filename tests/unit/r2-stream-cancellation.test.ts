import { describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("@/lib/r2/client", () => ({
  createR2Client: () => ({
    send: mockSend,
  }),
  getR2Bucket: () => "test-bucket",
}));

import { getObjectBuffer } from "@/lib/r2/objects";

describe("getObjectBuffer — Hủy tường minh stream Body khi abort/timeout", () => {
  it("gọi body.destroy() khi signal abort đối với Node.js stream", async () => {
    const destroySpy = vi.fn();
    const mockNodeBody = {
      destroy: destroySpy,
      transformToByteArray: vi.fn().mockImplementation(() => {
        // Giả lập đọc stream chậm (500ms)
        return new Promise((resolve) => setTimeout(() => resolve(new Uint8Array([1, 2, 3])), 500));
      }),
    };

    mockSend.mockResolvedValueOnce({
      Body: mockNodeBody,
    });

    const controller = new AbortController();
    const bufferPromise = getObjectBuffer("test-key.pdf", {
      abortSignal: controller.signal,
    });

    // Kích hoạt abort sau 20ms trong khi stream đang tải
    setTimeout(() => {
      controller.abort();
    }, 20);

    const result = await bufferPromise;

    expect(result).toBeNull();
    // destroy() phải được gọi tường minh để đóng socket và giải phóng tài nguyên
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledWith(expect.any(Error));
  });

  it("gọi body.cancel() khi signal abort đối với Web ReadableStream", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const mockWebBody = {
      cancel: cancelSpy,
      transformToByteArray: vi.fn().mockImplementation(() => {
        return new Promise((resolve) => setTimeout(() => resolve(new Uint8Array([1, 2, 3])), 500));
      }),
    };

    mockSend.mockResolvedValueOnce({
      Body: mockWebBody,
    });

    const result = await getObjectBuffer("test-key.pdf", {
      timeoutMs: 30,
    });

    expect(result).toBeNull();
    // cancel() phải được gọi khi timeoutMs kích hoạt
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("gọi cleanupBody ngay nếu signal đã bị aborted từ trước", async () => {
    const destroySpy = vi.fn();
    const mockNodeBody = {
      destroy: destroySpy,
      transformToByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };

    mockSend.mockResolvedValueOnce({
      Body: mockNodeBody,
    });

    const controller = new AbortController();
    controller.abort(); // đã abort trước khi đọc body

    const result = await getObjectBuffer("test-key.pdf", {
      abortSignal: controller.signal,
    });

    expect(result).toBeNull();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(mockNodeBody.transformToByteArray).not.toHaveBeenCalled();
  });
});
