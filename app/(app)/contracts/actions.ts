"use server";

import { CompleteUploadSchema, type CompleteUploadInput } from "@schemas/file";

import {
  archiveContract,
  createContract,
  updateContract,
  type ContractRow,
} from "@/lib/services/contracts";
import { completeUpload, type ContractFileRow } from "@/lib/services/files";
import {
  authorized,
  fromService,
  validationFailure,
  type ActionResult,
} from "@/lib/server-action";

/**
 * Server actions for contract CRUD and the upload flow — plan sections 42, 64.
 *
 * CRUD goes through actions rather than a REST layer (plan section 64); the only
 * route handlers are the presign endpoints, which the browser calls directly.
 *
 * Every action resolves the session through `authorized()`, so `organizationId`
 * and the user id always come from the server — never from the arguments.
 */

export async function createContractAction(
  input: unknown,
): Promise<ActionResult<ContractRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const result = await createContract((input ?? {}) as Record<string, unknown>, {
    userId: access.user.id,
    organizationId: access.user.organizationId,
  });

  return fromService(result);
}

/** Plan section 65 — W1-WEB-031. */
export async function updateContractAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult<ContractRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin hợp đồng", [
      { path: "id", message: "Không xác định được hợp đồng cần sửa" },
    ]);
  }

  const result = await updateContract(
    id,
    (input ?? {}) as Record<string, unknown>,
    {
      userId: access.user.id,
      organizationId: access.user.organizationId,
    },
  );

  return fromService(result);
}

/** Plan section 66 — W1-WEB-032. Soft delete: stamps `archived_at`. */
export async function archiveContractAction(
  id: unknown,
): Promise<ActionResult<ContractRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin hợp đồng", [
      { path: "id", message: "Không xác định được hợp đồng cần lưu trữ" },
    ]);
  }

  const result = await archiveContract(id, access.user.organizationId);

  return fromService(result);
}

export async function completeUploadAction(
  input: unknown,
): Promise<ActionResult<ContractFileRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const parsed = CompleteUploadSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(
      "Thông tin tệp không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload: CompleteUploadInput = parsed.data;

  const result = await completeUpload({
    organizationId: access.user.organizationId,
    userId: access.user.id,
    contractId: payload.contractId,
    fileId: payload.fileId,
    objectKey: payload.objectKey,
    filename: payload.filename,
    mimeType: payload.mimeType,
    fileSize: payload.fileSize,
  });

  return fromService(result);
}
