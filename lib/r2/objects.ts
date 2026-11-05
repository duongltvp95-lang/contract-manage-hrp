import "server-only";

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

import { createR2Client, getR2Bucket } from "./client";

/**
 * Object-level R2 operations. Kept beside the presign helpers so no component
 * or service talks to the S3 client directly (plan section 62).
 */

export type ObjectHead = {
  exists: boolean;
  contentLength: number | null;
  contentType: string | null;
  etag: string | null;
};

export type R2RequestOptions = {
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

/**
 * Confirms an object really landed in the bucket.
 *
 * Used before persisting a `contract_files` row: a row that points at a missing
 * object is worse than a failed upload, because the viewer would break later.
 */
export async function headObject(
  objectKey: string,
  options?: R2RequestOptions,
): Promise<ObjectHead> {
  const signal = options?.abortSignal ?? (options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);
  try {
    const result = await createR2Client().send(
      new HeadObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }),
      signal ? { abortSignal: signal } : undefined,
    );

    return {
      exists: true,
      contentLength: result.ContentLength ?? null,
      contentType: result.ContentType ?? null,
      etag: result.ETag?.replaceAll('"', "") ?? null,
    };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") {
      return { exists: false, contentLength: null, contentType: null, etag: null };
    }
    throw error;
  }
}

/** Removes an object. Used to clean up after a failed persist. */
export async function deleteObject(
  objectKey: string,
  options?: R2RequestOptions,
): Promise<void> {
  const signal = options?.abortSignal ?? (options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);
  await createR2Client().send(
    new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }),
    signal ? { abortSignal: signal } : undefined,
  );
}

/** Reads an object's full bytes as a Buffer. */
export async function getObjectBuffer(
  objectKey: string,
  options?: R2RequestOptions,
): Promise<Buffer | null> {
  const signal = options?.abortSignal ?? (options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);
  try {
    const result = await createR2Client().send(
      new GetObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }),
      signal ? { abortSignal: signal } : undefined,
    );
    if (!result.Body) return null;

    const body = result.Body as {
      destroy?: (error?: Error) => void;
      cancel?: () => Promise<void>;
      transformToByteArray: () => Promise<Uint8Array>;
    };

    let bodyCleanedUp = false;
    const cleanupBody = () => {
      if (bodyCleanedUp) return;
      bodyCleanedUp = true;
      try {
        if (typeof body.destroy === "function") {
          body.destroy(new Error("R2 stream aborted by client timeout"));
        } else if (typeof body.cancel === "function") {
          body.cancel().catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    if (signal) {
      if (signal.aborted) {
        cleanupBody();
        return null;
      }

      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            cleanupBody();
            reject(new Error("R2 read aborted"));
          },
          { once: true },
        );
      });

      try {
        const byteArray = await Promise.race([
          body.transformToByteArray(),
          abortPromise,
        ]);
        return Buffer.from(byteArray);
      } catch {
        cleanupBody();
        return null;
      }
    }

    const byteArray = await body.transformToByteArray();
    return Buffer.from(byteArray);
  } catch (error) {
    console.error("[r2:getObjectBuffer]", error);
    return null;
  }
}

export type BoundedObjectReadResult =
  | { status: "ok"; buffer: Buffer; contentLength: number }
  | { status: "not_found" }
  | { status: "too_large"; contentLength: number }
  | { status: "error" };

/**
 * Gộp kiểm tra tồn tại/kích thước (HEAD) và tải dữ liệu (GET) thành 1 lượt gọi R2 duy nhất.
 * Kiểm tra `ContentLength` trước khi đọc stream và ngắt luồng ngay lập tức nếu tổng số byte
 * thực tế vượt quá `maxBytes` hoặc hết thời gian chờ.
 */
export async function getObjectBufferBounded(
  objectKey: string,
  options: R2RequestOptions & { maxBytes: number },
): Promise<BoundedObjectReadResult> {
  const maxBytes = Math.max(1, Math.floor(options.maxBytes));
  const signal =
    options.abortSignal ??
    (options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);

  try {
    const result = await createR2Client().send(
      new GetObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }),
      signal ? { abortSignal: signal } : undefined,
    );

    if (!result.Body) {
      return { status: "not_found" };
    }

    const body = result.Body as {
      destroy?: (error?: Error) => void;
      cancel?: () => Promise<void>;
      getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
      transformToByteArray?: () => Promise<Uint8Array>;
      [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer>;
    };

    let bodyCleanedUp = false;
    const cleanupBody = (reason: string) => {
      if (bodyCleanedUp) return;
      bodyCleanedUp = true;
      try {
        if (typeof body.destroy === "function") {
          body.destroy(new Error(reason));
        } else if (typeof body.cancel === "function") {
          body.cancel().catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    if (typeof result.ContentLength === "number" && result.ContentLength > maxBytes) {
      cleanupBody("R2 object ContentLength exceeds maxBytes");
      return { status: "too_large", contentLength: result.ContentLength };
    }

    if (signal?.aborted) {
      cleanupBody("R2 read aborted before stream start");
      return { status: "error" };
    }

    const readChunksBounded = async (): Promise<BoundedObjectReadResult> => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      if (typeof body[Symbol.asyncIterator] === "function") {
        for await (const rawChunk of body as AsyncIterable<Uint8Array | Buffer>) {
          const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          totalBytes += buf.byteLength;
          if (totalBytes > maxBytes) {
            cleanupBody("R2 stream exceeded maxBytes");
            return { status: "too_large", contentLength: totalBytes };
          }
          chunks.push(buf);
        }
        return {
          status: "ok",
          buffer: Buffer.concat(chunks, totalBytes),
          contentLength: totalBytes,
        };
      }

      if (typeof body.getReader === "function") {
        const reader = body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            const buf = Buffer.from(value);
            totalBytes += buf.byteLength;
            if (totalBytes > maxBytes) {
              await reader.cancel("R2 stream exceeded maxBytes").catch(() => {});
              cleanupBody("R2 stream exceeded maxBytes");
              return { status: "too_large", contentLength: totalBytes };
            }
            chunks.push(buf);
          }
          return {
            status: "ok",
            buffer: Buffer.concat(chunks, totalBytes),
            contentLength: totalBytes,
          };
        } finally {
          reader.releaseLock?.();
        }
      }

      if (typeof body.transformToByteArray === "function") {
        const byteArray = await body.transformToByteArray();
        if (byteArray.byteLength > maxBytes) {
          cleanupBody("R2 byte array exceeded maxBytes");
          return { status: "too_large", contentLength: byteArray.byteLength };
        }
        return {
          status: "ok",
          buffer: Buffer.from(byteArray),
          contentLength: byteArray.byteLength,
        };
      }

      cleanupBody("Unsupported R2 body stream");
      return { status: "error" };
    };

    if (signal) {
      let onAbort: (() => void) | undefined;
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => {
          cleanupBody("R2 read aborted by signal");
          reject(new Error("R2 read aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });

      try {
        return await Promise.race([readChunksBounded(), abortPromise]);
      } catch {
        cleanupBody("R2 stream read failed or timed out");
        return { status: "error" };
      } finally {
        if (onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    }

    return await readChunksBounded();
  } catch (error) {
    const errObj = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      errObj?.name === "NotFound" ||
      errObj?.name === "NoSuchKey" ||
      errObj?.$metadata?.httpStatusCode === 404
    ) {
      return { status: "not_found" };
    }
    console.error("[r2:getObjectBufferBounded]", error);
    return { status: "error" };
  }
}

