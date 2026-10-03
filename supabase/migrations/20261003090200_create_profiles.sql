-- W1-WEB-006 — profiles (plan section 30)
--
-- One row per auth.users row. The base repository ships no profiles table, so
-- this is created from scratch (not extended).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id),
  full_name text,
  role text not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('admin', 'user'))
);

comment on table public.profiles is
  'Application user. Auto-created for every auth.users row by on_auth_user_created.';
comment on column public.profiles.role is
  'Wave 1 roles: admin | user (plan section 30).';

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Current user's organization — the helper every RLS policy is built on
-- (plan section 72). SECURITY DEFINER so evaluating a policy on another table
-- never re-enters the profiles policies.
-- ---------------------------------------------------------------------------

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

comment on function public.current_organization_id() is
  'organization_id of the signed-in user; NULL when unauthenticated.';

-- ---------------------------------------------------------------------------
-- Auto-provision a profile for every new auth user (plan section 30).
-- ---------------------------------------------------------------------------

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

comment on function public.handle_new_user() is
  'AFTER INSERT on auth.users: creates the matching profile in the default organization.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- BACKFILL — users created before this migration.
--
-- The M1 verification account (m1.test@hrpartner.vn) already existed before the
-- trigger did, so relying on on_auth_user_created alone would leave it without a
-- profile and therefore without access to anything.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, organization_id, full_name, role, is_active)
select
  u.id,
  public.default_organization_id(),
  nullif(u.raw_user_meta_data ->> 'full_name', ''),
  'user',
  true
from auth.users u
on conflict (id) do nothing;
