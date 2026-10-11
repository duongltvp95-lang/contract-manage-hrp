-- Migration: DB aggregation for contract file counts
-- Giai đoạn 2: Tối ưu đếm số file hợp đồng trực tiếp tại Database bằng security-invoker RPC.

create or replace function public.count_contract_files(contract_ids uuid[])
returns table (
  contract_id uuid,
  file_count bigint
)
language sql
security invoker
set search_path = public, extensions
as $$
  select
    cf.contract_id,
    count(*)::bigint as file_count
  from public.contract_files cf
  where cf.contract_id = any(contract_ids)
  group by cf.contract_id;
$$;

comment on function public.count_contract_files(uuid[]) is
  'Giai đoạn 2 — Returns file count per contract aggregated directly in Postgres. Security invoker ensures caller organization RLS isolation.';
