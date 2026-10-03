-- W1-WEB-020 — trigram indexes for the contract search (plan section 50, 51).
--
-- The btree indexes added in M2 cannot serve `ILIKE '%...%'`: a leading wildcard
-- makes them unusable, so PostgreSQL would fall back to a sequential scan. A GIN
-- index with `gin_trgm_ops` is the index type that actually answers substring
-- matching.
--
-- Supabase keeps extensions in the `extensions` schema, which is part of the
-- default search_path, so `gin_trgm_ops` resolves unqualified.

create extension if not exists pg_trgm with schema extensions;

-- contract_number is searchable (plan section 50).
create index if not exists contracts_contract_number_trgm_idx
  on public.contracts using gin (contract_number gin_trgm_ops);

-- partner_text is the other searchable column (plan section 50).
create index if not exists contracts_partner_text_trgm_idx
  on public.contracts using gin (partner_text gin_trgm_ops);

-- NOTE: the M2 btree indexes `contracts_contract_number_idx` and
-- `contracts_partner_text_idx` are kept. They still serve exact matches and
-- ordering on contract_number. The btree on partner_text is now largely
-- redundant and can be dropped once the search query is confirmed stable.
