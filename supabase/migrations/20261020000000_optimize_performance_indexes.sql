-- Migration: Giai đoạn 1 - Tối ưu CSDL & Hiệu năng Dashboard (P0)
-- Bổ sung partial indexes và composite indexes cho bảng contracts và partners

-- 1. Index cho contracts: tăng tốc đếm dashboard và lọc/sắp xếp hợp đồng đang hiệu lực
create index if not exists contracts_active_org_expiry_idx
  on public.contracts (organization_id, expiry_date)
  where archived_at is null;

create index if not exists contracts_active_org_created_idx
  on public.contracts (organization_id, created_at desc)
  where archived_at is null;

create index if not exists contracts_active_org_signed_idx
  on public.contracts (organization_id, signed_date desc)
  where archived_at is null;

-- 2. Index cho partners: tăng tốc lọc trạng thái (active/stopped) và mã số thuế
create index if not exists partners_org_status_idx
  on public.partners (organization_id, status);

create index if not exists partners_org_tax_code_idx
  on public.partners (organization_id, tax_code);
