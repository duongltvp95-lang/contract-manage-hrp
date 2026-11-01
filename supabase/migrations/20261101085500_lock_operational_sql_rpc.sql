-- Supabase default privileges can grant functions directly to API roles.
-- Revoking PUBLIC alone does not remove those explicit grants.
create or replace function public.exec_sql(sql text)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'Operational SQL requires server credentials' using errcode='42501';
 end if;
 execute sql;
end;
$$;
revoke all on function public.exec_sql(text) from public,anon,authenticated;
grant execute on function public.exec_sql(text) to service_role;
