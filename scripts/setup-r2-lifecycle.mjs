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

function parseEnvFile(envPath) {
  const resolved = path.resolve(process.cwd(), envPath);
  if (!fs.existsSync(resolved)) return {};
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

export function evaluateLifecycleRules(rules = []) {
  const issues = [];
  let hasAiTempRule = false;
  let hasUploadsStagingRule = false;

  for (const rule of rules) {
    if (rule?.Status !== "Enabled") continue;
    const prefix = rule?.Filter?.Prefix ?? rule?.Prefix ?? "";
    const days = rule?.Expiration?.Days ?? null;

    if (!prefix) {
      issues.push(
        `CRITICAL: Enabled lifecycle rule "${rule?.ID ?? "(unnamed)"}" has an empty Prefix and threatens canonical contracts/ objects!`,
      );
      continue;
    }

    if ("contracts/".startsWith(prefix)) {
      issues.push(
        `CRITICAL: Enabled lifecycle rule "${rule?.ID ?? "(unnamed)"}" matches prefix "${prefix}" which overlaps contracts/!`,
      );
    }

    if (prefix === "ai-temp/" && typeof days === "number" && days >= 1) {
      hasAiTempRule = true;
    }

    if (prefix === "uploads-staging/") {
      if (typeof days === "number" && days < 2) {
        issues.push(
          `WARNING: uploads-staging/ expiration is ${days} day(s); must be >= 2 days to exceed the 24h20m upload reservation window.`,
        );
      } else if (typeof days === "number" && days >= 2) {
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
  console.log("3. CẢNH BÁO: Kiểm tra trường Prefix PHẢI LÀ 'ai-temp/' (1 ngày) và 'uploads-staging/' (2 ngày). TUYỆT ĐỐI KHÔNG ĐỂ TRỐNG!");
  console.log("4. Nếu Prefix đang trống hoặc All objects: SỬA HOẶC XÓA NGAY LẬP TỨC.");
  console.log("5. Kiểm tra tự động (read-only): node scripts/setup-r2-lifecycle.mjs --check --env .env.local");
  console.log("====================================================");
}

async function runCheck(envPath) {
  const fileEnv = envPath ? parseEnvFile(envPath) : {};
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
    console.log(JSON.stringify({ bucket, ruleCount: rules.length, ...report }, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error?.name === "NoSuchLifecycleConfiguration") {
      const report = evaluateLifecycleRules([]);
      console.log(JSON.stringify({ bucket, ruleCount: 0, ...report }, null, 2));
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

  printGuide();
  if (checkMode) {
    await runCheck(envPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
