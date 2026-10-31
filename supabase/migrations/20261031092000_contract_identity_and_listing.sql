-- Never silently delete existing duplicates to make this migration pass.
-- Operators can inspect duplicates with the preflight query in the runbook.
create unique index contracts_active_identity_unique
  on public.contracts (organization_id, lower(btrim(contract_number)), signed_date, expiry_date)
  nulls not distinct
  where archived_at is null and nullif(btrim(contract_number), '') is not null;

-- RLS of every underlying table is evaluated as the requesting user.
create view public.contract_listing with (security_invoker = true) as
select c.*, p.name as partner_name, company.name as company_name,
  exists (
    select 1 from public.contract_files f
    where f.contract_id = c.id and f.organization_id = c.organization_id
  ) as has_files,
  (
    select count(*) from public.contract_files f
    where f.contract_id = c.id and f.organization_id = c.organization_id
  ) as file_count
from public.contracts c
left join public.partners p on p.id = c.partner_id and p.organization_id = c.organization_id
left join public.companies company on company.id = c.company_id and company.organization_id = c.organization_id;
revoke all on public.contract_listing from public, anon, authenticated;
grant select on public.contract_listing to authenticated, service_role;
