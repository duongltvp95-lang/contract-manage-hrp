// scripts/apply-round35-partner-merge.mjs
//
// Round 35 ops script — gộp 2 bản ghi `partners` cùng MST 2500507916
// (CÔNG TY TNHH DONGYANG ELECTRONICS VIỆT NAM) thành 1 dòng trên
// production Supabase.
//
// Quyết định Owner (2026-10-11):
//   1. Gộp SQL thật, giữ 1 bản ghi, xóa 1 bản ghi dư. KHÔNG dedupe UI.
//   2. Hợp đồng trỏ bản ghi bị xóa → chuyển `partner_id` sang bản ghi
//      giữ lại, giữ nguyên `company_id`.
//   3. Idempotent: chạy lại an toàn.
//
// Lý do dùng exec_sql từng statement:
//   - exec_sql(text) chỉ chạy 1 statement mỗi lần
//   - file migration gốc 20261011000001 dùng DO $$...$$ block không
//     phù hợp — tôi tách thành 4 câu SQL thuần (kiểm tra + 3 thao tác).
//   - Mỗi statement có pre-check riêng (drop_tax IS NULL → skip) để
//     giữ idempotency.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round35-partner-merge.mjs

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// 1. environment gates
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function describeEnv(name, value) {
  if (!value) return `${name}=EMPTY`;
  return `${name}=SET length=${value.length}`;
}

console.log("[env] " + describeEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL));
console.log(
  "[env] " + describeEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
);

