-- W1-WEB-007 — contracts (plan section 31)
--
-- signed_date / expiry_date are DATE (YYYY-MM-DD), never timestamptz
-- (plan sections 19 and 31). partner_text is a plain text column: Wave 1 has no
-- partners table on purpose (plan section 32).

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  contract_number text,
  signed_date date,
  duration_text text,
  expiry_date date,
  partner_text text,
  notes text,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contracts is
  'Wave 1 contract with manually entered metadata. archived_at replaces hard delete (plan section 66).';
comment on column public.contracts.duration_text is
  'Free text duration, e.g. "12 tháng" or "Không xác định thời hạn" (plan section 33).';

drop trigger if exists set_contracts_updated_at on public.contracts;
create trigger set_contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

-- Indexes requested for the contracts list, search and expiry filters
-- (plan sections 48-52).
create index if not exists contracts_organization_id_idx on public.contracts (organization_id);
create index if not exists contracts_expiry_date_idx on public.contracts (expiry_date);
create index if not exists contracts_partner_text_idx on public.contracts (partner_text);
create index if not exists contracts_contract_number_idx on public.contracts (contract_number);
