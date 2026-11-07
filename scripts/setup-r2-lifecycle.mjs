import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GetBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 Lifecycle Configuration Guide & Read-Only Safety Verifier (`A03` / `A08`)
 *
 * CẢNH BÁO QUAN TRỌNG VỀ AN TOÀN DỮ LIỆU:
 * --------------------------------------------------
 * Tệp tạm trích xuất AI được lưu với tiền tố: `ai-temp/{orgId}/{userId}/{fileId}/{filename}`.
 * Tệp tải lên hợp đồng vùng tạm lưu với tiền tố: `uploads-staging/{orgId}/{contractId}/{fileId}/{filename}`.
 * Tệp hợp đồng chính thức được lưu với tiền tố: `contracts/{orgId}/{contractId}/{fileId}/{filename}`.
 *
 * TUYỆT ĐỐI KHÔNG để trống trường Prefix khi tạo Lifecycle Rule!
 * Nếu để trống Prefix hoặc chọn "All objects in the bucket", Cloudflare R2 sẽ TỰ ĐỘNG
 * XÓA VĨNH VIỄN toàn bộ tệp hợp đồng sau 24h!
 *
 * HƯỚNG DẪN CẤU HÌNH TRÊN CLOUDFLARE DASHBOARD:
 * --------------------------------------------------
 * 1. Đăng nhập vào Cloudflare Dashboard: https://dash.cloudflare.com
 * 2. Chọn R2 Object Storage -> Click vào Bucket: `hrp-contract`
 * 3. Chuyển sang tab: `Settings` (Cài đặt)
 * 4. Cuộn xuống phần: `Object lifecycle rules` (Quy tắc vòng đời đối tượng)
 *    - KIỂM TRA QUY TẮC HIỆN CÓ: Nếu thấy quy tắc nào có Prefix là "-" hoặc "All objects",
 *      hãy BẤM XÓA HOẶC SỬA NGAY để tránh tiếp tục bị xóa nhầm file hợp đồng!
 *    - THÊM HOẶC SỬA QUY TẮC:
 *      + Rule 1: `auto-delete-ai-temp-24h`
 *        - Apply to: `Objects with a specific prefix` (BẮT BUỘC)
 *        - Prefix: `ai-temp/` (BẮT BUỘC có dấu `/` ở cuối)
 *        - Action: `Delete uploaded objects` -> sau `1 day`
 *      + Rule 2: `auto-delete-uploads-staging-48h`
 *        - Apply to: `Objects with a specific prefix` (BẮT BUỘC)
 *        - Prefix: `uploads-staging/` (BẮT BUỘC có dấu `/` ở cuối; dài hơn cửa sổ xác nhận 24h20p)
 *        - Action: `Delete uploaded objects` -> sau `2 days`
 * 5. Bấm `Save rule` để áp dụng.
 * 6. (Khuyến nghị an toàn): Bật `Object Versioning` trong tab Settings để có thể phục hồi tệp nếu lỡ bị xóa.
 */

/**
 * @param {string} envPath
 * @returns {Record<string, string>}
 */
