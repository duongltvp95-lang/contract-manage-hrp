-- Migration: Tối ưu đếm số liệu Dashboard (1 query thay vì 4 query song song)
create or replace function public.get_dashboard_metrics(org_id uuid, today_date date default current_date)
returns json
language sql
security invoker
set search_path = public
as $$
  select json_build_object(
    'total', count(*) filter (where archived_at is null),
    'expiringSoon', count(*) filter (where archived_at is null and expiry_date >= today_date and expiry_date <= today_date + 90),
    'expired', count(*) filter (where archived_at is null and expiry_date < today_date),
    'archived', count(*) filter (where archived_at is not null)
  )
  from public.contracts
  where organization_id = org_id;
$$;
