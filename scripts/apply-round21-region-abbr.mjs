// scripts/apply-round21-region-abbr.mjs
//
// Round 21, part 1 ops script — add partners.region + partners.abbreviation
// and re-create search_partners to match the abbreviation, via public.exec_sql.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round21-region-abbr.mjs

import { guardLegacyDdlScript } from "./lib/legacy-script-guard.mjs";

const { service } = guardLegacyDdlScript({
  scriptName: "scripts/apply-round21-region-abbr.mjs",
  statementCount: 8,
  supersededBy: "supabase/migrations/20261106140200_partners_folded_keys_and_pagination.sql",
});

const STATEMENTS = [
  `alter table public.partners add column if not exists region text, add column if not exists abbreviation text`,
  `alter table public.partners drop constraint if exists partners_region_length_check`,
  `alter table public.partners add constraint partners_region_length_check check (char_length(region) <= 100)`,
  `alter table public.partners drop constraint if exists partners_abbreviation_length_check`,
  `alter table public.partners add constraint partners_abbreviation_length_check check (char_length(abbreviation) <= 50)`,
  `comment on column public.partners.region is 'Khu vực (tự do, tuỳ chọn, tối đa 100 ký tự).'`,
  `comment on column public.partners.abbreviation is 'Tên viết tắt (tự do, tuỳ chọn, tối đa 50 ký tự), khớp trong tìm kiếm nhanh.'`,
  `create or replace function public.search_partners(term text, lim int default 50) returns setof public.partners language sql security invoker set search_path = public, extensions as $$ select * from public.partners where status = 'active' and (lower(replace(unaccent(coalesce(name, '')), 'đ', 'd')) like '%' || lower(replace(unaccent(coalesce(term, '')), 'đ', 'd')) || '%' or coalesce(tax_code, '') ilike '%' || coalesce(term, '') || '%' or lower(replace(unaccent(coalesce(abbreviation, '')), 'đ', 'd')) like '%' || lower(replace(unaccent(coalesce(term, '')), 'đ', 'd')) || '%') order by name asc limit lim; $$`,
];

console.log(`[step] applying ${STATEMENTS.length} statements via public.exec_sql …`);

for (const [index, sql] of STATEMENTS.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] statement ${index + 1} failed: ${error.message}`);
    process.exit(1);
  }
}

// Verify the columns exist.
const { error: colError } = await service
  .from("partners")
  .select("region, abbreviation")
  .limit(0);
if (colError) {
  console.error(`[fatal] column probe failed: ${colError.message}`);
  process.exit(1);
}

console.log("");
console.log("=== round 21 part 1 apply summary ===");
console.log(`statements applied: ${STATEMENTS.length}`);
console.log("partners.region + abbreviation columns: OK");
console.log("search_partners matches abbreviation: OK");
console.log("[ok] done");
process.exit(0);
