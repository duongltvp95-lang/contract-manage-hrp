-- Round 10, part 1 — partner collaboration status + companies (HRP / HR VN).
--
-- 1. `partners.status` marks whether the organisation is still collaborating
--    with the partner (`active` = đang hợp tác, `stopped` = đã dừng hợp tác).
-- 2. `companies` holds the company entities (seeded with HRP + HR VN for the
--    default organisation) and `partner_companies` links a partner to one or
--    both (many-to-many, at least one required at the service layer).
-- 3. The audit-log action enum gains `set_partner_status`.

-- ---------------------------------------------------------------------------
-- 1. partners.status
-- ---------------------------------------------------------------------------

alter table public.partners
  add column if not exists status text not null default 'active';

alter table public.partners
  drop constraint if exists partners_status_check;

alter table public.partners
  add constraint partners_status_check check (status in ('active', 'stopped'));

comment on column public.partners.status is
  '''active'' = đang hợp tác (mặc định), ''stopped'' = đã dừng hợp tác. A stopped partner stays in the directory and on its contracts but is hidden from the new-contract combobox.';

-- ---------------------------------------------------------------------------
-- 2. companies
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_length_check check (char_length(btrim(name)) between 1 and 100),
  constraint companies_org_name_unique unique (organization_id, name)
);

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create index if not exists companies_organization_id_idx on public.companies (organization_id);

comment on table public.companies is
  'Company entities an organization works with (seeded HRP / HR VN). Read-only for the app: partners link to them through partner_companies.';

-- ---------------------------------------------------------------------------
-- 3. partner_companies (many-to-many junction)
-- ---------------------------------------------------------------------------

create table if not exists public.partner_companies (
  partner_id uuid not null references public.partners (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  primary key (partner_id, company_id)
);

create index if not exists partner_companies_company_id_idx
  on public.partner_companies (company_id);

comment on table public.partner_companies is
  'Many-to-many link between a partner and the companies (HRP / HR VN) it works with. A partner must have at least one link (enforced at the service layer).';

-- ---------------------------------------------------------------------------
-- 4. Seed HRP + HR VN for the default organization
-- ---------------------------------------------------------------------------

insert into public.companies (id, organization_id, name)
values
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'HRP'),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'HR VN')
on conflict (organization_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- 5. RLS + privileges
-- ---------------------------------------------------------------------------

-- companies: read-only for the app (seeded, not user-created). No DELETE grant
-- or policy, mirroring the partners hardening.
alter table public.companies enable row level security;

revoke all on public.companies from anon, authenticated;
grant select on public.companies to authenticated;
grant all on public.companies to service_role;

drop policy if exists companies_select_own_org on public.companies;
create policy companies_select_own_org
  on public.companies
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

-- partner_companies: the junction inherits its organization from the partner
-- (and company) it references. Replace = delete + insert, so no UPDATE policy.
alter table public.partner_companies enable row level security;

revoke all on public.partner_companies from anon, authenticated;
grant select, insert, delete on public.partner_companies to authenticated;
grant all on public.partner_companies to service_role;

drop policy if exists partner_companies_select_own_org on public.partner_companies;
create policy partner_companies_select_own_org
  on public.partner_companies
  for select
  to authenticated
  using (
    exists (
      select 1 from public.partners p
      where p.id = partner_companies.partner_id
        and p.organization_id = public.current_organization_id()
    )
  );

drop policy if exists partner_companies_insert_own_org on public.partner_companies;
create policy partner_companies_insert_own_org
  on public.partner_companies
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.partners p
      where p.id = partner_companies.partner_id
        and p.organization_id = public.current_organization_id()
    )
    and exists (
      select 1 from public.companies c
      where c.id = partner_companies.company_id
        and c.organization_id = public.current_organization_id()
    )
  );

drop policy if exists partner_companies_delete_own_org on public.partner_companies;
create policy partner_companies_delete_own_org
  on public.partner_companies
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.partners p
      where p.id = partner_companies.partner_id
        and p.organization_id = public.current_organization_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. audit-log action enum — add set_partner_status
-- ---------------------------------------------------------------------------

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check check (
    action in (
      'create_user',
      'update_user_role',
      'set_active_user',
      'delete_user',
      'export_logs',
      'create_partner',
      'update_partner',
      'import_partners',
      'create_contract',
      'update_contract',
      'archive_contract',
      'upload_file',
      'update_profile',
      'set_partner_status'
    )
  );

-- ---------------------------------------------------------------------------
-- 7. quick search: only "đang hợp tác" partners (round 6 RPC, re-defined here
--    rather than editing the round 6 migration file)
-- ---------------------------------------------------------------------------

create or replace function public.search_partners(term text, lim int default 50)
returns setof public.partners
language sql
security invoker
set search_path = public, extensions
as $$
  select *
  from public.partners
  where status = 'active'
    and (
      lower(replace(unaccent(coalesce(name, '')), 'đ', 'd'))
        like '%' || lower(replace(unaccent(coalesce(term, '')), 'đ', 'd')) || '%'
      or coalesce(tax_code, '') ilike '%' || coalesce(term, '') || '%'
    )
  order by name asc
  limit lim;
$$;

comment on function public.search_partners(text, int) is
  'Round 10 — search the caller organization ACTIVE partners by name (diacritics-folded) or tax code. Stopped partners are hidden from the new-contract combobox. Security invoker: RLS limits results to the caller organization.';
