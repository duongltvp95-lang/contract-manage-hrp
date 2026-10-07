-- Round 13, part 1 — profile background color (UI background theme).
--
-- `profiles.background_color` stores the background preset key a user chose in
-- Settings (NULL = default). It is applied server-side as `data-background` on
-- <html>, so a refresh is all that is needed to re-theme — no client flash.

alter table public.profiles
  add column if not exists background_color text;

alter table public.profiles
  drop constraint if exists profiles_background_color_check;

alter table public.profiles
  add constraint profiles_background_color_check check (
    background_color is null or background_color in ('default', 'gray', 'blue', 'green', 'cream', 'pink')
  );

comment on column public.profiles.background_color is
  'The UI background preset key (default/gray/blue/green/cream/pink). NULL = default. Applied server-side as data-background on <html>.';

-- Extend the column-level UPDATE grant so a user can change their own
-- background without touching role / organization_id (still outside the grant).
grant update (background_color) on public.profiles to authenticated;
