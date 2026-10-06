-- Round 6 — quick partner search for the contract form combobox.
--
-- The combobox previously loaded the whole directory into every contract
-- form; with a large partner list that gets slow. The form now searches the
-- database directly, folding diacritics the same way the client-side filter
-- does (lib/partner-display.ts): lowercase, no accents, `đ` treated as `d` —
-- so typing "doi tac" still finds "Đối tác".
--
-- The function is SECURITY INVOKER on purpose: it runs with the caller's
-- role, so the RLS policies on `partners` keep every result inside the
-- caller's organization. It deliberately takes no organization id from the
-- caller — the session (auth.uid()) is the only source of the tenant.

create extension if not exists unaccent;

create or replace function public.search_partners(term text, lim int default 50)
returns setof public.partners
language sql
security invoker
set search_path = public, extensions
as $$
  select *
  from public.partners
  where (
      lower(replace(unaccent(coalesce(name, '')), 'đ', 'd'))
        like '%' || lower(replace(unaccent(coalesce(term, '')), 'đ', 'd')) || '%'
      or coalesce(tax_code, '') ilike '%' || coalesce(term, '') || '%'
    )
  order by name asc
  limit lim;
$$;

revoke all on function public.search_partners(text, int) from public;

grant execute on function public.search_partners(text, int) to authenticated;

comment on function public.search_partners(text, int) is
  'Round 6 — search the caller organization partners by name (diacritics-folded) or tax code. Security invoker: RLS limits results to the caller organization.';
