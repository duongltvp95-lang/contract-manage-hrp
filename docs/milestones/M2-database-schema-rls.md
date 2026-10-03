# M2 — Database Schema & RLS (Wave 1)

Task range: `W1-WEB-005` → `W1-WEB-009` (plan sections 29-34, 72).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

## Reuse / Custom declaration (plan section 87)

```text
W1-WEB-005..008  Tables

Reuse:
  Supabase RLS primitives
  Postgres triggers / plpgsql
  gen_random_uuid(), auth.uid()
  base-repo migration folder convention (supabase/migrations/)

Custom:
  4-table schema (organizations, profiles, contracts, contract_files)
  set_updated_at() trigger
  default organization seed + default_organization_id()
  handle_new_user() trigger + profile backfill
  indexes for the contracts list / search / expiry filters

W1-WEB-009  RLS

Reuse:
  Supabase RLS primitives (ENABLE ROW LEVEL SECURITY, CREATE POLICY)

Custom:
  organization-based policies for all 4 tables
  current_organization_id() helper
  column-level grant limiting profiles UPDATE to full_name
  explicit grants (anon gets nothing)
```

## 1. Did the base repo already have `profiles`?

**No.** The base repository ships no `supabase/` directory at all, and a
repository-wide search for `profiles`, `handle_new_user` and `set_updated_at`
returns nothing outside `node_modules`. Everything here is created from
scratch — nothing was extended, nothing pre-existed.

## 2. Migration files

All in `supabase/migrations/`, applied in filename order.

| # | File | Contents |
| --- | --- | --- |
| 1 | `20261003090000_init_updated_at_helper.sql` | `set_updated_at()` — BEFORE UPDATE trigger function |
| 2 | `20261003090100_create_organizations.sql` | `organizations` table, `set_organizations_updated_at` trigger, `default_organization_id()`, seed of the default **"HR Partner"** organization |
| 3 | `20261003090200_create_profiles.sql` | `profiles` table, `set_profiles_updated_at` trigger, `current_organization_id()`, `handle_new_user()` + `on_auth_user_created` trigger, **backfill** of pre-existing auth users |
| 4 | `20261003090300_create_contracts.sql` | `contracts` table, `set_contracts_updated_at` trigger, 4 indexes |
| 5 | `20261003090400_create_contract_files.sql` | `contract_files` table, 2 indexes |
| 6 | `20261003090500_enable_rls_policies.sql` | RLS enable + privileges + 11 policies |

Every statement is idempotent (`create table if not exists`,
`create or replace`, `drop trigger/policy if exists`), so re-running is safe.

Key details:

- **Default organization uses a fixed id** `11111111-1111-1111-1111-111111111111`.
  `handle_new_user()` and the backfill both call `default_organization_id()`, so
  they always agree. The name is a label and can be changed; changing the id
  would require editing that one function.
- **`signed_date` / `expiry_date` are `date`**, not `timestamptz` (plan sections
  19 and 31). Asserted in the verification run.
- **`created_by` defaults to `auth.uid()`** on `contracts` and `contract_files`.
- **`updated_at` trigger** is attached to the three tables that have the column.
  `contract_files` has none, per plan section 34.

## 3. Policies per table

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `organizations` | `id = current_organization_id()` | ✗ no policy → denied | ✗ no policy → denied | ✗ no policy → denied |
| `profiles` | `id = auth.uid()` | ✗ no policy → denied | `id = auth.uid()` (using + with check) | ✗ no policy → denied |
| `contracts` | `organization_id = current_organization_id()` | `with check (organization_id = …)` | `using + with check (organization_id = …)` | `using (organization_id = …)` |
| `contract_files` | `organization_id = current_organization_id()` | `with check (organization_id = …)` | `using + with check (organization_id = …)` | `using (organization_id = …)` |

All policies are `to authenticated`. `UPDATE` policies carry both `USING` and
`WITH CHECK`, so a row cannot be moved into another organization.

Privileges are set explicitly rather than relying on Supabase defaults:

