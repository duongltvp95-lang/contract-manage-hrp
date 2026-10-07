-- Round 12, part 1 — profile accent color (UI theme accent).
--
-- `profiles.accent_color` stores the accent preset key a user chose in Settings
-- (NULL = default). It is applied server-side as `data-accent` on <html>, so a
-- refresh is all that is needed to re-theme — no client flash.

alter table public.profiles
  add column if not exists accent_color text;

alter table public.profiles
  drop constraint if exists profiles_accent_color_check;

alter table public.profiles
  add constraint profiles_accent_color_check check (
    accent_color is null or accent_color in ('blue', 'green', 'rose', 'violet', 'orange', 'teal')
  );

comment on column public.profiles.accent_color is
  'The UI accent preset key (blue/green/rose/violet/orange/teal). NULL = default (blue). Applied server-side as data-accent on <html>.';

-- The column-level UPDATE grant currently allows only `full_name`; add
-- `accent_color` so a user can change their own accent without touching role /
-- organization_id (which remain outside the grant).
grant update (accent_color) on public.profiles to authenticated;
