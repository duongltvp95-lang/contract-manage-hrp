-- W1-WEB-009 — Row Level Security (plan sections 72 and 73)
--
-- Rule: a user only ever reaches rows belonging to their own organization,
-- taken from public.current_organization_id().
--
-- RLS does NOT protect Cloudflare R2 (plan section 73). Every presigned URL must
-- still be issued only after server-side authorization.
--
-- Wave 1 is single-tenant, so a second organization only exists in tests; the
-- policies are written 1..N anyway so Wave 2 needs no policy changes.

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_files enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges.
--
-- anon gets nothing: there is no public data in Wave 1.
-- profiles is deliberately column-scoped — see the note further down.
-- ---------------------------------------------------------------------------

revoke all on public.organizations from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.contracts from anon, authenticated;
revoke all on public.contract_files from anon, authenticated;

grant select on public.organizations to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select, insert, update, delete on public.contracts to authenticated;
grant select, insert, update, delete on public.contract_files to authenticated;

grant all on public.organizations to service_role;
grant all on public.profiles to service_role;
grant all on public.contracts to service_role;
grant all on public.contract_files to service_role;

-- ---------------------------------------------------------------------------
-- organizations — readable by its own members only.
--
-- No INSERT / UPDATE / DELETE policy is created, so RLS denies those outright:
-- Wave 1 manages organizations through migrations / admin tooling only.
-- ---------------------------------------------------------------------------

drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own
  on public.organizations
  for select
  to authenticated
  using (id = public.current_organization_id());

-- ---------------------------------------------------------------------------
-- profiles — a user sees and edits their own row only.
--
-- The policy alone would let a user set role = 'admin' on themselves, because
-- RLS filters rows, not columns. The column-level GRANT above restricts the
-- UPDATE to full_name, which closes that escalation path.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- contracts — full CRUD inside the user's own organization.
-- ---------------------------------------------------------------------------

drop policy if exists contracts_select_own_org on public.contracts;
create policy contracts_select_own_org
  on public.contracts
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists contracts_insert_own_org on public.contracts;
create policy contracts_insert_own_org
  on public.contracts
  for insert
  to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists contracts_update_own_org on public.contracts;
create policy contracts_update_own_org
  on public.contracts
  for update
  to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists contracts_delete_own_org on public.contracts;
create policy contracts_delete_own_org
  on public.contracts
  for delete
  to authenticated
  using (organization_id = public.current_organization_id());

-- ---------------------------------------------------------------------------
-- contract_files — same organization rule as contracts.
-- ---------------------------------------------------------------------------

drop policy if exists contract_files_select_own_org on public.contract_files;
create policy contract_files_select_own_org
  on public.contract_files
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists contract_files_insert_own_org on public.contract_files;
create policy contract_files_insert_own_org
  on public.contract_files
  for insert
  to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists contract_files_update_own_org on public.contract_files;
create policy contract_files_update_own_org
  on public.contract_files
  for update
  to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists contract_files_delete_own_org on public.contract_files;
create policy contract_files_delete_own_org
  on public.contract_files
  for delete
  to authenticated
  using (organization_id = public.current_organization_id());
