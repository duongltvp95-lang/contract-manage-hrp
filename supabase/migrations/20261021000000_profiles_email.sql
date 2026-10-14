-- Migration: Add email column to profiles and sync automatically from auth.users (Giai đoạn 2)
-- Tối ưu hóa truy vấn người dùng, loại bỏ N+1 calls vào Auth Admin API

alter table public.profiles
  add column if not exists email text;

-- Backfill email từ auth.users cho tất cả các profile hiện tại
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and (p.email is null or p.email = '');

-- Cập nhật trigger handle_new_user() để tự động lưu email khi có người dùng mới
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, organization_id, email, full_name, role, is_active)
  values (
    new.id,
    public.default_organization_id(),
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    'user',
    true
  )
  on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email);

  return new;
end;
$$;

comment on column public.profiles.email is
  'Email của người dùng đồng bộ từ auth.users. Giúp truy vấn danh sách người dùng nhanh chóng mà không cần gọi Admin API.';
