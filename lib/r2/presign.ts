import "server-only";

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { createR2Client, getR2Bucket } from "./client";

/**
 * Presigned URL TTLs — plan section 60.
 *
 * Uploads are a single request the user starts immediately, so 10 minutes is
 * plenty. View URLs are re-issued by the viewer when they expire.
 */
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const VIEW_URL_TTL_MIN_SECONDS = 5 * 60;
export const VIEW_URL_TTL_MAX_SECONDS = 15 * 60;
export const VIEW_URL_TTL_SECONDS = VIEW_URL_TTL_MAX_SECONDS;

/**
 * Clamps a requested view TTL into the 5-15 minute window of plan section 60.
 *
 * Exported so the rule can be unit-tested directly (tests/unit/r2-presign), the
 * same way `resolveExpiryPreset` is: a policy that only exists inside a
 * network call cannot be checked cheaply.
 */
export function clampViewTtl(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return VIEW_URL_TTL_SECONDS;
  }
  return Math.min(
    Math.max(Math.trunc(seconds), VIEW_URL_TTL_MIN_SECONDS),
    VIEW_URL_TTL_MAX_SECONDS,
  );
}

/**
 * Presigned PUT. The browser uploads straight to R2 — the file never passes
 * through Next.js/Vercel (plan sections 40, 41).
 *
 * `contentType` is part of the signature, so the browser MUST send exactly the
 * same `Content-Type` header on the PUT or R2 answers 403.
 */
export async function createUploadUrl(
  objectKey: string,
  contentType: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getR2Bucket(),
    Key: objectKey,
    ContentType: contentType,
  });

  return getSignedUrl(createR2Client(), command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  });
}

/**
 * Presigned GET for the in-app viewer (plan sections 16, 59).
 *
 * R2 is private and RLS does not protect it (plan section 73), so this must
 * only ever be called after `getContractFileAccess()` has authorized the user.
 * TTL is clamped to the 5-15 minute window of plan section 60.
 */
export async function createViewUrl(
  objectKey: string,
  expiresInSeconds: number = VIEW_URL_TTL_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getR2Bucket(),
    Key: objectKey,
  });

  return getSignedUrl(createR2Client(), command, {
    expiresIn: clampViewTtl(expiresInSeconds),
  });
}
