import "server-only";

import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

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

/**
 * Confirms an object really landed in the bucket.
 *
 * Used before persisting a `contract_files` row: a row that points at a missing
 * object is worse than a failed upload, because the viewer would break later.
 */
export async function headObject(objectKey: string): Promise<ObjectHead> {
  try {
    const result = await createR2Client().send(
      new HeadObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }),
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
export async function deleteObject(objectKey: string): Promise<void> {
  await createR2Client().send(
    new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }),
  );
}