```text
anon            : nothing at all (no public data in Wave 1)
authenticated   : SELECT organizations
                  SELECT profiles, UPDATE (full_name) profiles
                  SELECT/INSERT/UPDATE/DELETE contracts, contract_files
service_role    : ALL on the four tables (BYPASSRLS)
```

### Why `UPDATE (full_name)` and not plain `UPDATE` on profiles

Row-level security filters **rows, not columns**. With a plain `UPDATE` grant, a
signed-in user could run:

```sql
update profiles set role = 'admin' where id = auth.uid();
```

and promote themselves, because the row passes `id = auth.uid()`. Restricting
the grant to the `full_name` column closes that path while keeping the
"user edits their own profile" behaviour from plan section 71. Both escalation
attempts (`role`, `organization_id`) are covered by tests and are denied.

## 4. Cross-organization RLS test results

The migration files were applied to a real PostgreSQL engine (PGlite —
PostgreSQL compiled to WebAssembly) with Supabase-shaped scaffolding
(`auth.users`, `auth.uid()`, roles `anon` / `authenticated` / `service_role`),
then two users in two organizations were exercised.

```text
== Applying migrations ==
  PASS  all migrations apply cleanly — 6 file(s)

== Schema / trigger / backfill ==
  PASS  default organization seeded — HR Partner (11111111…)
  PASS  BACKFILL: pre-existing auth user got a profile
  PASS  BACKFILL: profile points at the default organization
  PASS  BACKFILL: role defaults to 'user'
  PASS  TRIGGER: new auth user auto-creates a profile
  PASS  TRIGGER: assigns the default organization
  PASS  TRIGGER: copies full_name from user metadata
  PASS  signed_date is DATE (not timestamptz) — date
  PASS  expiry_date is DATE (not timestamptz) — date
  PASS  archived_at is timestamptz
  PASS  all 6 requested indexes exist

== RLS: contracts ==
  PASS  org A user SELECTs only org A contracts — A-001
  PASS  org B user SELECTs only org B contracts — B-001
  PASS  org A user UPDATE of an org B contract touches 0 rows
  PASS  org A user DELETE of an org B contract touches 0 rows
  PASS  org A user INSERT into org B is rejected — denied
  PASS  org A user INSERT into own org succeeds
  PASS  created_by defaults to auth.uid()

== RLS: contract_files ==
  PASS  org A user SELECTs only org A files
  PASS  org B user SELECTs only org B files
  PASS  org A user UPDATE of an org B file touches 0 rows
  PASS  org A user INSERT of an org B file is rejected

== RLS: profiles ==
  PASS  user sees only their own profile row
  PASS  user can update their own full_name
  PASS  user CANNOT escalate their own role via UPDATE
  PASS  user CANNOT move themselves to another organization
  PASS  user CANNOT update another user's profile

== RLS: organizations ==
  PASS  org A user sees only org A
  PASS  user CANNOT insert an organization
  PASS  user CANNOT update an organization
  PASS  user CANNOT delete an organization

== anon / service_role ==
  PASS  anon cannot read contracts — denied at privilege level
  PASS  service_role bypasses RLS (sees both organizations)

== Integrity ==
  PASS  deleting a contract cascades to its files

================ 35 passed, 0 failed ================
```

The harness lives outside the repository (a temporary directory) so no test
dependency or test data was added to the project.

## 5. Command used to apply the migrations

The migrations **were applied to the live Supabase project** with the official
Supabase CLI (2.119.0):

```bash
pnpm dlx supabase@latest db push \
  --db-url "postgresql://postgres.<ref>:<percent-encoded-password>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres" \
  --yes
```

Result:

```text
Connecting to remote database...
Applying migration 20261003090000_init_updated_at_helper.sql...
Applying migration 20261003090100_create_organizations.sql...
Applying migration 20261003090200_create_profiles.sql...
Applying migration 20261003090300_create_contracts.sql...
Applying migration 20261003090400_create_contract_files.sql...
Applying migration 20261003090500_enable_rls_policies.sql...
Finished supabase db push.        (exit 0)
```

All six rows are recorded in `supabase_migrations.schema_migrations`, so future
`db push` runs will not re-apply them.

