-- Round 14, part 1 — profile sidebar color (UI sidebar theme).
--
-- `profiles.sidebar_color` stores the sidebar preset key a user chose in the
-- palette (NULL = default). It is applied server-side as `data-sidebar` on
-- <html>, so a refresh re-themes without a client flash.

alter table public.profiles
  add column if not exists sidebar_color text;

alter table public.profiles
  drop constraint if exists profiles_sidebar_color_check;

alter table public.profiles
  add constraint profiles_sidebar_color_check check (
    sidebar_color is null or sidebar_color in ('default', 'gray', 'blue', 'navy', 'violet', 'cream')
  );

comment on column public.profiles.sidebar_color is
  'The UI sidebar preset key (default/gray/blue/navy/violet/cream). NULL = default. Applied server-side as data-sidebar on <html>.';

-- Extend the column-level UPDATE grant so a user can change their own sidebar
-- without touching role / organization_id (still outside the grant).
grant update (sidebar_color) on public.profiles to authenticated;
