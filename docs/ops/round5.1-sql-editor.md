# SQL Editor — Round 5.1 setup (Owner thực hiện)

> File này T1 viết sau khi T2 báo cáo script fail với "Could not find the function public.exec_sql(sql)".
>
> **Hai nguyên nhân có thể** (T1 chưa biết cái nào):
> 1. Owner đã paste SQL vào Editor nhưng quên nhấn **Run** (hoặc chạy trên project khác).
> 2. Function đã tạo trong DB nhưng **PostgREST schema cache chưa refresh** — phải chạy `NOTIFY pgrst, 'reload schema';`.
>
> Mục tiêu: chạy cho đến khi query 4 trả về **1 row** với `get_rpc_method_used_status = OK`.

## Bước 1 — Verify function chưa tồn tại (chẩn đoán)

Chạy query này trong Supabase SQL Editor:

```sql
select count(*) as exec_sql_exists
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'exec_sql';
```

| Kết quả | Hành động tiếp |
|---|---|
| `0` | Function chưa có → Bước 2A |
| `1` | Function đã có → Bước 2B (chỉ cần refresh cache) |

---

## Bước 2A — Function chưa có: tạo mới + refresh

Paste nguyên khối này vào SQL Editor → Run (Ctrl+Enter):

```sql
-- Round 5.1 — create public.exec_sql(text) utility
-- (mirror of supabase/migrations/20261006140000_create_exec_sql.sql)

create or replace function public.exec_sql(sql text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute sql;
end;
$$;

revoke all on function public.exec_sql(text) from public;

grant execute on function public.exec_sql(text) to service_role;

comment on function public.exec_sql(text) is
  'Round 5.1 ops utility — execute a hard-coded DDL/DML string with service-role privileges. Never expose to anon or authenticated.';

-- Force PostgREST to pick up the new function immediately
NOTIFY pgrst, 'reload schema';
```

Sau khi Run → chuyển **Bước 3**.

---

## Bước 2B — Function đã có: chỉ cần refresh cache

Paste nguyên khối này vào SQL Editor → Run:

```sql
-- Force PostgREST to re-discover exec_sql (idempotent, no DDL change)
NOTIFY pgrst, 'reload schema';
```

Sau khi Run → chuyển **Bước 3**.

---

## Bước 3 — Verify (luôn chạy để biết check pass hay fail)

```sql
-- 3a. function tồn tại
select count(*) as exec_sql_count
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'exec_sql';

-- 3b. chỉ service_role được grant
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'exec_sql';

-- 3c. exec_sql có thể chạy 1 query mẫu (KHÔNG dùng rpc — dùng SQL để test
--     function chạy đúng với service_role = current_user = postgres ở SQL Editor)
select public.exec_sql('select 1');

-- 3d. thử gọi như anon để confirm bị chặn (kỳ vọng: permission denied)
--     [CHẠY bằng cách mở tab SQL với role "anon" trước, nếu có. Nếu Editor
--      không cho đổi role thì bỏ qua 3d, không bắt buộc.]
```

**Kết quả mong đợi:**
- `3a`: `1`
- `3b`: 1 row với `grantee = service_role`, `privilege_type = EXECUTE`
- `3c`: không lỗi (Success. No rows returned)

---

## Bước 4 — Báo cáo về T1

Paste kết quả của 3a + 3b + 3c vào chat với T1 (T1 sẽ báo T2 chạy lại script).

---

# Sau khi Bước 3 pass → workflow tiếp tục

| Bước | Ai | Việc |
|---|---|---|
| 1 | Owner | (file này) chạy SQL Editor đến khi 3a/3b/3c pass |
| 2 | Owner | Gửi kết quả cho T1 |
| 3 | T1 | Chuyển cho T2 chạy `node scripts/apply-round5-prod.mjs` |
| 4 | T2 | Script exit 0 → 3 verify (on hardcode delete) pass → smoke `/settings` |
| 5 | T1 | Push 2 commit (`c3fbda6` + `24568bc`) lên `origin/main` |
| 6 | Owner | Redeploy Vercel |
| 7 | T2 | Smoke `/settings` lần 2: row tombstone biến mất |

---

# Nếu Bước 3 fail

| Lỗi | Cách xử |
|---|---|
| `3a` vẫn trả 0 sau khi chạy Bước 2A | Function không được tạo. Đăng ký lại, thử Run riêng phần `create or replace function ... $$ ... $$;` trước (không có `NOTIFY`), xem editor có báo lỗi syntax không |
| `3c` báo "function public.exec_sql(text) does not exist" | Function chưa commit xong vào DB. Chạy lại Bước 2A |
| `3c` báo "permission denied" khi gọi `exec_sql` | SQL Editor chạy dưới role `postgres` (superuser), lẽ ra phải pass. Nếu fail → role không phải superuser → liên hệ Supabase support |
| T2 vẫn báo "Could not find the function public.exec_sql(sql) in the schema cache" sau khi 3a/3b/3c pass | PostgREST cache vẫn chưa refresh — chờ 30 giây rồi chạy lại Bước 2B. Nếu vẫn fail → gửi T1 để debug thêm |