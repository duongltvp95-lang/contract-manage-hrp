-- ============================================================
-- Round 35 — gộp 2 bản ghi `partners` cùng MST 2500507916
-- (CÔNG TY TNHH DONGYANG ELECTRONICS VIỆT NAM) thành 1 dòng.
--
-- Quyết định của Owner (2026-10-11):
--   1. Gộp SQL thật, giữ 1 bản ghi, xóa 1 bản ghi dư. KHÔNG dedupe UI.
--   2. Hợp đồng trỏ bản ghi bị xóa → chuyển `partner_id` sang bản ghi
--      giữ lại, giữ nguyên `company_id` (giữ công ty đã ký).
--   3. Combobox `/contracts/new` tự nhiên hiện 1 dòng vì DB chỉ còn 1
--      bản ghi. KHÔNG sửa combobox/contractForm/createPartner.
--   4. Filter "Công ty" trên `/partners` vẫn lọc đúng — KHÔNG sửa.
--
-- Idempotent: chạy lại an toàn (skip khi `drop_id` đã bị xóa ở lần
-- trước). Khi gặp cảnh báo thì KHÔNG sửa DB, chỉ log.
-- ============================================================

DO $$
DECLARE
  keep_id  uuid := '4a9940d0-3438-4f66-adc2-c31dc694fc3f'; -- 2026-10-08, gắn HR VN
  drop_id  uuid := 'cd84d9c8-5139-479d-950e-9ee54b651212'; -- 2026-10-10, gắn HRP
  keep_tax text;
  drop_tax text;
  moved_contracts     int := 0;
  moved_company_links int := 0;
BEGIN
  -- 1. Đọc tax_code của 2 dòng
  SELECT tax_code INTO keep_tax FROM partners WHERE id = keep_id;
  SELECT tax_code INTO drop_tax FROM partners WHERE id = drop_id;

  -- 2. Idempotency: drop_id không còn → bỏ qua
  IF drop_tax IS NULL THEN
    RAISE NOTICE 'DONGYANG merge: drop_id % đã được xóa trước đó, skip', drop_id;
    RETURN;
  END IF;

  IF keep_tax IS NULL THEN
    RAISE EXCEPTION 'DONGYANG merge: Không tìm thấy keep_id (%) — abort, không sửa DB', keep_id;
  END IF;

  IF keep_tax <> drop_tax THEN
    RAISE EXCEPTION 'DONGYANG merge: Hai partner không cùng MST: keep=%, drop=%', keep_tax, drop_tax;
  END IF;

  -- 3. Cập nhật hợp đồng: partner_id cũ → id giữ lại, giữ nguyên company_id.
  --    Đây là cốt lõi quyết định §2 của Owner: nếu hợp đồng đã ký với HRP
  --    thì phải giữ company_id=HRP dù bản ghi partner gắn HRP bị xoá.
  UPDATE contracts
     SET partner_id = keep_id
   WHERE partner_id = drop_id;
  GET DIAGNOSTICS moved_contracts = ROW_COUNT;

  -- 4. Chuyển liên kết partner_companies của drop_id → keep_id.
  --    ON CONFLICT DO NOTHING để xử lý trường hợp link trùng (giữ nguyên
  --    company đã gắn với keep_id).
  INSERT INTO partner_companies (partner_id, company_id)
    SELECT keep_id, company_id
      FROM partner_companies
     WHERE partner_id = drop_id
    ON CONFLICT (partner_id, company_id) DO NOTHING;
  GET DIAGNOSTICS moved_company_links = ROW_COUNT;

  -- 5. Xoá liên kết cũ (an toàn vì đã chuyển sang keep_id ở bước 4).
  DELETE FROM partner_companies WHERE partner_id = drop_id;

  -- 6. Xoá bản ghi partners dư (đã chuyển xong contracts + links).
  DELETE FROM partners WHERE id = drop_id;

  RAISE NOTICE 'DONGYANG merge OK: contracts moved=%, company_links moved=%',
    moved_contracts, moved_company_links;
END
$$;