### Connection note (important for future migrations)

`db.<ref>.supabase.co` resolves to an **IPv6 (AAAA) address only**. This
workstation has no global IPv6 address, so the direct connection is unreachable
and the **IPv4 connection pooler** must be used instead:

```text
project region : ap-northeast-2 (Seoul)
pooler host    : aws-0-ap-northeast-2.pooler.supabase.com:5432   (session mode)
database user  : postgres.<project-ref>
Supabase Postgres version: 17.11
```

The pooler is reached over IPv4 and accepts DDL, so it is suitable for
`supabase db push`. The password must be percent-encoded in `--db-url`.

## 6. Deviations from the plan / the M2 brief

| # | Deviation | Reason |
| --- | --- | --- |
| 1 | `created_at` / `updated_at` declared `NOT NULL DEFAULT now()` | The brief said only `default now()`. `NOT NULL` is standard and the trigger always supplies `updated_at`; without it a client could insert an explicit `NULL`. |
| 2 | `profiles_role_check CHECK (role in ('admin','user'))` | The brief listed the allowed values in prose only. Enforced in the schema so a typo cannot create an unknown role. |
| 3 | `created_by` FK is `ON DELETE SET NULL` | The brief said only "FK -> auth.users(id)". The Postgres default (NO ACTION) would make deleting an auth user fail whenever they had created a contract. Contract records must outlive the user. |
| 4 | `profiles` UPDATE is limited to the `full_name` column | See the security note above. The brief's "UPDATE only where id = auth.uid()" alone allows self-promotion to admin. |
| 5 | Added `current_organization_id()` helper function | The brief described it as `(SELECT organization_id FROM profiles WHERE id = auth.uid())`. It is implemented as a `STABLE SECURITY DEFINER` function containing exactly that subquery, so policy evaluation never re-enters the `profiles` policies and the planner can fold it per statement. |
| 6 | Default organization uses a fixed UUID | Makes `handle_new_user()` and the backfill deterministic and independent of insertion order. |
| 7 | Plain btree indexes as specified | These do **not** accelerate the `ILIKE '%…%'` search of plan section 51. A `pg_trgm` GIN index is recommended when `W1-WEB-020` (Search) lands. |
| 8 | Explicit privileges in the RLS migration | Supabase's default privileges would grant everything to `authenticated`; the explicit `REVOKE`/`GRANT` set is what makes the `profiles` column restriction possible, and documents intent. |
| 9 | Migration timestamps use `20261003…` | System date of this environment. |

## Part 0 — owner decisions applied

### Public sign-up disabled

- Deleted `app/auth/sign-up/`, `app/auth/sign-up-success/`,
  `components/sign-up-form.tsx`.
- Removed the "Don't have an account? Sign up" block from `components/login-form.tsx`.
- No reference to `sign-up` / `signUp` / `SignUp` remains anywhere in the
  codebase; both routes return **404** at runtime.

### UI language = Vietnamese

Translated every user-facing string:

| Area | Vietnamese |
| --- | --- |
| Login | Đăng nhập, Email, Mật khẩu, Quên mật khẩu?, Đang đăng nhập… |
| Forgot password | Đặt lại mật khẩu, Gửi email đặt lại mật khẩu, Kiểm tra email của bạn |
| Update password | Mật khẩu mới, Lưu mật khẩu mới |
| Auth error page | Đã xảy ra lỗi., Mã lỗi: |
| Sidebar | Quản lý hợp đồng, Tổng quan, Hợp đồng, Cài đặt, Tài khoản, Đăng xuất |
| Theme switcher | Sáng / Tối / Hệ thống |
| Pages | Tổng quan / Hợp đồng / Cài đặt headings, Hồ sơ cá nhân, Tổ chức, Đang tải… |
| Screen-reader labels | Đóng, Thanh điều hướng, Ẩn/hiện thanh điều hướng |

Route paths are unchanged (`/dashboard`, `/contracts`, `/settings`) — only the
labels are Vietnamese.

**Boilerplate bug fixed while translating:** `components/update-password-form.tsx`
pushed to `/protected`, a route that has never existed. It now goes to
`/dashboard`.

