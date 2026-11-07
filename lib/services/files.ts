import "server-only";

import {
  MAX_UPLOAD_SIZE_BYTES,
  MAX_UPLOAD_SIZE_MB,
  normalizeContractNumber,
  PresignUploadSchema,
  type FileKind,
} from "@schemas/file";

import {
  buildObjectKey,
  buildStagingObjectKey,
  isObjectKeyFor,
  isStagingObjectKeyFor,
  stagingKeyToFinalObjectKey,
} from "@/lib/r2/keys";
import { copyObjectConditional, deleteObject, headObject } from "@/lib/r2/objects";
import {
  createUploadUrl,
  createViewUrl,
  VIEW_URL_TTL_SECONDS,
} from "@/lib/r2/presign";
import { getR2Bucket } from "@/lib/r2/client";
import { formatBytes } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canDeleteEntities, type ArchivePrivilegeSubject } from "@/lib/delete-permissions";
import { recordCurrentUserAudit } from "./audit-logs";
import { enqueueR2Cleanup } from "./storage-cleanup";
import { createUploadReservation, verifyUploadReservation } from "./upload-reservation";
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

async function discardRejectedUpload(objectKey: string, message: string) {
  try {
    await deleteObject(objectKey, { timeoutMs: 3_000 });
  } catch (cleanupError) {
    const queued = await enqueueR2Cleanup({
      objectKey,
      reason: "upload_db_failed",
      lastError: `${message}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
    });
    if (!queued) {
      console.error("[service:completeUpload] Không thể xóa hoặc ghi cleanup intent cho upload bị từ chối", {
        objectKey,
        cleanupError,
      });
    }
  }
}

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
function normalizePrivilegeOptions(subject: ArchivePrivilegeSubject): {
  userEmail?: string | null;
  canManageArchived?: boolean;
} {
  if (!subject) return {};
  if (typeof subject === "string") {
    return { userEmail: subject };
  }
  return {
    userEmail: subject.email ?? null,
    ...(typeof subject.canManageArchived === "boolean"
      ? { canManageArchived: subject.canManageArchived }
      : {}),
  };
}

export async function getContractFileAccess(
  organizationId: string,
  contractId: string,
  fileId?: string,
  options?: {
    userEmail?: string | null;
    canManageArchived?: boolean;
    forUpload?: boolean;
  },
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
    // Under A01 RLS, a non-privileged user cannot SELECT an archived contract row
    // in their own org. Check the minimal archive-state RPC so upload/view callers
    // still receive the right archived error without leaking contract fields.
    const hasRpc = typeof (supabase as unknown as { rpc?: unknown }).rpc === "function";
    if (hasRpc) {
      const { data: archiveState } = await supabase.rpc(
        "get_contract_archive_state",
        { p_contract_id: contractId },
      );
      if (archiveState === "archived") {
        if (options?.forUpload) {
          return err("validation", "Hợp đồng đã được lưu trữ, không thể tải lên tệp mới");
        }
        return err("forbidden", "Hợp đồng đã được lưu trữ và bạn không có quyền truy cập");
      }
    }

    // `not_found` covers both "no such contract" and "another organization's
    // contract"; the caller turns it into 403, not 404, so nothing leaks.
    return err("forbidden", "Hợp đồng không thuộc tổ chức của bạn");
  }

  const contractRow = contract as { id: string; archived_at: string | null };

  // An archived contract is frozen; no new files may be uploaded or attached
  if (options?.forUpload && contractRow.archived_at !== null) {
    return err("validation", "Hợp đồng đã được lưu trữ, không thể tải lên tệp mới");
  }

  // An archived contract is only viewable with `can_manage_archived` (matches contract detail page rule)
  if (
    contractRow.archived_at !== null &&
    !canDeleteEntities({
      email: options?.userEmail,
      canManageArchived: options?.canManageArchived,
    })
  ) {
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
  uploadReservation: string;
  bucket: string;
  expiresInSeconds: number;
};

export type CreateUploadRequestInput = {
  userId: string;
  organizationId: string;
  contractId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  kind?: FileKind;
  fileId?: string;
  uploadReservation?: string;
  baseContractNumber?: string;
  userEmail?: string | null;
  canManageArchived?: boolean;
};

/**
 * Reserves a staging object key under `uploads-staging/` and returns a presigned PUT.
 *
 * The file id is generated server-side, so the key layout is never influenced
 * by the client. Browsers never receive write credentials for canonical `contracts/`
 * keys — `completeUpload()` verifies the staged object and promotes it server-side.
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
    canManageArchived: input.canManageArchived,
    forUpload: true,
  });
  if (!access.ok) {
    return access;
  }

  if (input.kind === "appendix") {
    const supabase = await createClient();

    // Đối chiếu số hợp đồng của hồ sơ với số hợp đồng gốc của phụ lục nếu có.
    const { data: contractRow, error: contractError } = await supabase
      .from("contracts")
      .select("id, contract_number")
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .maybeSingle();

    if (contractError) {
      return dbError("createUploadRequest.getContract", contractError);
    }
    if (!contractRow) {
      return err("not_found", "Không tìm thấy hồ sơ hợp đồng");
    }

    const normContract = normalizeContractNumber(contractRow.contract_number);
    if (!normContract || normContract === "—") {
      return err(
        "validation",
        "Không thể tải lên phụ lục khi hồ sơ hợp đồng chưa có số hợp đồng hợp lệ.",
      );
    }

    const { data: mainDocument, error: mainDocumentError } = await supabase
      .from("contract_files")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .eq("kind", "document")
      .limit(1)
      .maybeSingle();

    if (mainDocumentError) {
      return dbError("createUploadRequest.requireMainDocument", mainDocumentError);
    }
    if (!mainDocument) {
      return err("validation", "Cần tải tệp hợp đồng chính lên trước khi tải phụ lục.");
    }

    const normBase = normalizeContractNumber(input.baseContractNumber);
    if (!normBase) {
      return err(
        "validation",
        "Tải lên phụ lục bắt buộc phải có số hợp đồng gốc tương ứng để đối chiếu.",
      );
    }
    if (normBase !== normContract) {
      return err(
        "validation",
        `Số hợp đồng gốc của phụ lục ("${input.baseContractNumber}") không khớp với số hợp đồng của hồ sơ ("${contractRow.contract_number}").`,
      );
    }
  }

  const fileId = parsed.data.fileId ?? crypto.randomUUID();
  const objectKey = buildStagingObjectKey({
    organizationId,
    contractId,
    fileId,
    filename,
  });
  const finalObjectKey = buildObjectKey({
    organizationId,
    contractId,
    fileId,
    filename,
  });

  const reservationFields = {
    userId: input.userId,
    organizationId,
    contractId,
    fileId,
    objectKey,
    filename,
    mimeType,
    fileSize,
    kind: parsed.data.kind ?? "document",
    baseContractNumber: parsed.data.baseContractNumber ?? "",
  } as const;

  if (parsed.data.fileId) {
    if (!parsed.data.uploadReservation || !verifyUploadReservation(parsed.data.uploadReservation, reservationFields)) {
      return err("forbidden", "Phiên tải lên không hợp lệ hoặc đã hết hạn. Vui lòng tải lại tệp.");
    }

    // A retry ticket may only refresh the URL for an uncommitted upload. Never
    // issue a PUT URL for a file row that already exists: that would overwrite
    // a persisted R2 object using a replayed fileId.
    const admin = createAdminClient();
    const { data: existingFile, error: existingFileError } = await admin
      .from("contract_files")
      .select("id")
      .eq("id", fileId)
      .maybeSingle();
    if (existingFileError) return dbError("createUploadRequest.checkFileId", existingFileError);
    if (existingFile) return err("validation", "Tệp đã được lưu. Hãy làm mới hồ sơ trước khi tải lại.");

    const { data: cleanupJob, error: cleanupError } = await admin
      .from("r2_cleanup_queue")
      .select("id")
      .in("object_key", [objectKey, finalObjectKey])
      .limit(1)
      .maybeSingle();
    if (cleanupError) return dbError("createUploadRequest.checkCleanupQueue", cleanupError);
    if (cleanupJob) return err("validation", "Phiên tải lên đã được đưa vào hàng đợi dọn dẹp. Vui lòng chọn lại tệp.");
  }

  // Persist before issuing a PUT URL: closing the tab must not orphan an object.
  const { data: registered, error: intentError } = await createAdminClient()
    .rpc("register_contract_upload_intent", {
      p_object_key: objectKey, p_file_id: fileId, p_organization_id: organizationId,
      p_contract_id: contractId, p_created_by: input.userId,
    })
    .abortSignal(AbortSignal.timeout(3_000));
  if (intentError) return dbError("createUploadRequest.registerIntent", intentError);
  if (registered !== true) return err("validation", "Phiên tải lên đã hoàn tất hoặc được đưa vào hàng đợi dọn dẹp. Vui lòng chọn lại tệp.");

  // Pass fileSize so AWS SigV4 binds Content-Length header, preventing oversized uploads
  const uploadUrl = await createUploadUrl(objectKey, mimeType, fileSize);

  return ok({
    fileId,
    objectKey,
    uploadUrl,
    uploadReservation: parsed.data.uploadReservation ?? createUploadReservation(reservationFields),
    bucket: getR2Bucket(),
    expiresInSeconds: 10 * 60,
  });
}

export type CompleteUploadInput = {
  organizationId: string;
  userId: string;
  userEmail?: string | null;
  canManageArchived?: boolean;
  contractId: string;
  fileId: string;
  objectKey: string;
  uploadReservation: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  kind?: FileKind;
  baseContractNumber?: string;
};

/**
 * Verifies the staged upload in `uploads-staging/`, promotes it conditionally to
 * canonical `contracts/` storage, and persists the `contract_files` row.
 */
export async function completeUpload(
  input: CompleteUploadInput,
): Promise<ServiceResult<ContractFileRow>> {
  const { organizationId, userId, userEmail, canManageArchived, contractId, fileId, objectKey } = input;

  const access = await getContractFileAccess(organizationId, contractId, undefined, {
    userEmail,
    canManageArchived,
    forUpload: true,
  });
  if (!access.ok) {
    return access;
  }

  const isStagedUpload = isStagingObjectKeyFor(objectKey, { organizationId, contractId, fileId });
  const isLegacyDirectUpload =
    !isStagedUpload && isObjectKeyFor(objectKey, { organizationId, contractId, fileId });
  if (!isStagedUpload && !isLegacyDirectUpload) {
    return err("forbidden", "objectKey không khớp với hợp đồng");
  }
  const finalObjectKey = isStagedUpload
    ? stagingKeyToFinalObjectKey(objectKey, {
        organizationId,
        contractId,
        fileId,
      })
    : objectKey;
  if (!finalObjectKey) {
    return err("forbidden", "objectKey không khớp với hợp đồng");
  }

  const supabase = await createClient();
  const reservationFields = {
    userId,
    organizationId,
    contractId,
    fileId,
    objectKey,
    filename: input.filename,
    mimeType: input.mimeType,
    fileSize: input.fileSize,
    kind: input.kind ?? "document",
    baseContractNumber: input.baseContractNumber ?? "",
  } as const;
  if (!verifyUploadReservation(input.uploadReservation, reservationFields)) {
    return err("forbidden", "Phiên tải lên không hợp lệ hoặc đã hết hạn. Vui lòng tải lại tệp.");
  }

  // New createUploadRequest() calls exclusively issue uploads-staging/ keys.
  // A canonical contracts/ key is accepted ONLY for an in-flight upload that was
  // server-registered in pending_contract_uploads right before domain cutover.
  if (isLegacyDirectUpload) {
    const adminCheck = createAdminClient();
    const { data: legacyIntent, error: legacyIntentError } = await adminCheck
      .from("pending_contract_uploads")
      .select("object_key")
      .eq("file_id", fileId)
      .eq("object_key", objectKey)
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .eq("created_by", userId)
      .abortSignal(AbortSignal.timeout(5_000))
      .maybeSingle();
    if (legacyIntentError) {
      return dbError("completeUpload.verifyLegacyIntent", legacyIntentError);
    }
    if (!legacyIntent) {
      const { data: committedRow } = await adminCheck
        .from("contract_files")
        .select(CONTRACT_FILE_COLUMNS)
        .eq("id", fileId)
        .abortSignal(AbortSignal.timeout(5_000))
        .maybeSingle();
      if (
        committedRow &&
        committedRow.organization_id === organizationId &&
        committedRow.contract_id === contractId &&
        committedRow.object_key === finalObjectKey
      ) {
        return ok(committedRow as ContractFileRow);
      }
      return err("forbidden", "objectKey không khớp với hợp đồng");
    }
  }

  if (input.kind === "appendix") {
    const { data: mainDocument, error: mainDocumentError } = await supabase
      .from("contract_files")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .eq("kind", "document")
      .limit(1)
      .maybeSingle();

    if (mainDocumentError) {
      await discardRejectedUpload(objectKey, "Không kiểm tra được hợp đồng chính trước khi lưu phụ lục");
      return dbError("completeUpload.requireMainDocument", mainDocumentError);
    }
    if (!mainDocument) {
      await discardRejectedUpload(objectKey, "Từ chối lưu phụ lục khi chưa có hợp đồng chính");
      return err("validation", "Cần tải tệp hợp đồng chính lên trước khi lưu phụ lục.");
    }

    const { data: contractRow, error: contractError } = await supabase
      .from("contracts")
      .select("id, contract_number")
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .maybeSingle();

    if (contractError) {
      return dbError("completeUpload.getContract", contractError);
    }
    if (!contractRow) {
      return err("not_found", "Không tìm thấy hồ sơ hợp đồng");
    }

    const normContract = normalizeContractNumber(contractRow.contract_number);
    const normBase = normalizeContractNumber(input.baseContractNumber);
    if (!normBase) {
      await discardRejectedUpload(objectKey, "Thiếu số hợp đồng gốc của phụ lục");
      return err(
        "validation",
        "Tải lên phụ lục bắt buộc phải có số hợp đồng gốc tương ứng để đối chiếu.",
      );
    }
    if (!normContract || normBase !== normContract) {
      await discardRejectedUpload(objectKey, "Phụ lục không khớp số hợp đồng của hồ sơ");
      return err(
        "validation",
        `Số hợp đồng gốc của phụ lục ("${input.baseContractNumber}") không khớp với số hợp đồng của hồ sơ ("${contractRow.contract_number}").`,
      );
    }
  }

  let head: Awaited<ReturnType<typeof headObject>> | null = null;
  let headError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      head = await headObject(objectKey, { timeoutMs: 8_000 });
      headError = null;
      if (head.exists || attempt === 1) break;
    } catch (error) {
      headError = error;
      if (attempt === 1) break;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }

  if (headError) {
    await discardRejectedUpload(
      objectKey,
      `R2 HEAD thất bại: ${headError instanceof Error ? headError.message : String(headError)}`,
    );
    return dbError("completeUpload.headObject", headError);
  }
  if (!head) {
    return dbError("completeUpload.headObject", new Error("R2 HEAD did not return a response"));
  }
  if (!head.exists) {
    // Idempotent retry: a previous completeUpload may have already promoted the
    // file to `contracts/` and deleted the staging object.
    try {
      const admin = createAdminClient();
      const { data: committedRow } = await admin
        .from("contract_files")
        .select(CONTRACT_FILE_COLUMNS)
        .eq("id", fileId)
        .abortSignal(AbortSignal.timeout(5_000))
        .maybeSingle();
      if (
        committedRow &&
        committedRow.organization_id === organizationId &&
        committedRow.contract_id === contractId &&
        committedRow.object_key === finalObjectKey
      ) {
        return ok(committedRow as ContractFileRow);
      }
    } catch {
      // Fall through to upload_incomplete if verification is unavailable.
    }

    return err(
      "upload_incomplete",
      "Tệp chưa được tải lên hoàn tất. Vui lòng thử lại.",
    );
  }

  const actualSize = head.contentLength ?? 0;

  if (actualSize > MAX_UPLOAD_SIZE_BYTES) {
    try {
      await deleteObject(objectKey, { timeoutMs: 3_000 });
    } catch (cleanupError) {
      const queued = await enqueueR2Cleanup({
        objectKey,
        reason: "upload_db_failed",
        lastError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
      if (!queued) {
        console.error("[service:completeUpload] Không thể xóa hoặc ghi cleanup intent cho tệp vượt giới hạn", {
          objectKey,
          cleanupError,
        });
      }
    }

    return err(
      "validation",
      `Tệp vượt quá giới hạn ${MAX_UPLOAD_SIZE_MB} MB (tệp thực tế ${formatBytes(actualSize)}). Tệp đã được xoá, vui lòng chọn tệp nhỏ hơn.`,
    );
  }

  let promotedChecksum: string | null = head.etag;
  if (isStagedUpload) {
    try {
      const copyRes = await copyObjectConditional(objectKey, finalObjectKey, {
        sourceEtag: head.etag,
        contentType: input.mimeType,
        timeoutMs: 10_000,
      });

      if (copyRes.status === "source_changed_or_missing") {
        return err(
          "upload_incomplete",
          "Nội dung tệp tải lên đã thay đổi hoặc chưa sẵn sàng. Vui lòng tải lại tệp.",
        );
      }

      if (copyRes.status === "destination_exists") {
        const adminCheck = createAdminClient();
        const { data: committedRow } = await adminCheck
          .from("contract_files")
          .select(CONTRACT_FILE_COLUMNS)
          .eq("id", fileId)
          .abortSignal(AbortSignal.timeout(5_000))
          .maybeSingle();
        if (
          committedRow &&
          committedRow.organization_id === organizationId &&
          committedRow.contract_id === contractId &&
          committedRow.object_key === finalObjectKey
        ) {
          await deleteObject(objectKey, { timeoutMs: 3_000 }).catch(() => {});
          return ok(committedRow as ContractFileRow);
        }

        const existingFinalHead = await headObject(finalObjectKey, { timeoutMs: 5_000 });
        if (!existingFinalHead.exists) {
          return err("upload_incomplete", "Không xác minh được tệp đích trên kho lưu trữ. Vui lòng thử lại.");
        }
        promotedChecksum = existingFinalHead.etag ?? head.etag;
      } else {
        promotedChecksum = copyRes.etag ?? head.etag;
      }
    } catch (copyError) {
      await discardRejectedUpload(
        objectKey,
        `R2 CopyObject thất bại: ${copyError instanceof Error ? copyError.message : String(copyError)}`,
      );
      return dbError("completeUpload.copyObject", copyError);
    }
  }

  const admin = createAdminClient();
  const { data: rpcData, error: persistError } = await admin
    .rpc("complete_contract_file_upload", {
      p_file_id: fileId,
      p_organization_id: organizationId,
      p_contract_id: contractId,
      p_object_key: finalObjectKey,
      p_bucket: getR2Bucket(),
      p_original_filename: input.filename,
      p_mime_type: input.mimeType,
      // The measured size, not the declared one.
      p_file_size: actualSize > 0 ? actualSize : input.fileSize,
      p_checksum: promotedChecksum,
      p_created_by: userId,
      p_kind: input.kind ?? "document",
    })
    .abortSignal(AbortSignal.timeout(10_000));

  let row: ContractFileRow | null = rpcData as ContractFileRow | null;
  if (persistError) {
    // A timeout can hide a committed RPC response. Return the committed row if
    // it exists; otherwise enqueue cleanup under the same object-key lock.
    let verificationError: unknown = null;
    try {
      const admin = createAdminClient();
      const verifyQuery = admin
        .from("contract_files")
        .select(CONTRACT_FILE_COLUMNS)
        .eq("id", fileId)
        .abortSignal(AbortSignal.timeout(5_000));
      const { data: existingRow, error: checkError } = await verifyQuery.maybeSingle();

      if (checkError) {
        verificationError = checkError;
      } else if (
        existingRow &&
        existingRow.organization_id === organizationId &&
        existingRow.contract_id === contractId &&
        existingRow.object_key === finalObjectKey
      ) {
        row = existingRow as ContractFileRow;
      }
    } catch (checkError) {
      verificationError = checkError;
    }

    if (!row) {
      const lastError = verificationError
        ? `DB verification failed: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`
        : persistError.message;
      const queuedFinal = await enqueueR2Cleanup({
        objectKey: finalObjectKey,
        reason: "upload_db_failed",
        lastError,
      });
      if (isStagedUpload) {
        await enqueueR2Cleanup({
          objectKey,
          reason: "upload_db_failed",
          lastError,
        });
      }
      if (!queuedFinal) {
        console.error(
          "[service:completeUpload] Không xác nhận được hàng DB và cũng không ghi được cleanup intent; object cần được đối soát thủ công",
          { objectKey: finalObjectKey, stagingObjectKey: objectKey, persistError, verificationError },
        );
      }
      return dbError("completeUpload", persistError);
    }
  }

  if (!row) {
    return dbError("completeUpload", new Error("RPC complete_contract_file_upload returned no row"));
  }

  if (!persistError && isStagedUpload) {
    try {
      await deleteObject(objectKey, { timeoutMs: 3_000 });
    } catch (stagingDeleteError) {
      await enqueueR2Cleanup({
        objectKey,
        reason: "reconciliation",
        lastError:
          stagingDeleteError instanceof Error
            ? stagingDeleteError.message
            : String(stagingDeleteError),
      });
    }
  }

  return ok(row);
}

/** Plan section 77 — files of one contract, newest first. */
export async function listContractFiles(
  organizationId: string,
  contractId: string,
  subject?: ArchivePrivilegeSubject,
): Promise<ServiceResult<ContractFileRow[]>> {
  const access = await getContractFileAccess(
    organizationId,
    contractId,
    undefined,
    normalizePrivilegeOptions(subject),
  );
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
  subject?: ArchivePrivilegeSubject,
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
    normalizePrivilegeOptions(subject),
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
  subject?: ArchivePrivilegeSubject,
): Promise<ServiceResult<{ id: string; contractId: string }>> {
  if (!canDeleteEntities(subject)) {
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
    .select("id, contract_id, object_key, organization_id, original_filename, kind")
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
    kind: FileKind;
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

  // Không cho phép xoá tệp hợp đồng chính nếu hồ sơ vẫn còn phụ lục
  if (file.kind === "document") {
    const { data: appendixFiles, error: appCheckError } = await admin
      .from("contract_files")
      .select("id")
      .eq("contract_id", file.contract_id)
      .eq("organization_id", organizationId)
      .eq("kind", "appendix")
      .limit(1);

    if (appCheckError) {
      return dbError("deleteContractFile.checkAppendices", appCheckError);
    }

    if (appendixFiles && appendixFiles.length > 0) {
      return err(
        "validation",
        "Không thể xoá tệp hợp đồng chính khi hồ sơ vẫn còn phụ lục đính kèm. Vui lòng xoá các phụ lục trước.",
      );
    }
  }

  // The RPC deletes the row and inserts a processing cleanup intent in one
  // transaction under the same per-object lock used by upload completion.
  const { data: deletionData, error: deleteError } = await admin.rpc(
    "delete_contract_file_with_cleanup",
    {
      p_file_id: fileId,
      p_organization_id: organizationId,
      p_object_key: file.object_key,
    },
  ).abortSignal(AbortSignal.timeout(5_000));

  if (deleteError) {
    if (deleteError.code === "55000") {
      return err("validation", "Hợp đồng đã thay đổi trạng thái; không thể xoá tệp");
    }
    if (deleteError.code === "23514" || deleteError.message?.includes("Cannot delete main contract document")) {
      return err("validation", "Không thể xoá tệp hợp đồng chính khi hồ sơ vẫn còn phụ lục đính kèm");
    }
    return dbError("deleteContractFile", deleteError);
  }
  if (!deletionData) {
    return err("not_found", "Tệp đã được xoá hoặc không còn tồn tại");
  }

  const deletion = deletionData as { id: string; contract_id: string; object_key: string; cleanup_id: string };
  let r2Error: unknown = null;
  try {
    await deleteObject(file.object_key, { timeoutMs: 3_000 });
  } catch (error) {
    r2Error = error;
    console.error("[service:deleteContractFile] R2 delete failed; durable cleanup intent remains queued", error);
  }

  try {
    const { error: finishError } = await admin
      .rpc("finish_r2_cleanup_job", {
        p_job_id: deletion.cleanup_id,
        p_succeeded: r2Error === null,
        p_last_error: r2Error instanceof Error ? r2Error.message : r2Error ? String(r2Error) : null,
      })
      .abortSignal(AbortSignal.timeout(3_000));
    if (finishError) {
      console.error("[service:deleteContractFile] Không thể cập nhật trạng thái cleanup job", finishError);
    }
  } catch (finishError) {
    console.error("[service:deleteContractFile] Ngoại lệ khi cập nhật trạng thái cleanup job", finishError);
  }

  try {
    await recordCurrentUserAudit({
      action: "delete_file",
      targetKind: "file",
      targetId: file.id,
      metadata: {
        filename: file.original_filename,
        kind: file.kind,
        contractId: file.contract_id,
      },
    });
  } catch (auditError) {
    console.error("[service:deleteContractFile] Lỗi ghi nhật ký xoá tệp", auditError);
  }

  return ok({ id: deletion.id, contractId: deletion.contract_id });
}

