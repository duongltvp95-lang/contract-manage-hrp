-- Feature round 2, part 1 — partners (owner decision, post-Wave 1).
--
-- The Wave 1 plan (§32) deliberately shipped without a partners table:
-- `contracts.partner_text` held the name as free text, to ship faster and avoid
-- over-modelling the business. That decision is now superseded for a real
-- reason — the list cannot filter or group by a partner, and the same company
-- gets typed three different ways.
--
-- `partner_text` is deliberately KEPT. It is the fallback display value for the
-- contracts that already exist and were never linked to a partner row, and the
-- column stays the free-text field the form writes when nobody picks a partner.
-- A contract can therefore have a `partner_id`, a `partner_text`, or both; the
-- UI prefers the linked name and falls back to the text.
--
-- The write-path rules follow the M8 hardening exactly:
--   * organization_id always comes from the session, never the client;
--   * `authenticated` gets SELECT / INSERT / UPDATE and nothing else;
--   * there is NO DELETE grant and NO DELETE policy, and none may ever be added
--     — a partner is referenced by contracts, and removing it would either
--     orphan or block them. `service_role` keeps full rights for admin tooling.

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Mirrors the Zod rule (1-200 after trimming) at the layer that cannot be
  -- bypassed. A name of spaces is not a name.
  constraint partners_name_length_check
    check (char_length(btrim(name)) between 1 and 200)
);

comment on table public.partners is
  'Organization-scoped partner directory (feature round 2). Referenced by contracts.partner_id; never deleted through the client — see the grants below.';
comment on column public.partners.name is
  'Display name, 1-200 characters after trimming. Not unique: two organizations may use the same name, and a duplicate inside one organization is a data-entry problem, not an integrity error.';

drop trigger if exists set_partners_updated_at on public.partners;
create trigger set_partners_updated_at
  before update on public.partners
  for each row execute function public.set_updated_at();

create index if not exists partners_organization_id_idx on public.partners (organization_id);
create index if not exists partners_name_idx on public.partners (name);

-- ---------------------------------------------------------------------------
-- contracts.partner_id — nullable, and restrictive on delete
--
-- Nullable because every Wave 1 contract predates this table, and because a
-- contract may still be entered with free text only. RESTRICT (not CASCADE,
-- not SET NULL) because deleting a partner that contracts point at must be an
-- explicit decision made with those contracts in view — silently NULLing the
-- link would destroy the association, and cascading would destroy the
-- contracts.
-- ---------------------------------------------------------------------------

alter table public.contracts
  add column if not exists partner_id uuid references public.partners (id) on delete restrict;

create index if not exists contracts_partner_id_idx on public.contracts (partner_id);

comment on column public.contracts.partner_id is
  'Optional link to the partner directory. partner_text remains the free-text fallback and is what the UI shows when this is null.';

-- ---------------------------------------------------------------------------
-- RLS + privileges — the hardened pattern
-- ---------------------------------------------------------------------------

alter table public.partners enable row level security;

-- Explicit: revoke everything first, then grant the three verbs the product
-- actually offers. DELETE is absent on purpose and must stay absent.
revoke all on public.partners from anon, authenticated;
grant select, insert, update on public.partners to authenticated;
grant all on public.partners to service_role;

drop policy if exists partners_select_own_org on public.partners;
create policy partners_select_own_org
  on public.partners
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists partners_insert_own_org on public.partners;
create policy partners_insert_own_org
  on public.partners
  for insert
  to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists partners_update_own_org on public.partners;
create policy partners_update_own_org
  on public.partners
  for update
  to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- No DELETE policy is created, and none may be: without a policy RLS denies
-- DELETE outright, and the grant is gone as well, so the capability is closed
-- twice over — the same belt-and-braces the hardening migration applied to
-- contracts and contract_files.
