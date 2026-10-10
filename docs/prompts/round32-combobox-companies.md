# Round 32 — Combobox đối tác hiện công ty liên kết (T1 → T2) — DỰ THẢO, CHỜ T1 DUYỆT CUỐI

> Tài liệu giao việc T1 in cho T2. Sau khi T2 gửi report, T1 review → chốt →
> in prompt tiếp theo. **T2 KHÔNG push.**

## Trạng thái mới (T1 verify)

| Mục | Trạng thái |
|---|---|
| HEAD local / origin | `a0e2cda` (round 29 + round 31) — đã push, tree sạch |
| Working tree | chỉ còn `docs/handovers/HANDOVER-NEXT-AI.md` modified (file hand-off) |
| Branch đích | `feat/partner-combobox-companies` (T2 tạo, KHÔNG push) |
| Test ID thống nhất | `data-testid="partner-company-badge"` (đã có ở `CompanyBadges`) |
| Dữ liệu production | 143 đối tác thật + 143 row `partner_companies` (giữ nguyên, KHÔNG đụng) |
| Tài khoản test | `e2e.wave2@hrpartner.vn` (password trong `.env.local` — **không xoá**) |

## Bối cảnh

Combobox chọn đối tác ở form thêm hợp đồng hiện chỉ hiện `Tên + MST`.
Bảng đối tác đã hiện badge công ty liên kết (HRP / HR VN / cả hai).
Owner muốn combobox cũng hiện badge giống vậy, ở **cả dòng lựa chọn**
lẫn **nút đã chọn**, để user không phải đoán đối tác nào gắn với HRP.

Ràng buộc:
- Dữ liệu công ty **lazy theo từng đối tác** (khi mở popover hoặc khi
  user gõ tìm). Không nạp toàn bộ lúc đầu — payload vẫn nhẹ như round 6.
- Tái dùng `CompanyBadges` (REUSE FIRST), không viết badge mới.
- Không tạo API mới — chỉ thêm service export + server action + render.
- Không tạo trang mới, không tạo thêm cột DB.

## Việc của T2

### 1. Tạo branch + đọc lại 4 file

```bash
cd D:\HRP-app\Contract-mange-hrp
git checkout -b feat/partner-combobox-companies
```

Đọc để nắm shape hiện tại:
- [lib/services/partners.ts](lib/services/partners.ts) — đặc biệt
  `searchPartners` (đã có sẵn, ~dòng 278) và `companiesForPartner` (private,
  ~dòng 147)
- [app/(app)/partners/actions.ts](app/(app)/partners/actions.ts) — đặc biệt
  `searchPartnersAction` (cùng pattern sẽ tái sử dụng)
- [components/partners/partner-combobox.tsx](components/partners/partner-combobox.tsx)
- [components/partners/partner-badges.tsx](components/partners/partner-badges.tsx) — nguồn `CompanyBadges`

### 2. Thêm service — `lib/services/partners.ts`

Refactor `companiesForPartner` (private) thành **`companiesForOnePartner`
(export)**, giữ nguyên logic, thêm guard `organization_id` tường minh
để trả `[]` thay vì lộ sự tồn tại:

```ts
/**
 * Round 32 — công ty liên kết của 1 đối tác, gọi lazy từ combobox.
 *
 * RLS đã chặn partner ở org khác ở mức `partner_companies`, nhưng check
 * tường minh `organization_id` trên bảng `partners` để trả về []
 * thay vì lộ sự tồn tại.
 */
export async function companiesForOnePartner(
  partnerId: unknown,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<string[]>>
```

Khi partner không thuộc `organizationId` → `{ ok: true, data: [] }`.

Đổi tên **2 chỗ gọi hiện tại** (`getPartner`, `setPartnerStatus`) sang
tên mới; giữ nguyên `companiesForPartners` (bulk — round 23 dùng cho
export) không đổi.

### 3. Thêm server action — `app/(app)/partners/actions.ts`

```ts
export async function partnerCompaniesAction(
  id: unknown,
): Promise<ActionResult<string[]>>
```

Tổ chức giống `searchPartnersAction` ngay phía trên (cùng pattern:
kiểm tra session, gọi service, map lỗi).

### 4. Mở rộng combobox — `components/partners/partner-combobox.tsx`

- Mở rộng `PartnerOption`: thêm `companies?: string[]` (optional, default
  `[]` để tương thích ngược với props cũ)
- Import: `partnerCompaniesAction`, `CompanyBadges` từ
  [components/partners/partner-badges.tsx](components/partners/partner-badges.tsx)
