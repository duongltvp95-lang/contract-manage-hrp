import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const orgId = process.env.E2E_ORG_ID;
if (!url || !key) {
  console.error("Thiếu env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

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


