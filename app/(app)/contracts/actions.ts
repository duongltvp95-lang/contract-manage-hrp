"use server";

import { CompleteUploadSchema, type CompleteUploadInput } from "@schemas/file";

import {
  archiveContract,
  createContract,
  deleteContract,
  deleteContracts,
  findDuplicateContract,
  unarchiveContract,
  updateContract,
  type BulkDeleteItem,
  type ContractRow,
} from "@/lib/services/contracts";
import { completeUpload, type ContractFileRow } from "@/lib/services/files";
import { deleteObject, getObjectBuffer } from "@/lib/r2/objects";
import {
  authorized,
  fromService,
  validationFailure,
  type ActionResult,
} from "@/lib/server-action";
import type { ExtractedContractResult } from "@schemas/contract";
import { extractContractFromBuffer } from "@/lib/ai/gemini";
import {
  cleanEntityName,
  findBestMatchingCompany,
  findBestMatchingPartner,
  isInternalCompany,
  reconcileContractParties,
} from "@/lib/ai/matching";
import { createPartner, listCompanies, searchPartners } from "@/lib/services/partners";

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
    kind: payload.kind,
  });

  return fromService(result);
}

/** Round 19 — hard-delete a contract (owner-email-gated in the service). */
export async function deleteContractAction(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin hợp đồng", [
      { path: "id", message: "Không xác định được hợp đồng cần xoá" },
    ]);
  }

  return fromService(
    await deleteContract(id, { organizationId: access.user.organizationId }),
  );
}

/** Round 24 — bulk hard-delete of contracts (owner-email-gated in the service). */
export async function deleteContractsAction(
  ids: unknown,
): Promise<ActionResult<{ results: BulkDeleteItem[] }>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return validationFailure("Thiếu thông tin hợp đồng", [
      { path: "ids", message: "Danh sách hợp đồng cần xoá không hợp lệ" },
    ]);
  }

  return fromService(
    await deleteContracts(ids as string[], {
      organizationId: access.user.organizationId,
    }),
  );
}

/** Round 19 — unarchive a contract (owner-email-gated in the service). */
export async function unarchiveContractAction(
  id: unknown,
): Promise<ActionResult<ContractRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin hợp đồng", [
      { path: "id", message: "Không xác định được hợp đồng cần bỏ lưu trữ" },
    ]);
  }

  return fromService(await unarchiveContract(id));
}

/**
 * AI Contract Extractor — trích xuất tự động thông tin từ tệp PDF/ảnh bằng Google Gemini.
 */
