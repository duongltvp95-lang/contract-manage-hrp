-- Feature round 2, part 3 — partner address + tax code.
--
-- Owner decision: address and tax code are OPTIONAL. Existing partners (created
-- in round 2 part 1) stay usable; new partners can be created with these
-- fields filled in or left blank. That is the same posture the form takes
-- (optional inputs, no required field added).
--
-- Tax code is stored as text, not a number: VN tax codes are exactly 10 digits
-- but branches append `-001` (so the longest legitimate value is 14 chars), and
-- non-VN partners may carry their own format. The form enforces the VN shape
-- when a value is entered; the column itself does not.
--
-- Tax code is NOT unique, at any scope. The form checks for duplicates inside
-- the caller's organization and returns a readable error; the database does not
-- lock the column, so historical imports of partners that share a code (or a
-- legacy branch duplicate) are not blocked at migration time.
--
-- The hardening pattern (M8) is kept: organization_id always from session, no
-- DELETE grant, no DELETE policy. RLS policies that exist already cover the
-- two new columns automatically because they are based on `organization_id`,
-- not on a column list.

alter table public.partners
  add column if not exists address text,
  add column if not exists tax_code text;

-- Mirrors the Zod rules at the layer that cannot be bypassed. 500 is a
-- comfortable ceiling for a free-form Vietnamese address; larger values almost
-- always mean the wrong field was used.
alter table public.partners
  drop constraint if exists partners_address_length_check;
alter table public.partners
  add constraint partners_address_length_check
  check (address is null or char_length(address) between 1 and 500);

-- 14 = 10 digits + "-" + 3 branch digits. Anything longer is a copy-paste
-- accident or a non-VN code the form should have rejected first.
alter table public.partners
  drop constraint if exists partners_tax_code_length_check;
alter table public.partners
  add constraint partners_tax_code_length_check
  check (tax_code is null or char_length(tax_code) between 1 and 14);

-- Trigram index on tax_code so a duplicate check inside one organization
-- stays cheap. Mirrors the partner_name_trgm index added in
-- 20261003100000_add_pg_trgm_search_indexes.sql.
create index if not exists partners_tax_code_trgm_idx
  on public.partners using gin (tax_code gin_trgm_ops);

comment on column public.partners.address is
  'Free-form postal address. Optional; up to 500 characters. Not normalised — the form stores exactly what the user typed.';
comment on column public.partners.tax_code is
  'Tax / registration code. Optional; up to 14 characters. The form enforces the VN shape (10 digits, optional -NNN branch suffix) when a value is entered. Not unique.';

-- RLS already covers the new columns — partners_select_own_org,
-- partners_insert_own_org, and partners_update_own_org all use
-- `organization_id = public.current_organization_id()` and apply to every
-- column, not a whitelist. No new policy is needed and none is added.
