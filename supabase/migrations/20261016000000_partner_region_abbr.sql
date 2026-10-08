-- Round 21, part 1 — optional partner fields: region + abbreviation.
--
-- Both are free text, nullable. The length ceilings mirror the Zod rules the
-- form enforces (region <= 100, abbreviation <= 50); the service trims before
-- writing, so a value of only spaces is stored as NULL, never as " ".

alter table public.partners
  add column if not exists region text,
  add column if not exists abbreviation text;

alter table public.partners
  drop constraint if exists partners_region_length_check;
alter table public.partners
  add constraint partners_region_length_check check (char_length(region) <= 100);

alter table public.partners
  drop constraint if exists partners_abbreviation_length_check;
alter table public.partners
  add constraint partners_abbreviation_length_check check (char_length(abbreviation) <= 50);

comment on column public.partners.region is
  'Khu vực (tự do, tuỳ chọn, tối đa 100 ký tự).';
comment on column public.partners.abbreviation is
  'Tên viết tắt (tự do, tuỳ chọn, tối đa 50 ký tự), khớp trong tìm kiếm nhanh.';

-- ---------------------------------------------------------------------------
-- search_partners — also match the abbreviation (diacritics-folded like name).
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
      or lower(replace(unaccent(coalesce(abbreviation, '')), 'đ', 'd'))
        like '%' || lower(replace(unaccent(coalesce(term, '')), 'đ', 'd')) || '%'
    )
  order by name asc
  limit lim;
$$;

comment on function public.search_partners(text, int) is
  'Round 21 — search the caller organization ACTIVE partners by name or abbreviation (diacritics-folded) or tax code. Stopped partners are hidden (round 10). Security invoker: RLS limits results to the caller organization.';
