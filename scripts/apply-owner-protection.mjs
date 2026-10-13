import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] Supabase env is missing in .env.local — refusing to run");
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STATEMENTS = [
  `CREATE OR REPLACE FUNCTION public.protect_owner_profile()
RETURNS TRIGGER AS $$
BEGIN
  -- Bảo vệ tài khoản Owner duongltvp95@gmail.com (id: 495eb514-82d9-4969-a610-760947a0a79d)
  IF TG_OP = 'DELETE' THEN
    IF OLD.id = '495eb514-82d9-4969-a610-760947a0a79d' THEN
      RAISE EXCEPTION 'Không được phép xoá tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.id = '495eb514-82d9-4969-a610-760947a0a79d' THEN
    IF NEW.role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Không ai có quyền chỉnh sửa vai trò của tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)';
    END IF;
    IF NEW.is_active = false THEN
      RAISE EXCEPTION 'Không ai có quyền vô hiệu hoá tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_protect_owner_profile ON public.profiles;`,
  `CREATE TRIGGER trg_protect_owner_profile
BEFORE UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_owner_profile();`,
];

console.log(`[step] applying ${STATEMENTS.length} statements via public.exec_sql …`);

for (const [index, sql] of STATEMENTS.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] statement ${index + 1} failed: ${error.message}`);
    process.exit(1);
  }
}

console.log(`[step] ${STATEMENTS.length} statements applied successfully.`);

// Test trigger protection: try setting role to 'user' for owner
const OWNER_ID = "495eb514-82d9-4969-a610-760947a0a79d";
const { error: testDemoteErr } = await service
  .from("profiles")
  .update({ role: "user" })
  .eq("id", OWNER_ID);

if (!testDemoteErr) {
  console.error("[fatal] Trigger FAILED to block demoting owner!");
  process.exit(1);
}

console.log("[verify] Trigger correctly BLOCKED demoting owner:", testDemoteErr.message);

// Verify safe update (e.g. updating timestamp or theme) still succeeds
const { error: safeUpdateErr } = await service
  .from("profiles")
  .update({ updated_at: new Date().toISOString() })
  .eq("id", OWNER_ID);

if (safeUpdateErr) {
  console.error("[fatal] Safe update failed:", safeUpdateErr.message);
  process.exit(1);
}

console.log("[verify] Safe update succeeded as expected: OK");
