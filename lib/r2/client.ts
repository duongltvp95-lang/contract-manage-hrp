import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 is S3-compatible. Plan section 62: no R2 logic may live in a
 * component — everything goes through this module and its siblings.
 *
 * `server-only` makes the build fail if any Client Component ever imports this,
 * which is what keeps R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY out of the
 * browser bundle (plan section 61).
 */

export type R2Config = {
  accountId: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Thiếu biến môi trường ${name}. Xem .env.example và điền vào .env.local.`,
    );
  }
  return value;
}

export function getR2Config(): R2Config {
  return {
    accountId: required("R2_ACCOUNT_ID"),
    endpoint: required("R2_ENDPOINT"),
    bucket: required("R2_BUCKET_NAME"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  };
}

export function getR2Bucket(): string {
  return required("R2_BUCKET_NAME");
}

let cachedClient: S3Client | null = null;

/**
 * Returns the shared S3 client for R2.
 *
 * - `region: "auto"` is what R2 expects; it has no real regions.
 * - `forcePathStyle: true` keeps the bucket in the path
 *   (`<endpoint>/<bucket>/<key>`) instead of a virtual host, which is the
 *   form Cloudflare documents for its S3 endpoint.
 *
 * The client is memoised because it holds a credential provider and an HTTPS
 * agent; rebuilding it per request would be wasteful.
 */
export function createR2Client(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  const { endpoint, accessKeyId, secretAccessKey } = getR2Config();

  cachedClient = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return cachedClient;
}

/** Test seam: drops the memoised client (used by scripts, not by the app). */
export function resetR2Client(): void {
  cachedClient?.destroy();
  cachedClient = null;
}
