import "server-only";

import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB, PresignUploadSchema, type FileKind } from "@schemas/file";

import { buildObjectKey, isObjectKeyFor } from "@/lib/r2/keys";
import { deleteObject, headObject } from "@/lib/r2/objects";
import {
  createUploadUrl,
  createViewUrl,
  VIEW_URL_TTL_SECONDS,
} from "@/lib/r2/presign";
import { getR2Bucket } from "@/lib/r2/client";
import { formatBytes } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canDeleteEntities } from "@/lib/delete-permissions";
import { recordCurrentUserAudit } from "./audit-logs";
import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * File service + authorization — plan sections 63, 77.
 *
 * Central rule (plan section 73): RLS does not protect R2, so a presigned URL
 * may only be issued after this module has authorized the caller.
 */

export type ContractFileRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  storage_provider: string;
  bucket: string;
  object_key: string;
  original_filename: string;
  mime_type: string;
  file_size: number | null;
  checksum: string | null;
  created_by: string | null;
  created_at: string;
  kind: FileKind;
};

export const CONTRACT_FILE_COLUMNS =
  "id, organization_id, contract_id, storage_provider, bucket, object_key, original_filename, mime_type, file_size, checksum, created_by, created_at, kind";

export type FileAccess = {
  contractId: string;
  file: ContractFileRow | null;
};

/**
 * `getContractFileAccess()` — plan section 63.
 *
 * Checks, in order:
 *   1. there is a usable signed-in user (not deactivated),
 *   2. the contract exists **within the caller's organization**,
 *   3. when a `fileId` is given, the file exists and belongs to that contract.
 *
 * Any failure is a hard stop — no presigned URL may be produced.
 */
