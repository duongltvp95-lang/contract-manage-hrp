import { describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("@/lib/r2/client", () => ({
  createR2Client: () => ({
    send: mockSend,
  }),
  getR2Bucket: () => "test-bucket",
}));

import { getObjectBuffer, getObjectBufferBounded } from "@/lib/r2/objects";

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

describe("getObjectBufferBounded — Gộp HEAD + GET có giới hạn byte và ngắt stream tức thì", () => {
  it("đọc thành công trong 1 lượt GET duy nhất khi kích thước hợp lệ", async () => {
    mockSend.mockClear();
    async function* generateChunks() {
      yield Buffer.from("Hello ");
      yield Buffer.from("R2!");
    }
    mockSend.mockResolvedValueOnce({
      ContentLength: 9,
      Body: generateChunks(),
    });

    const res = await getObjectBufferBounded("ai-temp/org/doc.pdf", { maxBytes: 1024 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.buffer.toString("utf8")).toBe("Hello R2!");
      expect(res.contentLength).toBe(9);
    }
  });

  it("trả về not_found khi object không tồn tại (NoSuchKey)", async () => {
    const notFoundErr = Object.assign(new Error("The specified key does not exist."), {
      name: "NoSuchKey",
    });
    mockSend.mockRejectedValueOnce(notFoundErr);

    const res = await getObjectBufferBounded("ai-temp/org/missing.pdf", { maxBytes: 1024 });
    expect(res).toEqual({ status: "not_found" });
  });

  it("ngắt ngay trước khi đọc body nếu ContentLength vượt quá maxBytes", async () => {
    const destroySpy = vi.fn();
    const transformSpy = vi.fn();
    mockSend.mockResolvedValueOnce({
      ContentLength: 60 * 1024 * 1024,
      Body: {
        destroy: destroySpy,
        transformToByteArray: transformSpy,
      },
    });

    const res = await getObjectBufferBounded("ai-temp/org/huge.pdf", {
      maxBytes: 50 * 1024 * 1024,
    });
    expect(res).toEqual({ status: "too_large", contentLength: 60 * 1024 * 1024 });
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(transformSpy).not.toHaveBeenCalled();
  });

  it("ngắt stream ngay giữa chừng nếu tổng byte thực tế vượt quá maxBytes (kể cả khi thiếu ContentLength)", async () => {
    const destroySpy = vi.fn();
    let thirdChunkRead = false;

    const streamingBody = {
      destroy: destroySpy,
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(600);
        yield Buffer.alloc(600); // Tổng 1200 > 1000 → phải ngắt ngay tại đây
        thirdChunkRead = true;
        yield Buffer.alloc(600);
      },
    };

    mockSend.mockResolvedValueOnce({
      Body: streamingBody,
    });

    const res = await getObjectBufferBounded("ai-temp/org/oversized-stream.pdf", {
      maxBytes: 1_000,
    });
    expect(res.status).toBe("too_large");
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(thirdChunkRead).toBe(false);
  });
});
