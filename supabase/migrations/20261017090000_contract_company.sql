-- Round 33 — contracts.company_id (công ty của hợp đồng).
--
-- Round 10 stored the company link on the PARTNER (partner_companies is
-- many-to-many: one partner can work with HRP and HR VN at once). A contract,
-- however, is signed for exactly ONE company — so it records that choice here
-- as a nullable many-to-one link instead of inferring it.
--
-- Why NULLABLE:
--   - every contract created before round 33 has no company, and forcing a value
--     would break editing those rows (round 33 requirement b);
--   - the service only requires it when CREATING; updating an old contract must
--     stay legal.
-- The application-level rule (required on create, optional on edit) lives in
-- lib/services/contracts.ts — the database does not add a CHECK here, because a
-- NOT NULL column cannot be added to a table that already holds rows.
--
-- ON DELETE SET NULL (not CASCADE, not RESTRICT): `companies` rows are seeded
-- and read-only in the app, so a company is never deleted in practice. SET NULL
-- keeps the historical contract readable (partner_text stays intact) instead of
-- destroying or blocking the delete.

alter table public.contracts
  add column if not exists company_id uuid references public.companies (id) on delete set null;

create index if not exists contracts_company_id_idx
  on public.contracts (company_id);

comment on column public.contracts.company_id is
  'Công ty của hợp đồng (round 33). NULL = hợp đồng tạo trước round 33 hoặc chưa chọn. Bắt buộc khi tạo mới; không bắt buộc khi sửa (quyết định Owner). Khác partner_companies: công ty của đối tác là many-to-many, công ty của hợp đồng là many-to-one.';

-- The company is read by the contract form's Select, which is the ONLY writer.
-- No extra GRANT is needed: `authenticated` already holds SELECT / UPDATE on
-- contracts (hardening round 5), and RLS still filters every read by
-- organization. The referential integrity is enforced by the FK; the
-- organization check is repeated in the service layer (see createContract /
-- updateContract), because RLS on `contracts` constrains the CONTRACT's
-- organization, not the organization owning the referenced company.