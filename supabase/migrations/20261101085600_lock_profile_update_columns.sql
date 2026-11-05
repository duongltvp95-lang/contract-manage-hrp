-- An existing table-wide UPDATE grant overrides column-only GRANTs.
revoke update on public.profiles from public,anon,authenticated;
do $$
declare v_column record;
begin
 for v_column in select attname from pg_attribute
  where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
 loop
  execute format('revoke update (%I) on public.profiles from public,anon,authenticated',v_column.attname);
 end loop;
end;
$$;
grant update(full_name,accent_color,background_color,sidebar_color) on public.profiles to authenticated;