function parseEnvFile(envPath) {
  const resolved = path.resolve(process.cwd(), envPath);
  if (!fs.existsSync(resolved)) return {};
  /** @type {Record<string, string>} */
  const map = {};
  const content = fs.readFileSync(resolved, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let val = line.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

/**
 * @param {Array<{
 *   ID?: string;
 *   Status?: string;
 *   Prefix?: string;
 *   Filter?: { Prefix?: string; And?: { Prefix?: string } };
 *   Expiration?: { Days?: number; Date?: Date | string; ExpiredObjectDeleteMarker?: boolean };
 *   NoncurrentVersionExpiration?: { NoncurrentDays?: number };
 * }>} [rules]
 */
export function evaluateLifecycleRules(rules = []) {
  /** @type {string[]} */
  const issues = [];
  let hasAiTempRule = false;
  let hasUploadsStagingRule = false;

  for (const rule of rules) {
    if (rule?.Status !== "Enabled") continue;
    const ruleId = rule?.ID ?? "(unnamed)";
    const prefix = rule?.Filter?.Prefix ?? rule?.Filter?.And?.Prefix ?? rule?.Prefix ?? "";
    const hasTagFilter = Array.isArray(rule?.Filter?.And?.Tags)
      ? rule.Filter.And.Tags.length > 0
      : Boolean(rule?.Filter?.Tag);
    const days = rule?.Expiration?.Days ?? null;
    const hasExpiration = Boolean(rule?.Expiration);
    const deletesObjects = Boolean(rule?.Expiration || rule?.NoncurrentVersionExpiration);

    if (!prefix) {
      issues.push(
        `CRITICAL: Enabled lifecycle rule "${ruleId}" has an empty Prefix and threatens canonical contracts/ objects!`,
      );
      continue;
    }

    // Two prefixes overlap iff one startsWith the other (catches both "c" / "contracts"
    // super-prefixes AND "contracts/example-tenant/" sub-prefixes).
    if ("contracts/".startsWith(prefix) || prefix.startsWith("contracts/")) {
      issues.push(
        `CRITICAL: Enabled lifecycle rule "${ruleId}" matches prefix "${prefix}" which overlaps canonical contracts/ objects!`,
      );
      continue;
    }

    const isAiTempPrefix = prefix === "ai-temp/" || prefix.startsWith("ai-temp/");
    const isUploadsStagingPrefix =
      prefix === "uploads-staging/" || prefix.startsWith("uploads-staging/");
    const isAllowedTempPrefix = isAiTempPrefix || isUploadsStagingPrefix;

    if (deletesObjects && !isAllowedTempPrefix) {
      issues.push(
        `CRITICAL: Enabled expiration rule "${ruleId}" targets unexpected prefix "${prefix}" outside allowed temporary prefixes ('ai-temp/', 'uploads-staging/')!`,
      );
      continue;
    }

    if (isAiTempPrefix && hasExpiration) {
      if (typeof days !== "number") {
        issues.push(
          `WARNING: Enabled rule "${ruleId}" on "${prefix}" must specify numeric Expiration.Days >= 1.`,
        );
      } else if (days < 1) {
        issues.push(
          `WARNING: Enabled rule "${ruleId}" on "${prefix}" expires objects in ${days} day(s); must be >= 1 day.`,
        );
      } else if (prefix === "ai-temp/" && !hasTagFilter) {
        hasAiTempRule = true;
      }
    }

    if (isUploadsStagingPrefix && hasExpiration) {
      if (typeof days !== "number") {
        issues.push(
          `WARNING: Enabled rule "${ruleId}" on "${prefix}" must specify numeric Expiration.Days >= 2.`,
        );
      } else if (days < 2) {
        issues.push(
          `WARNING: Enabled rule "${ruleId}" on "${prefix}" expires objects in ${days} day(s); must be >= 2 days to exceed the 24h20m upload reservation window.`,
        );
      } else if (prefix === "uploads-staging/" && !hasTagFilter) {
        hasUploadsStagingRule = true;
      }
    }
  }

  if (!hasAiTempRule) {
    issues.push("MISSING: No enabled expiration rule found for prefix 'ai-temp/' (recommended: 1 day).");
  }
  if (!hasUploadsStagingRule) {
    issues.push(
      "MISSING: No enabled expiration rule >= 2 days found for prefix 'uploads-staging/' (recommended: 2 days).",
    );
  }

  return {
    ok: issues.length === 0,
    hasAiTempRule,
    hasUploadsStagingRule,
    issues,
  };
}

function printGuide() {
  console.log("=== CLOUDFLARE R2 LIFECYCLE GUIDE & SAFETY AUDIT ===");
  console.log("1. Vào Cloudflare Dashboard -> R2 -> Bucket 'hrp-contract'");
  console.log("2. Settings -> Object lifecycle rules");
  console.log("3. CẢNH BÁO: Kiểm tra trường Prefix PHẢI LÀ 'ai-temp/' (1 ngày) và 'uploads-staging/' (2 ngày). TUYỆT ĐỐI KHÔNG ĐỂ TRỐNG HOẶC CHẠM TỚI 'contracts/'!");
  console.log("4. Nếu có bất kỳ rule nào mang Prefix trống, All objects, hoặc dưới 'contracts/...': SỬA HOẶC XÓA NGAY LẬP TỨC.");
  console.log("5. Kiểm tra tự động (chỉ cần R2 API Token quyền tối thiểu 'Admin Read only'): node scripts/setup-r2-lifecycle.mjs --check --env .env.local");
  console.log("====================================================");
}

/**
 * @param {string} envPath
 * @param {string | null} [outputPath]
 */
async function runCheck(envPath, outputPath = null) {
  const fileEnv = envPath ? parseEnvFile(envPath) : {};
  /** @param {string} key */
  const getVar = (key) => process.env[key] || fileEnv[key] || "";
  const endpoint = getVar("R2_ENDPOINT");
  const bucket = getVar("R2_BUCKET_NAME");
  const accessKeyId = getVar("R2_ACCESS_KEY_ID");
  const secretAccessKey = getVar("R2_SECRET_ACCESS_KEY");

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    console.error("Missing R2 credentials (R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).");
    process.exitCode = 1;
    return;
  }

  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const res = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    const rules = res.Rules ?? [];
    const report = evaluateLifecycleRules(rules);
    const payload = {
      checkedAt: new Date().toISOString(),
      bucket,
      ruleCount: rules.length,
      ...report,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify(payload, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const errObj = /** @type {{ name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }} */ (error);
    const httpStatus = errObj?.$metadata?.httpStatusCode;
    const code = errObj?.name ?? errObj?.Code ?? "";

    if (code === "NoSuchLifecycleConfiguration") {
      const report = evaluateLifecycleRules([]);
      console.log(JSON.stringify({ bucket, ruleCount: 0, ...report }, null, 2));
      process.exitCode = 1;
      return;
    }

    if (httpStatus === 403 || code === "AccessDenied" || code === "Forbidden") {
      console.error(
        JSON.stringify(
          {
            ok: false,
            bucket,
            error: "AccessDenied (HTTP 403) on GetBucketLifecycleConfiguration",
            cause:
              "Current R2 S3 credentials appear to be scoped to 'Object Read & Write', which cannot read bucket-level lifecycle rules.",
            actionRequired: [
              "Verify directly in Cloudflare Dashboard -> R2 -> Bucket -> Settings -> Object lifecycle rules that ONLY 'ai-temp/' (>= 1 day) and 'uploads-staging/' (>= 2 days) have enabled expiration rules, and NO rule touches 'contracts/' or All objects.",
              "Or re-run this check using a least-privilege R2 API token with 'Admin Read only' permission (keep runtime/probe tokens scoped to 'Object Read & Write' on the single bucket).",
            ],
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    client.destroy();
  }
}

async function main(argv = process.argv.slice(2)) {
  const checkMode = argv.includes("--check");
  const envIdx = argv.indexOf("--env");
  const envPath = envIdx >= 0 ? argv[envIdx + 1] : ".env.local";
  const outIdx = argv.indexOf("--output");
  const outputPath = outIdx >= 0 ? argv[outIdx + 1] : null;

  printGuide();
  if (checkMode) {
    await runCheck(envPath, outputPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
