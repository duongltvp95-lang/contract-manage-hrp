# Round 5.1 — Continue (T1 → T2)

## Trạng thái mới (T1 verify ngày 2026-10-06)

| Mục | Trạng thái |
|---|---|
| Owner chạy SQL Editor Bước 2A/2B | ✅ (verified bằng 3b + 3c — `exec_sql` chạy được với service_role) |
| `select public.exec_sql('select 1')` | ✅ pass |
| Working tree local | 3 untracked: `AGENTS.md`, `CLAUDE.md`, `docs/prompts/` |
| Commits local | `f28db55` (round 5.1, đã amend thêm NOTIFY comment + ops doc), `c3fbda6` (round 5) |

## Việc của T2 — tiếp tục từ lúc dừng trước đó

### 1. (Khuyến nghị) Owner chạy thêm 1 dòng trong SQL Editor

PostgREST schema cache có thể chưa refresh. Owner chạy 1 query này:

```sql
NOTIFY pgrst, 'reload schema';
```

(Bất kể function đã tồn tại từ trước — NOTIFY là idempotent và an toàn.)

Nếu Owner không có ở đây, T2 vẫn chạy được tiếp bước 2 (script sẽ tự retry hoặc sẽ báo lại nếu cache vẫn chưa refresh).

### 2. Chạy lại script

```bash
node scripts/apply-round5-prod.mjs
```

Kỳ vọng:
- Exit 0
- 3 verify pass (column có, tombstone có `is_tombstone=true`, tombstone còn 1)
- Smoke `/settings` production (theo kịch bản đã có trong script cũ)

### 3. Nếu vẫn fail với "schema cache not found"

Có 3 cách:
- A. Đợi 30 giây rồi chạy lại script (cache có thể tự refresh với delay)
- B. Chạy `NOTIFY pgrst, 'reload schema';` qua psql/SQL Editor rồi chạy lại script
- C. Thử đăng nhập lại Dashboard (đôi khi Supabase refresh cache khi session thay đổi)

T2 thử A trước (1 phút), nếu fail → B, nếu vẫn fail → báo T1.

### 4. Sau khi script pass — báo cáo về T1

Báo cáo các mục:

| # | Mục | Mẫu |
|---|---|---|
| 1 | Script exit code | 0 |
| 2 | 3 verify kết quả (column có / tombstone is_tombstone=true / count) | in ra stdout |
| 3 | Smoke `/settings` production — row tombstone có hiển thị không | "vẫn hiện (vì c3fbda6 chưa push)" hoặc "ẩn" |
| 4 | Commit local mới (nếu có) hoặc HEAD hiện tại | `git rev-parse HEAD` |
| 5 | Working tree | `git status --short` |

T2 KHÔNG push, KHÔNG amend `f28db55`. T1 sẽ tự push 2 commit (`c3fbda6` + `f28db55`).

### 5. Giới hạn (vẫn như round 5.1 cũ)

- KHÔNG thêm dependency
- KHÔNG viết migration mới
- KHÔNG đụng `users.ts` / `users-table.tsx`
- KHÔNG sửa 3 integration test fail pre-existing (round riêng)
- KHÔNG push

## Quyết định T1 chốt trước khi gửi

| Câu hỏi T1 quyết | Quyết |
|---|---|
| T2 có cần gặp Owner để chạy NOTIFY không? | Không bắt buộc — T2 thử A trước |
| Nếu cache vẫn fail sau 3 lần thử? | Báo T1, T1 sẽ xử riêng (có thể T1 thêm 1 round "warm up" — gọi 1 query bất kỳ qua PostgREST trước khi gọi exec_sql, ép cache phải re-fetch) |
| Working tree 3 untracked có đụng không? | KHÔNG (round 3 follow-up, làm sau) |
| 3 integration test fail có sửa không? | KHÔNG (round riêng, ghi HANDOVER-T2) |