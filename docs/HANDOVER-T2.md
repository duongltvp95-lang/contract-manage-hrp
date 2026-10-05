# BÀN GIAO VỊ TRÍ T2 — DỰ ÁN CONTRACT MANAGER

> Tài liệu dành cho T2 mới tiếp quản. Đọc hết trước khi nhận việc đầu tiên.
>
> Tiếp quản: 2026-10-05 (sau đợt xác minh 48/48 trên production).
> File này **không** chứa mật khẩu / PAT / service_role / R2 secret.

Quy tắc làm việc bắt buộc nằm ở `.cursor/rules/agent-working-rules.mdc`
(`alwaysApply: true`) — đọc file đó trước. Tóm tắt: **tiếng Việt**, **không in
credential**, **REUSE FIRST**, **không tự đổi quyết định Owner**, **báo cáo 5 mục**.

---

## 1. Tài khoản test BẮT BUỘC phải tồn tại

Cả `pnpm test:integration` và `pnpm test:e2e` đăng nhập vào **Supabase + R2
thật**. Không có tài khoản thì suite **fail**, không phải skip — vì cờ
`hasLiveBackend` chỉ kiểm tra biến môi trường có *đặt* hay không, chứ không kiểm
tra tài khoản có *tồn tại* hay không:

```44:53:tests/e2e/helpers.ts
export const hasLiveBackend = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    ADMIN_EMAIL &&
    ADMIN_PASSWORD,
);
```

### Tài khoản đang dùng

| Thuộc tính | Giá trị |
|---|---|
| Email | `e2e.wave2@hrpartner.vn` |
| Mật khẩu | 28 ký tự, **lưu trong `.env.local`**, không ghi ở đây |
| `email_confirmed_at` | phải khác null (auto-confirm) |
| `profiles.role` | `admin` |
| `profiles.organization_id` | `11111111-1111-1111-1111-111111111111` (ORG_A) |
| `profiles.is_active` | `true` |

Cả ba điều kiện cuối là **bắt buộc**: thiếu `role='admin'` thì spec `settings`
và `security` không thấy mục quản lý người dùng; thiếu `email_confirmed_at` thì
đăng nhập bị từ chối (public sign-up đã tắt).

### Trước mỗi lần chạy suite

Sau khi `pnpm test:e2e`, **kiểm tra lại tài khoản còn tồn tại**:

```
GET {SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200
Header: apikey + Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}
```

Nếu không thấy `e2e.wave2@hrpartner.vn` → chạy lại script ở mục 2, **đừng sửa
`.env.local` trỏ sang tài khoản khác**.

### Vì sao phải có quy trình này

Đợt trước, tài khoản test của Wave 1 bị xoá khỏi Supabase auth giữa lúc chạy
suite và lúc kiểm tra lại — **không phải do code trong repo** (mọi đường dẫn
cleanup đều lọc theo prefix `E2ETEST-` / `W1TEST-` / `e2e.user.*`). Hệ quả: lần
chạy kế tiếp fail ở bước login với thông điệp `Invalid login credentials`, dễ
tưởng là lỗi app. Vì vậy bắt buộc coi "tài khoản test tồn tại" là **tiền đề kiểm
chứng**, không phải hậu kiểm.

---

## 2. Khi phải tạo lại tài khoản test

Dùng **service role** (`.env.local` đã có `SUPABASE_SERVICE_ROLE_KEY`):

1. `auth.admin.createUser({ email, password, email_confirm: true })`
2. Trigger `on_auth_user_created` tự tạo `profiles` với `role='user'` — phải
   **nâng lên `admin`**:
   `profiles.update({ role: 'admin', organization_id: ORG_A, is_active: true })`
3. Ghi `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` vào `.env.local`
4. Kiểm tra đăng nhập thật: `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`

Cơ chế này giống hệt `lib/services/users.ts` (`createUser`) — reuse theo quy tắc
3, đừng tự phát minh cách khác. Chi tiết migration:

```53:71:supabase/migrations/20261003090200_create_profiles.sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, organization_id, full_name, role, is_active)
  values (
    new.id,
    public.default_organization_id(),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    'user',
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
```

**Không** tạo trực tiếp bằng SQL `insert into auth.users` — Supabase cấm, và bypass
mất luôn trigger.

---

## 3. Không dùng tài khoản thật của Owner để test

Tài khoản `duongltvp95@gmail.com` (Khương Văn Đường) là tài khoản **thật**.

Lý do không được trỏ `TEST_ADMIN_EMAIL` vào nó:

- Mỗi lần chạy suite sẽ **tạo và xoá** user, đối tác, hợp đồng dưới tài khoản
  Owner — rủi ro thao tác nhầm chạm dữ liệu thật.
- `settings.spec.ts` tạo user mới; `security.spec.ts` tạo tenant thứ hai. Cả hai
  đều ghi vào tài khoản đang đăng nhập.
- Trái với nguyên tắc "tách biệt test / prod" mà dự án chốt từ đầu.

Dữ liệu của Owner **không được xoá** dưới bất kỳ hình thức nào.

---

## 4. Dữ liệu thật và dọn dẹp

Suite chạy trên backend thật nên **phải dọn về 0 sau mỗi lần chạy**:

| Kiểm tra | Kỳ vọng |
|---|---|
| `contracts` khớp `E2ETEST-%` / `W1TEST-%` | 0 |
| `partners` khớp `E2ETEST-%` / `W1TEST-%` | 0 |
| object R2 dưới tiền tố `contracts/` | 0 |
| `profiles` không có auth user (mồ côi) | 0 |
| user `e2e.user.*` do `settings.spec` tạo | 0 |

Suite có `sweep()` trong `tests/e2e/helpers.ts` và `sweepTestRows()` trong
`tests/integration/helpers.ts`, nhưng **vẫn phải kiểm tra lại bằng truy vấn
trực tiếp** trước khi báo cáo "xong". Xem mục 6.

### App cố ý không có chức năng xoá

Xoá user / đối tác / hợp đồng là **quyết định nghiệp vụ đã chốt**, không phải
thiếu sót. Muốn dọn dữ liệu test thì dùng service role hoặc Supabase Dashboard
— **không** sửa app để thêm nút xoá.

---

## 5. App chạy ở đâu

- Production: `https://contract-manage-hrp.vercel.app`
- Local: `http://localhost:3000` (port 3000 là bắt buộc — CORS của bucket R2 chỉ
  cho phép origin này, xem `playwright.config.ts`)
- Repo: `https://github.com/duongltvp95-lang/contract-manage-hrp`, branch `main`

Chạy e2e trên production:

```powershell
$env:E2E_BASE_URL="https://contract-manage-hrp.vercel.app"
pnpm test:e2e
```

---

## 6. Quy trình báo cáo (5 mục bắt buộc)

1. **Đã làm** — theo từng bước, kèm file/commit hash.
2. **Kết quả kiểm chứng** — lệnh đã chạy + kết quả thật. Không nói "đã xong"
   mà không có bằng chứng (số test pass/mấy, build pass/fail, dữ liệu về 0 chưa).
3. **Lệch so với prompt** — làm khác chỉ dẫn thì nói rõ và giải thích lý do.
4. **Tự động commit/push?** — luôn hỏi T1 trước. **Không push khi chưa được duyệt.**
5. **Vấn đề còn lại / rủi ro** — kể cả thứ mình không kiểm được.

Về credential: khi xác nhận biến đã set, chỉ in **tên biến + SET/EMPTY/độ dài**,
không in giá trị. Phát hiện credential bị lộ → **báo T1/Owner ngay**, không tự
xoay vòng xử lý.