if (!SUPABASE_URL) {
  console.error("[fatal] NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  process.exit(2);
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[fatal] SUPABASE_SERVICE_ROLE_KEY is not set in .env.local — refusing to run",
  );
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// 2. fixed IDs (must match the migration file exactly)
// ---------------------------------------------------------------------------

const KEEP_ID = "4a9940d0-3438-4f66-adc2-c31dc694fc3f"; // 2026-10-08, gắn HR VN
const DROP_ID = "cd84d9c8-5139-479d-950e-9ee54b651212"; // 2026-10-10, gắn HRP

// ---------------------------------------------------------------------------
// 3. pre-check: read both rows through PostgREST
// ---------------------------------------------------------------------------

console.log("[step] pre-check: read both partner rows …");

const { data: keepRow, error: keepErr } = await service
  .from("partners")
  .select("id, tax_code, name")
  .eq("id", KEEP_ID)
  .maybeSingle();

if (keepErr) {
  console.error("[fatal] pre-check KEEP_ID failed:", keepErr.message);
  process.exit(1);
}
if (!keepRow) {
  console.error(
    `[fatal] keep_id ${KEEP_ID} not found — refusing to run (Owner must investigate)`,
  );
  process.exit(1);
}

const { data: dropRow, error: dropErr } = await service
  .from("partners")
  .select("id, tax_code, name")
  .eq("id", DROP_ID)
  .maybeSingle();

if (dropErr) {
  console.error("[fatal] pre-check DROP_ID failed:", dropErr.message);
  process.exit(1);
}
if (!dropRow) {
  console.log(
    `[skip] drop_id ${DROP_ID} already removed by a previous run — nothing to do`,
  );
  console.log("[ok] idempotent exit");
  process.exit(0);
}

console.log(
  `[step] pre-check OK: keep={tax=${keepRow.tax_code}, name="${keepRow.name}"}, ` +
    `drop={tax=${dropRow.tax_code}, name="${dropRow.name}"}`,
);

if (keepRow.tax_code !== dropRow.tax_code) {
  console.error(
    `[fatal] tax codes differ: keep=${keepRow.tax_code}, drop=${dropRow.tax_code} — refusing to merge`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. count contracts + partner_companies linked to drop_id
// ---------------------------------------------------------------------------

console.log("[step] counting contracts and partner_companies for drop_id …");

const { count: contractsBefore, error: cErr } = await service
  .from("contracts")
  .select("id", { count: "exact", head: true })
  .eq("partner_id", DROP_ID);

if (cErr) {
  console.error("[fatal] count contracts failed:", cErr.message);
  process.exit(1);
}
console.log(`[step] contracts linked to drop_id BEFORE: ${contractsBefore}`);

const { data: dropLinks, error: linksErr } = await service
  .from("partner_companies")
  .select("company_id")
  .eq("partner_id", DROP_ID);

if (linksErr) {
  console.error("[fatal] read partner_companies failed:", linksErr.message);
  process.exit(1);
}
const linksBefore = Array.isArray(dropLinks) ? dropLinks.length : 0;
console.log(`[step] partner_companies links on drop_id BEFORE: ${linksBefore}`);

if (contractsBefore === 0 && linksBefore === 0) {
  console.log(
    "[skip] drop_id has no contracts and no partner_companies links — " +
      "safe to delete directly",
  );
}

// ---------------------------------------------------------------------------
// 5. apply the 4 SQL steps via public.exec_sql
// ---------------------------------------------------------------------------

const STATEMENTS = [
  // Step 1: contracts.partner_id drop_id → keep_id (giữ nguyên company_id)
  `update public.contracts
     set partner_id = '${KEEP_ID}'
   where partner_id = '${DROP_ID}'`,

  // Step 2: chuyển partner_companies drop_id → keep_id (ON CONFLICT skip)
  `insert into public.partner_companies (partner_id, company_id)
     select '${KEEP_ID}'::uuid, company_id
       from public.partner_companies
      where partner_id = '${DROP_ID}'
   on conflict (partner_id, company_id) do nothing`,

  // Step 3: xóa partner_companies của drop_id
  `delete from public.partner_companies where partner_id = '${DROP_ID}'`,

  // Step 4: xóa partners drop_id
  `delete from public.partners where id = '${DROP_ID}'`,
];

console.log(`[step] applying ${STATEMENTS.length} statements via public.exec_sql …`);

for (const [index, sql] of STATEMENTS.entries()) {
  const label = `step ${index + 1}/${STATEMENTS.length}`;
  console.log(`[step] ${label} …`);
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] ${label} failed: ${error.message}`);
    console.error("[fatal] SQL was:", sql);
    process.exit(1);
  }
}

console.log("[step] all statements applied");

// ---------------------------------------------------------------------------
// 6. verify (3 queries)
// ---------------------------------------------------------------------------

console.log("[verify] Q1 — drop_id should be gone …");
const { data: dropAfter, error: q1Err } = await service
  .from("partners")
  .select("id")
  .eq("id", DROP_ID);

if (q1Err) {
  console.error("[fatal] Q1 verify failed:", q1Err.message);
  process.exit(1);
}
const dropAfterRows = Array.isArray(dropAfter) ? dropAfter.length : 0;
console.log(`[verify] Q1 drop_id rows AFTER: ${dropAfterRows} (expect 0)`);
if (dropAfterRows !== 0) {
  console.error("[fatal] drop_id still exists after delete");
  process.exit(1);
}

console.log("[verify] Q2 — contracts still linked to drop_id (must be 0) …");
const { count: contractsAfter, error: q2Err } = await service
  .from("contracts")
  .select("id", { count: "exact", head: true })
  .eq("partner_id", DROP_ID);

if (q2Err) {
  console.error("[fatal] Q2 verify failed:", q2Err.message);
  process.exit(1);
}
console.log(
  `[verify] Q2 contracts linked to drop_id AFTER: ${contractsAfter} (expect 0, was ${contractsBefore})`,
);
if (contractsAfter !== 0) {
  console.error("[fatal] some contracts still point to drop_id");
  process.exit(1);
}

console.log("[verify] Q3 — keep_id still exists, links migrated …");
const { data: keepAfter, error: q3Err } = await service
  .from("partners")
  .select("id, tax_code, name")
  .eq("id", KEEP_ID)
  .maybeSingle();

if (q3Err) {
  console.error("[fatal] Q3 verify failed:", q3Err.message);
  process.exit(1);
}
if (!keepAfter) {
  console.error("[fatal] keep_id vanished — abort");
  process.exit(1);
}
console.log(
  `[verify] Q3 keep_id OK: id=${keepAfter.id}, tax=${keepAfter.tax_code}, name="${keepAfter.name}"`,
);

const { data: keepLinks, error: q3LinksErr } = await service
  .from("partner_companies")
  .select("company_id")
  .eq("partner_id", KEEP_ID);

if (q3LinksErr) {
  console.error("[fatal] Q3b verify failed:", q3LinksErr.message);
  process.exit(1);
}
const keepLinksCount = Array.isArray(keepLinks) ? keepLinks.length : 0;
console.log(
  `[verify] Q3 keep_id partner_companies AFTER: ${keepLinksCount} ` +
    `(was drop=${linksBefore} + keep_pre_existing)`,
);

// ---------------------------------------------------------------------------
// 7. summary
// ---------------------------------------------------------------------------

console.log("");
console.log("=== round 35 apply summary ===");
console.log(`keep_id: ${KEEP_ID} (${keepAfter.tax_code} — "${keepAfter.name}")`);
console.log(`drop_id: ${DROP_ID} — deleted: OK`);
console.log(`contracts moved: ${contractsBefore} (0 → drop_id, all → keep_id)`);
console.log(`partner_companies links on keep_id AFTER: ${keepLinksCount}`);
console.log(`drop_id rows AFTER: ${dropAfterRows} (expect 0)`);
console.log(`contracts linked to drop_id AFTER: ${contractsAfter} (expect 0)`);
console.log("[ok] all verify checks passed");
process.exit(0);
