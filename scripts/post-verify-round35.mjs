// scripts/post-verify-round35.mjs
// Verify post-merge state of DONGYANG partners.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] env missing");
  process.exit(2);
}

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const KEEP_ID = "4a9940d0-3438-4f66-adc2-c31dc694fc3f";
const DROP_ID = "cd84d9c8-5139-479d-950e-9ee54b651212";
const TAX = "2500507916";

console.log("=== POST-VERIFY Q1: partners with tax_code=" + TAX + " (expect 1) ===");
const { data: p1, error: p1Err } = await svc
  .from("partners")
  .select("id, name, tax_code, created_at")
  .eq("tax_code", TAX);
console.log("rows:", p1?.length, "err:", p1Err?.message);
for (const r of p1 || []) console.log("  -", r.id, r.name, "tombstone=" + r.is_tombstone, "created=" + r.created_at);

console.log("");
console.log("=== POST-VERIFY Q2: drop_id must not exist (expect 0) ===");
const { data: p2 } = await svc.from("partners").select("id").eq("id", DROP_ID);
console.log("rows:", p2?.length);

console.log("");
console.log("=== POST-VERIFY Q3: partner_companies for keep_id ===");
const { data: pc, error: pcErr } = await svc
  .from("partner_companies")
  .select("partner_id, company_id, companies(name)")
  .eq("partner_id", KEEP_ID);
console.log("rows:", pc?.length, "err:", pcErr?.message);
for (const r of pc || []) console.log("  -", r.partner_id, "→", r.company_id, "(", r.companies?.name, ")");

console.log("");
console.log("=== POST-VERIFY Q4: contracts with keep_id ===");
const { data: c, error: cErr } = await svc
  .from("contracts")
  .select("id, contract_number, partner_id, company_id, archived_at, companies(name)")
  .eq("partner_id", KEEP_ID);
console.log("rows:", c?.length, "err:", cErr?.message);
for (const r of c || []) {
  console.log("  -", r.contract_number, "partner=" + r.partner_id, "company=" + r.company_id, "(", r.companies?.name, ")", "archived=" + r.archived_at);
}

console.log("");
console.log("=== POST-VERIFY Q5: contracts with drop_id (must be 0) ===");
const { data: c2 } = await svc
  .from("contracts")
  .select("id")
  .eq("partner_id", DROP_ID);
console.log("rows:", c2?.length);

process.exit(0);
