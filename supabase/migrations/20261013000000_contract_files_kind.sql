-- Round 16, part 1 — contract_files.kind (main document vs PDF appendix).
--
-- Existing rows are all 'document' (the default), so no backfill is needed.

alter table public.contract_files
  add column if not exists kind text not null default 'document';

alter table public.contract_files
  drop constraint if exists contract_files_kind_check;

alter table public.contract_files
  add constraint contract_files_kind_check check (kind in ('document', 'appendix'));

comment on column public.contract_files.kind is
  'File kind: document = the main contract document (PDF/JPG/PNG), appendix = a PDF appendix. Existing rows default to document.';
