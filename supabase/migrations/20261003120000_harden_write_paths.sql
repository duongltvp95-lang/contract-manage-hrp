-- M8 hardening addendum — close three write-path holes.
--
-- FIX 1 of 3. The review pointed at two grants and one foreign key:
--
--   ...090500_enable_rls_policies.sql:34-35
--     grant select, insert, update, delete on public.contracts      to authenticated;
--     grant select, insert, update, delete on public.contract_files to authenticated;
--
--   ...090400_create_contract_files.sql:10
--     contract_id uuid not null references public.contracts (id) on delete cascade
--
-- What was wrong:
--
--   1. `authenticated` held DELETE on `contracts`, and the policy layer happily
--      allowed it. Wave 1 has no hard delete — archiving is the only removal —
--      so the whole capability was reachable and unused, one stray PostgREST
--      call away from destroying a contract and cascading its file rows away
--      with it. This is the one that also silently orphaned R2 objects: the
--      cascade removes the only record of which keys to delete.
--   2. The UPDATE policy had no `archived_at IS NULL` condition, so an archived
--      contract could be edited — and un-archived — through the API. The
--      service layer filtered it; the database did not, and the database is the
--      layer that is supposed to be authoritative.
--   3. `contract_files` was fully writable by `authenticated`: a file row could
--      be re-pointed at another `object_key`, or deleted, after upload. A file
--      is immutable once it exists.
--
-- The application does none of these things (archive is an UPDATE; nothing
-- updates or deletes `contract_files`; nothing deletes a contract), so this
-- closes capabilities rather than changing behaviour. `service_role` keeps full
-- rights and is what the measurement/cleanup tooling uses.
--
-- NOTE on the USING / WITH CHECK split for `contracts`. `archived_at IS NULL`
-- belongs in USING, which is evaluated against the row *before* the update.
-- Putting it in WITH CHECK would make archiving itself fail, because the row
-- being written has `archived_at` set. USING alone is what stops edits to an
-- archived contract and blocks un-archiving.

-- ---------------------------------------------------------------------------
-- 1. Table privileges
-- ---------------------------------------------------------------------------

revoke delete on public.contracts from authenticated;
revoke update, delete on public.contract_files from authenticated;

comment on table public.contract_files is
  'Pointer to a private R2 object. No public URL is ever stored (plan sections 36, 61). Immutable after upload: authenticated holds INSERT and SELECT only.';

-- ---------------------------------------------------------------------------
-- 2. contracts — an archived contract is frozen, and nothing is deletable
-- ---------------------------------------------------------------------------

drop policy if exists contracts_update_own_org on public.contracts;
create policy contracts_update_own_org
  on public.contracts
  for update
  to authenticated
  using (
    organization_id = public.current_organization_id()
    and archived_at is null
  )
  with check (
    organization_id = public.current_organization_id()
  );

-- No DELETE policy is recreated. Without one, RLS denies DELETE outright — and
-- the grant is gone as well, so the capability is closed twice over.
drop policy if exists contracts_delete_own_org on public.contracts;

-- ---------------------------------------------------------------------------
-- 3. contract_files — INSERT and SELECT only
-- ---------------------------------------------------------------------------

drop policy if exists contract_files_update_own_org on public.contract_files;
drop policy if exists contract_files_delete_own_org on public.contract_files;

-- ---------------------------------------------------------------------------
-- 4. The cascade that erased the evidence
--
-- `on delete cascade` removed the file rows along with a deleted contract. Those
-- rows are the only record of which R2 objects exist, so cascading turned a
-- database delete into permanent, untraceable orphaned storage. RESTRICT forces
-- the caller to delete the files — and their objects — first.
-- ---------------------------------------------------------------------------

alter table public.contract_files
  drop constraint if exists contract_files_contract_id_fkey;

alter table public.contract_files
  add constraint contract_files_contract_id_fkey
  foreign key (contract_id) references public.contracts (id)
  on delete restrict;
