import { guardLegacyVerifyScript } from "./lib/legacy-script-guard.mjs";

const { env, service: supabase } = guardLegacyVerifyScript({
  scriptName: "scripts/check-partner-count.ts",
  allowLocalhost: true,
});

const orgId = env.E2E_ORG_ID ?? process.env.E2E_ORG_ID;

async function main() {
  let query = supabase
    .from("partners")
    .select("id", { count: "exact", head: true })
    .ilike("name", "E2E%");

  if (orgId) {
    query = query.eq("organization_id", orgId);
  }

  const { count, error } = await query;
  if (error) {
    console.error("ERR", error.message);
    process.exit(1);
  }
  console.log("E2E partners còn lại:", count);
  process.exitCode = count === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


