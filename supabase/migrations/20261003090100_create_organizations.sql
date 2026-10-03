-- W1-WEB-005 — organizations (plan section 29)
--
-- Wave 1 runs with a single organization, but the table is already modelled
-- 1..N so Wave 2 does not need a schema migration.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant boundary. Every profile, contract and contract_file belongs to one organization.';

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Default organization for Wave 1.
--
-- A fixed id is used (rather than "the oldest row") so handle_new_user() and
-- the profile backfill resolve the same organization deterministically. The
-- name is only a label and can be changed at any time; changing the id would
-- require updating this function.
-- ---------------------------------------------------------------------------

create or replace function public.default_organization_id()
returns uuid
language sql
immutable
as $$
  select '11111111-1111-1111-1111-111111111111'::uuid;
$$;

comment on function public.default_organization_id() is
  'Organization assigned to newly provisioned users (Wave 1 single-tenant seed).';

insert into public.organizations (id, name)
values (public.default_organization_id(), 'HR Partner')
on conflict (id) do nothing;
