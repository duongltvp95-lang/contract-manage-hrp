-- W1-WEB-005..009 foundation: shared trigger helper.
--
-- Keeps `updated_at` in sync on every UPDATE. Applied to organizations,
-- profiles and contracts (plan sections 29, 30, 31). contract_files has no
-- updated_at column (plan section 34).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at with now().';
