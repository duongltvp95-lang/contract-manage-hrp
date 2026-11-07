import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { parse } from "dotenv";

/**
 * @param {string} bucket
 * @param {string} key
 * @returns {string}
 */
export function encodeCopySource(bucket, key) {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${encodeURIComponent(bucket)}/${encodedKey}`;
}

/**
 * @param {string} etag
 * @returns {string}
 */
export function quoteEtag(etag) {
  const trimmed = etag.trim().replaceAll('"', "");
  return `"${trimmed}"`;
}

/**
 * @param {string} endpoint
 * @param {string} [accountId]
 * @returns {boolean}
 */
export function isCloudflareR2EndpointUrl(endpoint, accountId = "") {
  try {
    if (accountId === "isolated") return false;
    const host = new URL(endpoint).hostname.toLowerCase();
    return host.endsWith(".r2.cloudflarestorage.com");
  } catch {
    return false;
  }
}

/**
 * @param {string} probeId
 */
export function buildR2CopyProbeKeys(probeId) {
  const prefix = `uploads-staging/_r2-copy-probe-${probeId}`;
  return {
    prefix,
    sourceA: `${prefix}/source-a.txt`,
    sourceB: `${prefix}/source-b.txt`,
    dest: `${prefix}/dest.txt`,
    destMismatch: `${prefix}/dest-etag-mismatch.txt`,
  };
}

/**
 * Delete all ephemeral probe keys AND verify via both HeadObject (404) and ListObjectsV2 (0 keys)
 * that zero probe objects remain under `${prefix}/`. Never swallows deletion or verification errors.
 *
 * @param {{
 *   send: (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;
 *   bucket: string;
 *   prefix: string;
 *   keys: string[];
 * }} params
 */
export async function cleanupAndVerifyR2ProbeKeys(params) {
  /** @type {string[]} */
  const deleteErrors = [];
  /** @type {string[]} */
  const verifyErrors = [];
  /** @type {Set<string>} */
  const remainingSet = new Set();

  for (const key of params.keys) {
    try {
      await params.send(
        new DeleteObjectCommand({ Bucket: params.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(8_000) },
      );
    } catch (error) {
      deleteErrors.push(
        `${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const key of params.keys) {
    try {
      await params.send(
        new HeadObjectCommand({ Bucket: params.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(8_000) },
      );
      remainingSet.add(key);
    } catch (error) {
      const errObj = /** @type {{ name?: string; $metadata?: { httpStatusCode?: number } }} */ (
        error
      );
      const isGone =
        errObj?.name === "NotFound" ||
        errObj?.name === "NoSuchKey" ||
        errObj?.$metadata?.httpStatusCode === 404;
      if (!isGone) {
        verifyErrors.push(
          `HEAD ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  try {
    const listed = /** @type {{ Contents?: Array<{ Key?: string }> }} */ (
      await params.send(
        new ListObjectsV2Command({
          Bucket: params.bucket,
          Prefix: `${params.prefix}/`,
          MaxKeys: 20,
        }),
        { abortSignal: AbortSignal.timeout(8_000) },
      )
    );
    for (const item of listed?.Contents ?? []) {
      if (item?.Key) {
        remainingSet.add(item.Key);
      }
    }
  } catch (error) {
    verifyErrors.push(
      `LIST ${params.prefix}/: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const remainingKeys = Array.from(remainingSet);
  return {
    ok:
      deleteErrors.length === 0 &&
      verifyErrors.length === 0 &&
      remainingKeys.length === 0,
    deletedAttempted: params.keys.length,
    remainingKeys,
    deleteErrors,
    verifyErrors,
  };
}

/**
 * @param {{
 *   endpoint: string;
 *   accessKeyId: string;
 *   secretAccessKey: string;
 *   bucket: string;
 *   accountId?: string;
 * }} config
 */
export async function runConditionalCopyProbe(config) {
  const isCloudflare = isCloudflareR2EndpointUrl(config.endpoint, config.accountId);
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: !isCloudflare,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const probeId = randomUUID();
  const keys = buildR2CopyProbeKeys(probeId);
  const allKeys = [keys.sourceA, keys.sourceB, keys.dest, keys.destMismatch];

  /**
   * @param {string} sourceKey
   * @param {string} destKey
   * @param {string} sourceEtag
   */
  async function sendConditionalCopy(sourceKey, destKey, sourceEtag) {
    const command = new CopyObjectCommand({
      Bucket: config.bucket,
      CopySource: encodeCopySource(config.bucket, sourceKey),
      Key: destKey,
      CopySourceIfMatch: quoteEtag(sourceEtag),
      ContentType: "text/plain",
      MetadataDirective: "COPY",
    });

    if (isCloudflare) {
      command.middlewareStack.add(
        (next) => async (args) => {
          const req = /** @type {{ headers?: Record<string, string> }} */ (args.request);
          if (req?.headers) {
            req.headers["cf-copy-destination-if-none-match"] = "*";
          }
          return next(args);
        },
        { step: "build", name: "cfCopyDestinationIfNoneMatch" },
      );
    }

    try {
      const res = await client.send(command, { abortSignal: AbortSignal.timeout(10_000) });
      return {
        status: "copied",
        etag: res.CopyObjectResult?.ETag?.replaceAll('"', "") ?? null,
      };
    } catch (error) {
      const errObj = /** @type {{ name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }} */ (error);
      const httpStatus = errObj?.$metadata?.httpStatusCode;
      const code = errObj?.name ?? errObj?.Code ?? "";
      if (code === "PreconditionFailed" || httpStatus === 412) {
        return { status: "precondition_failed", httpStatus: 412 };
      }
      throw error;
    }
  }

  /**
   * @param {string} key
   */
  async function headProbe(key) {
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(8_000) },
      );
      return {
        exists: true,
        etag: res.ETag?.replaceAll('"', "") ?? null,
      };
    } catch (error) {
      const errObj = /** @type {{ name?: string; $metadata?: { httpStatusCode?: number } }} */ (error);
      if (
        errObj?.name === "NotFound" ||
        errObj?.name === "NoSuchKey" ||
        errObj?.$metadata?.httpStatusCode === 404
      ) {
        return { exists: false, etag: null };
      }
      throw error;
    }
  }

  /** @type {unknown} */
  let primaryError = null;
  /** @type {null | { freshCopySucceeded: boolean; destinationOverwriteBlocked: boolean | string; sourceEtagMismatchBlocked: boolean }} */
  let checks = null;

  try {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: keys.sourceA,
          Body: Buffer.from(`hrp-r2-probe-alpha-${probeId}`, "utf8"),
          ContentType: "text/plain",
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: keys.sourceB,
          Body: Buffer.from(`hrp-r2-probe-beta-${probeId}`, "utf8"),
          ContentType: "text/plain",
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );

      const headA = await headProbe(keys.sourceA);
      const headB = await headProbe(keys.sourceB);
      if (!headA.exists || !headA.etag || !headB.exists || !headB.etag) {
        throw new Error("Probe source objects failed HEAD verification after PutObject");
      }

      // 1. Copy to fresh destination -> must succeed
      const firstCopy = await sendConditionalCopy(keys.sourceA, keys.dest, headA.etag);
      if (firstCopy.status !== "copied") {
        throw new Error(`Initial conditional CopyObject failed: ${JSON.stringify(firstCopy)}`);
      }
      const destAfterFirst = await headProbe(keys.dest);
      if (!destAfterFirst.exists || !destAfterFirst.etag) {
        throw new Error("Destination object missing after initial CopyObject");
      }

      // 2. Copy different source onto existing destination -> on Cloudflare R2 must fail with 412
      const overwriteAttempt = await sendConditionalCopy(keys.sourceB, keys.dest, headB.etag);
      const destAfterSecond = await headProbe(keys.dest);
      if (isCloudflare) {
        if (overwriteAttempt.status !== "precondition_failed") {
          throw new Error(
            `Expected 412 PreconditionFailed from cf-copy-destination-if-none-match: *, received ${JSON.stringify(overwriteAttempt)}`,
          );
        }
        if (destAfterSecond.etag !== destAfterFirst.etag) {
          throw new Error("Destination ETag changed despite cf-copy-destination-if-none-match: *");
        }
      }

      // 3. Copy with mismatched source ETag -> must fail with 412 and leave destMismatch absent
      const mismatchAttempt = await sendConditionalCopy(
        keys.sourceA,
        keys.destMismatch,
        "00000000000000000000000000000000",
      );
      if (mismatchAttempt.status !== "precondition_failed") {
        throw new Error(
          `Expected 412 PreconditionFailed from CopySourceIfMatch mismatch, received ${JSON.stringify(mismatchAttempt)}`,
        );
      }
      const mismatchHead = await headProbe(keys.destMismatch);
      if (mismatchHead.exists) {
        throw new Error("Destination object was created despite CopySourceIfMatch mismatch");
      }

      checks = {
        freshCopySucceeded: true,
        destinationOverwriteBlocked: isCloudflare
          ? overwriteAttempt.status === "precondition_failed"
          : "skipped_non_cloudflare_endpoint",
        sourceEtagMismatchBlocked: true,
      };
    } catch (error) {
      primaryError = error;
    }

    const cleanup = await cleanupAndVerifyR2ProbeKeys({
      send: (cmd, opts) => client.send(/** @type {any} */ (cmd), opts),
      bucket: config.bucket,
      prefix: keys.prefix,
      keys: allKeys,
    });

    if (primaryError) {
      if (!cleanup.ok) {
        const primaryMsg =
          primaryError instanceof Error ? primaryError.message : String(primaryError);
        throw new Error(
          `${primaryMsg} | Cleanup verification ALSO failed under ${keys.prefix}: ${JSON.stringify(cleanup)}`,
          { cause: primaryError },
        );
      }
      throw primaryError;
    }

    if (!cleanup.ok) {
      throw new Error(
        `R2 probe cleanup verification failed under ${keys.prefix}: ${JSON.stringify(cleanup)}`,
      );
    }

    return {
      ok: true,
      verifiedAt: new Date().toISOString(),
      isCloudflareR2: isCloudflare,
      bucket: config.bucket,
      probePrefix: keys.prefix,
      checks,
      cleanup: {
        verifiedAbsent: true,
        remainingKeys: cleanup.remainingKeys,
      },
    };
  } finally {
    client.destroy();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const verifyMode = args.includes("--verify");
  const envIdx = args.indexOf("--env");
  const envFile = envIdx >= 0 ? args[envIdx + 1] : null;
  const outIdx = args.indexOf("--output");
  const outputPath = outIdx >= 0 ? args[outIdx + 1] : null;

  if (!verifyMode) {
    console.log(
      JSON.stringify(
        {
          mode: "plan",
          action: "verify-r2-conditional-copy",
          requiredTokenPermission: "Object Read & Write (scoped strictly to the target R2 bucket)",
          writesCanonicalContractsPrefix: false,
          probePrefixPattern: "uploads-staging/_r2-copy-probe-<uuid>/",
          steps: [
            "PutObject two ephemeral text probes under uploads-staging/_r2-copy-probe-<uuid>/",
            "CopyObject source-a -> dest with CopySourceIfMatch + cf-copy-destination-if-none-match: * (assert 200)",
            "CopyObject source-b -> dest with cf-copy-destination-if-none-match: * (assert 412 & destination ETag unchanged on Cloudflare R2)",
            "CopyObject source-a -> dest-etag-mismatch with bogus CopySourceIfMatch (assert 412 & object not created)",
            "Delete all probe keys AND verify 404 HEAD + 0 objects via ListObjectsV2 under probe prefix before reporting ok: true",
          ],
          usage:
            "node scripts/verify-r2-conditional-copy.mjs --verify --env <env-file> [--output test-results/release/r2-probe-receipt.json]",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!envFile) {
    throw new Error("Pass --env <env-file> together with --verify");
  }

  const parsedEnv = parse(readFileSync(envFile));
  const accountId = (parsedEnv.R2_ACCOUNT_ID ?? "").trim();
  const accessKeyId = (parsedEnv.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (parsedEnv.R2_SECRET_ACCESS_KEY ?? "").trim();
  const bucket = (parsedEnv.R2_BUCKET_NAME ?? "").trim();
  const endpoint =
    (parsedEnv.R2_ENDPOINT ?? "").trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Missing R2_ENDPOINT/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, or R2_BUCKET_NAME in env file",
    );
  }

  const summary = await runConditionalCopyProbe({
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    accountId,
  });

  if (outputPath) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
}

const isDirectEntry =
  process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectEntry) {
  main().catch((err) => {
    console.error("[verify-r2-conditional-copy] ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
