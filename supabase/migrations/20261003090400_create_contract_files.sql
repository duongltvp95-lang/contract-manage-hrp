-- W1-WEB-008 — contract_files (plan section 34)
--
-- One contract -> 1..N files (main contract, appendix, extra scans). Files live
-- in the private Cloudflare R2 bucket; this table only stores the pointer plus
-- the metadata Wave 2 needs to presign a GET (plan sections 36-37, 99).

create table if not exists public.contract_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  storage_provider text not null default 'r2',
  bucket text not null,
  object_key text not null,
  original_filename text not null,
  mime_type text not null,
  file_size bigint,
  checksum text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.contract_files is
  'Pointer to a private R2 object. No public URL is ever stored (plan sections 36, 61).';

create index if not exists contract_files_contract_id_idx on public.contract_files (contract_id);
create index if not exists contract_files_organization_id_idx on public.contract_files (organization_id);