export async function getContractFileAccess(
  organizationId: string,
  contractId: string,
  fileId?: string,
  options?: { userEmail?: string | null; forUpload?: boolean },
): Promise<ServiceResult<FileAccess>> {
  const supabase = await createClient();

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id, archived_at")
    .eq("id", contractId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (contractError) {
    return dbError("getContractFileAccess", contractError);
  }

  if (!contract) {
    // `not_found` covers both "no such contract" and "another organization's
    // contract"; the caller turns it into 403, not 404, so nothing leaks.
    return err("forbidden", "Hợp đồng không thuộc tổ chức của bạn");
  }

  const contractRow = contract as { id: string; archived_at: string | null };

  // An archived contract is frozen; no new files may be uploaded or attached
  if (options?.forUpload && contractRow.archived_at !== null) {
    return err("validation", "Hợp đồng đã được lưu trữ, không thể tải lên tệp mới");
  }

  // An archived contract is only viewable by delete-admins / Owner (matches contract detail page rule)
  if (contractRow.archived_at !== null && !canDeleteEntities(options?.userEmail)) {
    return err("forbidden", "Hợp đồng đã được lưu trữ và bạn không có quyền truy cập");
  }

  if (!fileId) {
    return ok({ contractId, file: null });
  }

  const { data, error } = await supabase
    .from("contract_files")
    .select(CONTRACT_FILE_COLUMNS)
    .eq("id", fileId)
    .eq("contract_id", contractId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return dbError("getContractFileAccess", error);
  }

  if (!data) {
    return err("forbidden", "Tệp không thuộc hợp đồng này");
  }

  return ok({ contractId, file: data as ContractFileRow });
}

export type UploadRequest = {
  fileId: string;
  objectKey: string;
  uploadUrl: string;
  bucket: string;
  expiresInSeconds: number;
};

export type CreateUploadRequestInput = {
  organizationId: string;
  contractId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  kind?: FileKind;
  userEmail?: string | null;
};

/**
 * Reserves an object key and returns a presigned PUT (plan sections 37, 42).
 *
 * The file id is generated server-side, so the key layout is never influenced
 * by the client. Nothing is written to the database yet — the row is created by
 * `completeUpload()` only after the bytes really landed in R2.
 */
export async function createUploadRequest(
  input: CreateUploadRequestInput,
): Promise<ServiceResult<UploadRequest>> {
  const parsed = PresignUploadSchema.safeParse(input);

  if (!parsed.success) {
    return err(
      "validation",
      "Tệp không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const { organizationId, contractId, filename, mimeType, fileSize } = parsed.data;

  const access = await getContractFileAccess(organizationId, contractId, undefined, {
    userEmail: input.userEmail,
    forUpload: true,
  });
  if (!access.ok) {
    return access;
  }

  const fileId = crypto.randomUUID();
  const objectKey = buildObjectKey({
    organizationId,
    contractId,
    fileId,
    filename,
  });

  // Pass fileSize so AWS SigV4 binds Content-Length header, preventing oversized uploads
  const uploadUrl = await createUploadUrl(objectKey, mimeType, fileSize);

  return ok({
    fileId,
    objectKey,
    uploadUrl,
    bucket: getR2Bucket(),
    expiresInSeconds: 10 * 60,
  });
}

export type CompleteUploadInput = {
  organizationId: string;
  userId: string;
  userEmail?: string | null;
  contractId: string;
  fileId: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  kind?: FileKind;
};

/**
 * Persists the `contract_files` row (plan sections 34, 42, 77).
 *
 * Verifies with a HEAD request that the object exists before writing the row —
 * a row pointing at a missing object would break the viewer later. The HEAD
 * response also supplies the stored size and ETag used as `checksum`.
 */
export async function completeUpload(
  input: CompleteUploadInput,
): Promise<ServiceResult<ContractFileRow>> {
  const { organizationId, userId, userEmail, contractId, fileId, objectKey } = input;

  const access = await getContractFileAccess(organizationId, contractId, undefined, {
    userEmail,
    forUpload: true,
  });
  if (!access.ok) {
    return access;
  }

  // The key must sit under this organization and contract; a client could
  // otherwise hand back an arbitrary key it happens to know.
  if (!isObjectKeyFor(objectKey, { organizationId, contractId, fileId })) {
    return err("forbidden", "objectKey không khớp với hợp đồng");
  }

  const head = await headObject(objectKey);
  if (!head.exists) {
    return err(
      "upload_incomplete",
      "Tệp chưa được tải lên hoàn tất. Vui lòng thử lại.",
    );
  }

  /**
   * Enforce the ceiling on what actually landed, not on what was promised.
   *
   * The size in the request is the client's claim. A presigned PUT cannot cap a
   * body — the signature fixes the key and the content type, not a maximum
   * length — so a client can declare 1 KB, upload 500 MB and the bytes are in
   * the bucket before anyone looks. The HEAD above is the first fact available,
   * and until this check existed the only limit that applied was the one on the
   * browser's own file picker.
   *
   * The object is removed before returning: leaving it would mean paying to
   * store something the application refuses to acknowledge, with no row to find
   * it by later.
   */
  const actualSize = head.contentLength ?? 0;

  if (actualSize > MAX_UPLOAD_SIZE_BYTES) {
    await deleteObject(objectKey);

    return err(
      "validation",
      `Tệp vượt quá giới hạn ${MAX_UPLOAD_SIZE_MB} MB (tệp thực tế ${formatBytes(actualSize)}). Tệp đã được xoá, vui lòng chọn tệp nhỏ hơn.`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_files")
    .insert({
      id: fileId,
      organization_id: organizationId,
      contract_id: contractId,
      storage_provider: "r2",
      bucket: getR2Bucket(),
      object_key: objectKey,
      original_filename: input.filename,
      mime_type: input.mimeType,
      // The measured size, not the declared one.
      file_size: actualSize > 0 ? actualSize : input.fileSize,
      checksum: head.etag,
      created_by: userId,
      kind: input.kind ?? "document",
    })
    .select(CONTRACT_FILE_COLUMNS)
    .single();

  if (error) {
    return dbError("completeUpload", error);
  }

  const row = data as ContractFileRow;

  // `completeUpload` runs with a signed-in session user as the actor.
  await recordCurrentUserAudit({
    action: "upload_file",
    targetKind: "file",
    targetId: row.id,
    metadata: { filename: row.original_filename, size: row.file_size },
  });

  return ok(row);
}

/** Plan section 77 — files of one contract, newest first. */
export async function listContractFiles(
  organizationId: string,
  contractId: string,
  userEmail?: string | null,
): Promise<ServiceResult<ContractFileRow[]>> {
  const access = await getContractFileAccess(organizationId, contractId, undefined, {
    userEmail,
  });
  if (!access.ok) {
    return access;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_files")
    .select(CONTRACT_FILE_COLUMNS)
    .eq("contract_id", contractId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return dbError("listContractFiles", error);
  }

  return ok((data ?? []) as ContractFileRow[]);
}

export type FileViewUrl = {
  fileId: string;
  objectKey: string;
  viewUrl: string;
  expiresInSeconds: number;
  /** ISO timestamp — the client refreshes a minute before this (plan section 60). */
  expiresAt: string;
};

/**
 * `getFileViewUrl()` — plan sections 59, 63, 77.
 *
 * The only way a browser ever gets a presigned GET. The authorization chain is
 * the one from plan section 63:
 *
 *   user exists -> organization matches -> contract belongs to that
 *   organization -> file belongs to that contract
 *
 * `getContractFileAccess()` performs the checks; this function first has to
 * locate the file to learn which contract to check. RLS plus the explicit
 * `.eq("organization_id", …)` mean another tenant's file simply is not found,
 * and the caller answers 403 either way — a 404 would leak that the id exists.
 */
export async function getFileViewUrl(
  fileId: string,
  organizationId: string,
  userEmail?: string | null,
): Promise<ServiceResult<FileViewUrl>> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("contract_files")
    .select("id, contract_id, object_key, organization_id")
    .eq("id", fileId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const located = data as
    | { id: string; contract_id: string; object_key: string }
    | null;

  if (!located) {
    return err("forbidden", "Tệp không thuộc tổ chức của bạn");
  }

  // Full check, in case the row ever becomes inconsistent with its contract.
  const access = await getContractFileAccess(
    organizationId,
    located.contract_id,
    fileId,
    { userEmail },
  );
  if (!access.ok) {
    return access;
  }

  const authorized = access.data.file;
  if (!authorized) {
    return err("forbidden", "Tệp không thuộc hợp đồng này");
  }

  /**
   * The stored key must still belong to the ids in the row, before anything is
   * signed.
   *
   * The authorization above answers "may this caller see this file row?". It
   * does not answer "does this row still point where it claims?" — the
   * `object_key` column is data, and data can be wrong. A row re-pointed at
   * another organization's key (by hand, by a bad migration, or by a future
   * bug) would otherwise turn this function into a way to read an arbitrary
   * object out of the bucket, with a valid signature and a valid session.
   *
   * `isObjectKeyFor()` rebuilds the prefix from the row's own ids, so a mismatch
   * is refused instead of signed.
   */
  if (
    !isObjectKeyFor(authorized.object_key, {
      organizationId,
      contractId: authorized.contract_id,
      fileId: authorized.id,
    })
  ) {
    return err(
      "forbidden",
      "Đường dẫn tệp không hợp lệ nên không thể tạo liên kết xem",
    );
  }

  const viewUrl = await createViewUrl(authorized.object_key);

  return ok({
    fileId,
    objectKey: authorized.object_key,
    viewUrl,
    expiresInSeconds: VIEW_URL_TTL_SECONDS,
    expiresAt: new Date(Date.now() + VIEW_URL_TTL_SECONDS * 1000).toISOString(),
  });
}

/**
 * Deletes a contract file from both `contract_files` table and R2 storage.
 *
 * Only owners/delete-admins can delete files; archived contracts cannot be modified.
 * DB row is deleted first using adminClient (due to RLS hardening revoking DELETE from authenticated);
 * R2 object is deleted only after the DB deletion succeeds.
 */
export async function deleteContractFile(
  fileId: string,
  organizationId: string,
  userEmail?: string | null,
): Promise<ServiceResult<{ id: string; contractId: string }>> {
  if (!canDeleteEntities(userEmail)) {
    return err("forbidden", "Không có quyền xoá tệp hợp đồng");
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    return dbError("deleteContractFile", error);
  }

  const { data: fileData, error: findError } = await admin
    .from("contract_files")
    .select("id, contract_id, object_key, organization_id, original_filename")
    .eq("id", fileId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (findError) {
    return dbError("deleteContractFile", findError);
  }

  if (!fileData) {
    return err("forbidden", "Tệp không tồn tại hoặc không thuộc tổ chức của bạn");
  }

  const file = fileData as {
    id: string;
    contract_id: string;
    object_key: string;
    original_filename: string;
  };

  const { data: contractData, error: contractError } = await admin
    .from("contracts")
    .select("id, archived_at")
    .eq("id", file.contract_id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (contractError) {
    return dbError("deleteContractFile", contractError);
  }

  if (!contractData) {
    return err("forbidden", "Hợp đồng không tồn tại hoặc không thuộc tổ chức của bạn");
  }

  if (contractData.archived_at !== null) {
    return err("validation", "Không thể xoá tệp của hợp đồng đã được lưu trữ");
  }

  // Delete DB row FIRST with service-role client (authenticated has no DELETE grant).
  // If DB deletion fails, R2 object is left completely untouched.
  const { error: deleteError } = await admin
    .from("contract_files")
    .delete()
    .eq("id", fileId)
    .eq("organization_id", organizationId);

  if (deleteError) {
    return dbError("deleteContractFile", deleteError);
  }

  // DB deletion succeeded; delete R2 object
  try {
    await deleteObject(file.object_key);
  } catch (r2Error) {
    console.error("[service:deleteContractFile] R2 delete failed", r2Error);
  }

  return ok({ id: file.id, contractId: file.contract_id });
}