## 5b. Verification against the live project

Run after `db push`, directly against the Supabase database. The cross-org test
creates its fixtures **inside a transaction that is rolled back**, so the
production database ends with exactly the rows it started with.

```text
== Structure on the live project ==
  PASS  4 tables exist — contract_files, contracts, organizations, profiles
  PASS  RLS enabled on contract_files / contracts / organizations / profiles
  PASS  11 policies created — total=11
  PASS  signed_date is date, expiry_date is date
  PASS  all 6 requested indexes exist
  PASS  4 helper functions exist
  PASS  public triggers attached (3 updated_at)
  PASS  on_auth_user_created trigger on auth.users

== M1 account backfill ==
  PASS  m1.test@hrpartner.vn has a profile row
  PASS  its organization_id is the seeded default org — 11111111-1111-…
  PASS  that organization exists and is named — HR Partner
  PASS  role defaults to 'user'
  PASS  is_active is true
  PASS  no auth user is left without a profile — orphans=0

== Cross-org RLS (live, rolled back) ==
  PASS  org A user sees only org A contracts — A-VERIFY
  PASS  org B user sees only org B contracts — B-VERIFY
  PASS  org B user UPDATE of an org A contract touches 0 rows
  PASS  org B user DELETE of an org A contract touches 0 rows
  PASS  org B user INSERT into org A is rejected
  PASS  user CANNOT escalate own role to admin
  PASS  org B user sees only its own organization
  PASS  user CANNOT insert an organization

== No residue after rollback ==
  PASS  organizations count unchanged — orgs=1
  PASS  auth.users count unchanged — users=1
  PASS  contracts count unchanged (still empty) — contracts=0
  PASS  all 6 migrations recorded in history

================ 30 passed, 0 failed ================
```

And through **PostgREST with a real signed-in session** — the path the
application itself uses from M3 onward:

```text
  PASS  password sign-in via GoTrue — status=200
  PASS  GET /rest/v1/profiles returns 200
  PASS  RLS: exactly one profile row (own) — 1 row(s)
  PASS  row is the signed-in user's own
  PASS  row carries a valid organization_id — 11111111-1111-…
  PASS  GET /rest/v1/organizations returns 200
  PASS  RLS: only the user's own organization is visible — HR Partner
  PASS  GET /rest/v1/contracts returns 200
  PASS  contracts currently empty — 0 row(s)
  PASS  POST /rest/v1/organizations is refused — status=403

================ 10 passed, 0 failed ================
```

## Verification summary

```text
Migrations + RLS (PGlite, local)     35 passed, 0 failed
Vietnamese UI + sign-up removed      29 passed, 0 failed
Live Supabase structure + RLS        30 passed, 0 failed
Live PostgREST RLS with session      10 passed, 0 failed
pnpm typecheck                       PASS (exit 0)
pnpm lint                            PASS (exit 0)
pnpm build                           PASS (exit 0) — 12 routes, sign-up gone
```

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| 4 tables + RLS created via migrations, applied successfully | ✅ applied to the live Supabase project (`db push`, exit 0) |
| `profiles` linked to `auth.users`, trigger creates profile + assigns org | ✅ verified locally and live |
| Dates stored as `DATE` (YYYY-MM-DD) | ✅ verified locally and live |
| RLS cross-org isolation (2 users, 2 orgs) | ✅ 11 local + 8 live cross-org assertions, plus 10 over PostgREST |
| `m1.test@hrpartner.vn` has a profile with a valid `organization_id` | ✅ confirmed live: org `11111111-…` ("HR Partner"), role `user`, `is_active` true |
| typecheck / lint / build still pass | ✅ |

## Follow-ups

- Grant `admin` to the first real administrator — the trigger assigns `user` to
  everyone, so an admin must be promoted deliberately (dashboard or Admin API).
- Consider `pg_trgm` GIN indexes for search at `W1-WEB-020`.
- `profiles.is_active` is not yet consulted by `requireUser()`; Wave 1 should
  decide whether deactivated users are blocked at login.
