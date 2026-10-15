// scripts/verify-2fa-status.mjs
//
// Kiểm tra trạng thái đăng ký 2FA / TOTP của các tài khoản Admin & Owner trên Supabase

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] Thiếu cấu hình Supabase trong .env.local");
  process.exit(1);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("==============================================================");
console.log(" [HRP Contract Manager] Kiểm tra trạng thái 2FA / MFA Admin ");
console.log("==============================================================");

const { data, error } = await service.auth.admin.listUsers();
if (error) {
  console.error("[-] Lỗi khi lấy danh sách user:", error.message);
  process.exit(1);
}

const targetEmails = ["duongltvp95@gmail.com", "duongamo10300@gmail.com"];

for (const email of targetEmails) {
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.log(`[i] Không tìm thấy tài khoản: ${email}`);
    continue;
  }

  const factorCount = user.factors ? user.factors.length : 0;
  console.log(`\n> Tài khoản: ${email} (ID: ${user.id})`);
  console.log(`  - Trạng thái 2FA (MFA Factors): ${factorCount > 0 ? "ĐÃ BẬT (" + factorCount + " factor)" : "CHƯA BẬT (0 factor)"}`);
  if (factorCount > 0) {
    user.factors.forEach((f, idx) => {
      console.log(`    [Factor #${idx + 1}] Loại: ${f.factor_type} | Tên: ${f.friendly_name || "Mặc định"} | Trạng thái: ${f.status}`);
    });
  } else {
    console.log("    -> Khuyến nghị: Cần quét mã QR vào ứng dụng Authenticator (Google Authenticator / Authy) để hoàn tất đăng ký factor.");
  }
}
console.log("\n==============================================================");