- State mới:
  - `const [companiesByPartner, setCompaniesByPartner] = useState<Record<string, string[]>>({})`
  - `const inflightRef = useRef<Set<string>>(new Set())` — gom request trùng id
- Effect: khi `open` → `true` hoặc `term` đổi → với mỗi id trong
  `[...visible, ...options]` (gồm cả `selected`/`picked`/`selectedPartner`
  nếu có) chưa có trong map và chưa inflight → gọi `partnerCompaniesAction(id)`.
  Try/catch, lỗi → `[]` (không chặn UI).
- Render:
  - **Dòng lựa chọn** (nút `data-testid="partner-option"`): thêm
    `<CompanyBadges companies={...} />` dưới dòng MST (`mt-1`,
    `flex flex-col gap-0.5`)
  - **Nút trigger** (`data-testid="partner-combobox"`): thêm
    `<CompanyBadges companies={...} />` ngay bên phải tên
    (compact, `gap-1`, chỉ hiện khi đã chọn)

**Không đụng** [components/contracts/contract-form.tsx](components/contracts/contract-form.tsx) — chỉ
truyền thêm field optional vào `PartnerOption` (backward-compatible).

### 5. Test gate (chạy, ghi số liệu thật vào báo cáo)

1. `pnpm typecheck` — 0 lỗi
2. `pnpm lint` — 0 warning
3. `pnpm build` — pass
4. Thêm 1 case e2e vào [tests/e2e/partners.spec.ts](tests/e2e/partners.spec.ts):
   - Mở form thêm hợp đồng (qua `/contracts/new` hoặc tương đương)
   - Mở combobox (`page.getByTestId('partner-combobox').click()`)
   - Tìm 1 đối tác đã liên kết công ty (dùng `E2ETEST-` prefix hoặc
     chọn 1 trong 143 đối tác thật — **KHÔNG sweep đối tác thật**)
   - `expect(page.getByTestId('partner-company-badge').first()).toBeVisible()`
   - Chọn xong → expect badge hiện ở nút trigger
5. Chạy full suite (unit + integration + e2e) — ghi số liệu
6. Sweep dọn dữ liệu test về 0 (CHỈ phần do T2 tạo) — xác nhận trong report
7. **Không đụng**: 143 đối tác thật, 143 row junction, account
   `e2e.wave2@hrpartner.vn`, profile/test data của Owner

### 6. Commit local (KHÔNG push)

- 1 commit, message tiếng Việt, ví dụ:
  `feat(partners): combobox hien cong ty lien ket (round 32)`
- T2 KHÔNG push. T1 sẽ tự push sau khi duyệt report.

## Báo cáo T2 trả về (5 mục bắt buộc, tiếng Việt)

| # | Mục | Mẫu |
|---|---|---|
| 1 | Đã làm | theo file + commit hash |
| 2 | Kết quả kiểm chứng | typecheck/lint/build pass + số test pass/mấy + sweep về 0 |
| 3 | Lệch so với prompt | nếu có, nói rõ + lý do |
| 4 | Tự commit/push? | commit local, **KHÔNG push** (chờ T1 duyệt) |
| 5 | Vấn đề còn lại / rủi ro | kể cả thứ T2 không kiểm được |

## Quyết định T1 chốt trước khi gửi

| Câu hỏi T1 quyết | Quyết |
|---|---|
| Branch name | `feat/partner-combobox-companies` |
| Test ID | tái dùng `data-testid="partner-company-badge"` |
| Phạm vi | 3 file + 1 spec — không đụng schema/RLS/RPC/contract-form |
| Lazy-load | bắt buộc, gom trùng id bằng `inflightRef` |
| Backward-compat | `companies?: string[]` optional trên `PartnerOption` |
| Push | T2 KHÔNG push, T1 tự push |

## Giới hạn

- KHÔNG thêm dependency
- KHÔNG viết migration
- KHÔNG đụng `lib/services/users.ts`, `users-table.tsx`
- KHÔNG tạo script `verify-*`/`check-*` tạm trong repo (nếu cần probe
  thì xoá trước khi commit, xác nhận `git status` sạch)
- KHÔNG sweep đối tác thật / junction / tài khoản test
- KHÔNG sửa app để thêm nút xoá đối tượng (Owner đã cấm theo workspace rule §6)
- KHÔNG push
- KHÔNG trả lời bằng tiếng Anh
- KHÔNG in credential ra log/chat (chỉ in tên biến + SET/EMPTY/độ dài)