export async function extractContractAction(
  formData: FormData,
): Promise<ActionResult<ExtractedContractResult>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const objectKey = formData.get("objectKey");
  let buffer: Buffer;
  let filename = "document.pdf";
  let mimeType = "application/pdf";

  if (typeof objectKey === "string" && objectKey.length > 0) {
    const expectedPrefix = `ai-temp/${access.user.organizationId}/`;
    if (!objectKey.startsWith(expectedPrefix)) {
      return validationFailure("objectKey không hợp lệ", [
        { path: "objectKey", message: "Tệp không thuộc tổ chức của bạn" },
      ]);
    }

    const downloaded = await getObjectBuffer(objectKey);
    await deleteObject(objectKey).catch(() => {});

    if (!downloaded) {
      return validationFailure("Không tìm thấy tệp", [
        { path: "objectKey", message: "Không thể đọc tệp từ kho lưu trữ đám mây" },
      ]);
    }

    buffer = downloaded;
    filename = (formData.get("filename") as string) || "document.pdf";
    mimeType = (formData.get("mimeType") as string) || "application/pdf";
  } else {
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return validationFailure("Tệp không hợp lệ", [
        { path: "file", message: "Vui lòng chọn tệp hợp đồng để trích xuất" },
      ]);
    }

    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    filename = file.name;
    mimeType = file.type;
  }

  const extractionResult = await extractContractFromBuffer({
    buffer,
    mimeType,
    filename,
  });

  if (!extractionResult.ok) {
    return fromService(extractionResult);
  }

  const extracted = extractionResult.data;

  // Phân định quy cách rõ ràng giữa Công ty nội bộ (HRP / HR VN) và Đối tác:
  // Nếu thấy 1 trong 2 công ty của chúng ta (bất kể hợp đồng ghi Bên A hay Bên B) -> điền vào companyName.
  // Bên còn lại là công ty khác -> đó chính là partnerName!
  const reconciled = reconcileContractParties({
    partnerName: extracted.partnerName,
    companyName: extracted.companyName,
  });
  extracted.partnerName = reconciled.partnerName;
  extracted.companyName = reconciled.companyName;

  // Tìm kiếm đối tác và công ty tương đồng trong tổ chức hiện tại
  const searchTerm = extracted.partnerName ? cleanEntityName(extracted.partnerName) : "";
  let partnersRes = await searchPartners(searchTerm);
  if ((!partnersRes.ok || partnersRes.data.length === 0) && searchTerm !== "") {
    partnersRes = await searchPartners("");
  }
  const companiesRes = await listCompanies({
    organizationId: access.user.organizationId,
  });

  const partners = partnersRes.ok ? partnersRes.data : [];
  const companies = companiesRes.ok ? companiesRes.data : [];

  let matchedPartner = findBestMatchingPartner(extracted.partnerName, partners);
  const matchedCompany = findBestMatchingCompany(extracted.companyName, companies);

  let isNewPartner = false;
  const trimmedPartnerName = extracted.partnerName?.trim() ?? "";

  // Nếu trong danh bạ chưa có đối tác này, AI đọc được tên đối tác và TUYỆT ĐỐI không phải công ty nội bộ:
  // Tự động tạo mới đối tác vào hệ thống
  if (
    !matchedPartner &&
    trimmedPartnerName.length > 0 &&
    !isInternalCompany(trimmedPartnerName)
  ) {
    const targetCompanyIds = matchedCompany?.id
      ? [matchedCompany.id]
      : companies.length > 0
        ? [companies[0].id]
        : [];

    if (targetCompanyIds.length > 0) {
      let taxCode = extracted.partnerTaxCode?.trim() || "";
      if (!/^\d{10}(-\d{3})?$/.test(taxCode)) {
        taxCode = "";
      }

      let createRes = await createPartner(
        {
          name: trimmedPartnerName,
          taxCode: taxCode || undefined,
          address: extracted.partnerAddress?.trim() || undefined,
          companyIds: targetCompanyIds,
        },
        { organizationId: access.user.organizationId },
      );

      // Nếu tạo với taxCode/address bị lỗi, fallback tạo với name + companyIds
      if (!createRes.ok) {
        createRes = await createPartner(
          {
            name: trimmedPartnerName,
            companyIds: targetCompanyIds,
          },
          { organizationId: access.user.organizationId },
        );
      }

      if (createRes.ok) {
        matchedPartner = {
          id: createRes.data.id,
          name: createRes.data.name,
        };
        isNewPartner = true;
      }
    }
  }

  const duplicate = extracted.contractNumber
    ? await findDuplicateContract({
        contractNumber: extracted.contractNumber,
        signedDate: extracted.signedDate,
        expiryDate: extracted.expiryDate,
        organizationId: access.user.organizationId,
      })
    : null;

  const result: ExtractedContractResult = {
    ...extracted,
    matchedPartnerId: matchedPartner?.id ?? null,
    matchedPartnerName: matchedPartner?.name ?? null,
    matchedCompanyId: matchedCompany?.id ?? null,
    matchedCompanyName: matchedCompany?.name ?? null,
    isNewPartner,
    isDuplicate: Boolean(duplicate),
    duplicateContractId: duplicate?.id ?? null,
  };

  return {
    ok: true,
    data: result,
  };
}

/**
 * Checks whether an active contract with the given number, signed date,
 * and expiry date already exists in the organization.
 */
export async function checkDuplicateContractAction(input: {
  contractNumber?: string | null;
  signedDate?: string | null;
  expiryDate?: string | null;
}): Promise<ActionResult<{ isDuplicate: boolean; contractId: string | null }>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const duplicate = await findDuplicateContract({
    contractNumber: input.contractNumber,
    signedDate: input.signedDate,
    expiryDate: input.expiryDate,
    organizationId: access.user.organizationId,
  });

  return {
    ok: true,
    data: {
      isDuplicate: Boolean(duplicate),
      contractId: duplicate?.id ?? null,
    },
  };
}
