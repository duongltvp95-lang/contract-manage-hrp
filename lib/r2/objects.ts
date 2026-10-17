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

