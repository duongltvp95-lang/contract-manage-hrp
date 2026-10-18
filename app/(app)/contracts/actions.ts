"use server";

import { after } from "next/server";

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
import {
  completeUpload,
  deleteContractFile,
  type ContractFileRow,
} from "@/lib/services/files";
import { deleteObject, getObjectBuffer, headObject } from "@/lib/r2/objects";
import {
  authorized,
  fromService,
  validationFailure,
  type ActionResult,
} from "@/lib/server-action";
import type { ExtractedContractResult } from "@schemas/contract";
import {
  ALLOWED_MIME_TYPES,
  extractContractFromBuffer,
  MAX_AI_FILE_SIZE_BYTES,
  resolveMimeType,
} from "@/lib/ai/gemini";
import { deleteGeminiFile, uploadToGeminiFiles } from "@/lib/ai/gemini-files";
import { aiLog } from "@/lib/ai/log";
import {
  cleanEntityName,
  findBestMatchingCompany,
  findBestMatchingPartner,
  isInternalCompany,
  normalizeDurationText,
  reconcileContractParties,
} from "@/lib/ai/matching";
import {
  findOrCreatePartnerForAi,
  listCompanies,
  searchPartners,
} from "@/lib/services/partners";

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

export async function deleteContractFileAction(
  fileId: unknown,
): Promise<ActionResult<{ id: string; contractId: string }>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof fileId !== "string" || fileId.length === 0) {
    return validationFailure("Thiếu thông tin tệp", [
      { path: "fileId", message: "Không xác định được tệp cần xoá" },
    ]);
  }

  return fromService(
    await deleteContractFile(fileId, access.user.organizationId),
  );
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

async function withIoAbort<T>(
  action: (signal: AbortSignal) => Promise<T>,
  maxMs: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("IO timeout"));
  }, Math.max(100, maxMs));

  try {
    return await action(controller.signal);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * AI Contract Extractor — trích xuất tự động thông tin từ tệp PDF/ảnh bằng Google Gemini.
 */
export async function extractContractAction(
  formData: FormData,
): Promise<ActionResult<ExtractedContractResult>> {
  const actionStartTime = Date.now();
  const TOTAL_ACTION_BUDGET_MS = 48_000; // 48s: chừa tối thiểu 12s biên an toàn trước 60s của Vercel
  const actionDeadline = actionStartTime + TOTAL_ACTION_BUDGET_MS;

  // G2 v2: khai báo ngoài try để finally có thể truy cập cleanup.
  let geminiFileName: string | null = null;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const objectKey = formData.get("objectKey");

  try {
    const authTimeoutMs = Math.min(5_000, Math.max(1_000, actionDeadline - Date.now() - 40_000));
    const access = await authorized({ timeoutMs: authTimeoutMs });
    if (!access.ok) return access.result;

    const cleanupR2 = (key: string) => {
      // Đăng ký tác vụ nền với Next.js after() / Vercel lifecycle để bảo đảm
      // function không bị đóng băng trước khi lệnh xóa R2 hoàn tất, đồng thời
      // tuyệt đối không chặn luồng trả về kết quả cho client.
      try {
        after(async () => {
          await deleteObject(key, { timeoutMs: 5_000 }).catch(() => {});
        });
      } catch {
        void deleteObject(key, { timeoutMs: 5_000 }).catch(() => {});
      }
    };

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

      if (actionDeadline - Date.now() < 12_000) {
        cleanupR2(objectKey);
        return validationFailure("Hệ thống hết thời gian xử lý", [
          {
            path: "file",
            message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
          },
        ]);
      }

      // Kiểm tra Content-Length thực tế bằng HEAD trước khi tải toàn bộ object vào bộ nhớ
      const headTimeoutMs = Math.min(5_000, Math.max(1_000, actionDeadline - Date.now() - 15_000));
      const head = await headObject(objectKey, { timeoutMs: headTimeoutMs });
      if (!head.exists || head.contentLength === null) {
        cleanupR2(objectKey);
        return validationFailure("Không tìm thấy tệp", [
          { path: "objectKey", message: "Không thể đọc tệp từ kho lưu trữ đám mây" },
        ]);
      }

      if (head.contentLength > MAX_AI_FILE_SIZE_BYTES) {
        cleanupR2(objectKey);
        return validationFailure("Dung lượng tệp quá lớn", [
          {
            path: "file",
            message: "Dung lượng tệp vượt quá giới hạn 20 MB cho phép đối với phân tích AI.",
          },
        ]);
      }

      // Kiểm tra lại ngân sách trước khi bắt đầu tải toàn bộ buffer từ R2
      if (actionDeadline - Date.now() < 12_000) {
        cleanupR2(objectKey);
        return validationFailure("Hệ thống hết thời gian xử lý", [
          {
            path: "file",
            message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
          },
        ]);
      }

      const downloadTimeoutMs = Math.min(10_000, Math.max(1_000, actionDeadline - Date.now() - 10_000));
      const downloaded = await getObjectBuffer(objectKey, { timeoutMs: downloadTimeoutMs });
      cleanupR2(objectKey);

      if (!downloaded) {
        return validationFailure("Không tìm thấy tệp", [
          { path: "objectKey", message: "Không thể đọc tệp từ kho lưu trữ đám mây" },
        ]);
      }

      // Kiểm tra lại ngân sách ngay sau khi tải xong tệp từ R2
      if (actionDeadline - Date.now() < 10_000) {
        return validationFailure("Hệ thống hết thời gian xử lý", [
          {
            path: "file",
            message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
          },
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

      // Kiểm tra kích thước trước khi convert sang ArrayBuffer trong bộ nhớ
      if (file.size > MAX_AI_FILE_SIZE_BYTES) {
        return validationFailure("Dung lượng tệp quá lớn", [
          {
            path: "file",
            message: "Dung lượng tệp vượt quá giới hạn 20 MB cho phép đối với phân tích AI.",
          },
        ]);
      }

      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      filename = file.name;
      mimeType = file.type;
    }

    // Kiểm tra định dạng tệp trước khi upload lên Gemini Files API
    const resolvedMime = resolveMimeType(filename, mimeType);
    if (!ALLOWED_MIME_TYPES.has(resolvedMime)) {
      return validationFailure("Định dạng tệp không được hỗ trợ", [
        {
          path: "file",
          message: `Định dạng tệp (${resolvedMime || "không rõ"}) chưa được hỗ trợ. AI chỉ hỗ trợ PDF hoặc hình ảnh (PNG, JPG, WebP).`,
        },
      ]);
    }

    // Tính toán ngân sách thời gian còn lại cho khâu AI
    // Dành 5 giây cuối cho DB partner search và cleanup
    const remainingAiBudgetMs = actionDeadline - Date.now() - 5_000;
    if (remainingAiBudgetMs < 6_000) {
      return validationFailure("Hệ thống hết thời gian xử lý", [
        {
          path: "file",
          message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
        },
      ]);
    }

    // Chọn chiến lược gửi cho Gemini theo dung lượng:
    // - Tệp >= 2 MB: Tải lên Gemini Files API để tránh body base64 quá lớn làm nghẽn mạng/timeout khi retry.
    // - Tệp < 2 MB: Bỏ qua Files API, gửi trực tiếp (hoặc qua text layer PDF) để tiết kiệm 2 lượt mạng (upload + delete).
    const FILES_API_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2 MB
    let geminiFileUri: string | null = null;
    if (apiKey && buffer.length >= FILES_API_THRESHOLD_BYTES) {
      const uploadRes = await uploadToGeminiFiles({
        buffer,
        mimeType,
        filename,
        apiKey,
        timeoutMs: Math.min(10_000, Math.floor(remainingAiBudgetMs / 2)),
      });
      if (uploadRes.ok) {
        geminiFileName = uploadRes.data.name;
        geminiFileUri = uploadRes.data.uri;
      } else {
        // Upload fail (quota, network, 5xx) → fallback về inlineData base64.
        // Vẫn có thể trích xuất được, chỉ chậm hơn.
        aiLog.warn("Upload Gemini Files fail, fallback inlineData", {
          filename,
          errorMessage: uploadRes.message,
        });
      }
    }

    const remainingExtractBudgetMs = actionDeadline - Date.now() - 5_000;
    if (remainingExtractBudgetMs < 6_000) {
      if (geminiFileName && apiKey) {
        const fileToDelete = geminiFileName;
        geminiFileName = null;
        await deleteGeminiFile(fileToDelete, apiKey);
      }
      return validationFailure("Hệ thống hết thời gian xử lý", [
        {
          path: "file",
          message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
        },
      ]);
    }

    const extractionResult = await extractContractFromBuffer({
      buffer,
      mimeType,
      filename,
      geminiFileName: geminiFileUri ? geminiFileName ?? undefined : undefined,
      geminiFileUri: geminiFileUri ?? undefined,
      remainingBudgetMs: remainingExtractBudgetMs,
    });

    // Dọn dẹp tệp Gemini NGAY LẬP TỨC sau khi trích xuất xong (không chờ các bước DB phía sau)
    if (geminiFileName && apiKey) {
      const fileToDelete = geminiFileName;
      geminiFileName = null; // Tránh dọn dẹp lặp lại ở finally
      await deleteGeminiFile(fileToDelete, apiKey);
    }

    if (!extractionResult.ok) {
      return fromService(extractionResult);
    }

    const extracted = extractionResult.data;

    // Chuẩn hóa thời hạn hợp đồng thành số tháng hoặc năm (ví dụ: "6 tháng", "1 năm", "2 năm")
    extracted.durationText = normalizeDurationText({
      durationText: extracted.durationText,
      signedDate: extracted.signedDate,
      expiryDate: extracted.expiryDate,
    });

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
    let matchedPartner: { id: string; name: string } | null = null;
    let matchedCompany: { id: string; name: string } | null = null;
    let isNewPartner = false;
    let duplicate: Awaited<ReturnType<typeof findDuplicateContract>> = null;

    // Chỉ thực hiện các truy vấn DB bổ sung nếu ngân sách còn ít nhất 3 giây
    if (actionDeadline - Date.now() >= 3_000) {
      const searchTerm = extracted.partnerName ? cleanEntityName(extracted.partnerName) : "";
      const remainingForDb = actionDeadline - Date.now() - 1_000;
      const partnerTimeout = Math.min(2_000, Math.max(300, Math.floor(remainingForDb / 3)));

      let partnersRes = await withIoAbort(
        (signal) => searchPartners(searchTerm, { abortSignal: signal }),
        partnerTimeout,
        { ok: false } as Awaited<ReturnType<typeof searchPartners>>,
      );

      if (
        (!partnersRes.ok || partnersRes.data.length === 0) &&
        searchTerm !== "" &&
        actionDeadline - Date.now() >= 2_500
      ) {
        partnersRes = await withIoAbort(
          (signal) => searchPartners("", { abortSignal: signal }),
          partnerTimeout,
          { ok: false } as Awaited<ReturnType<typeof searchPartners>>,
        );
      }

      const companiesRes =
        actionDeadline - Date.now() >= 2_000
          ? await withIoAbort(
              (signal) =>
                listCompanies(
                  { organizationId: access.user.organizationId },
                  { abortSignal: signal },
                ),
              partnerTimeout,
              { ok: false } as Awaited<ReturnType<typeof listCompanies>>,
            )
          : ({ ok: false } as Awaited<ReturnType<typeof listCompanies>>);

      const partners = partnersRes.ok ? partnersRes.data : [];
      const companies = companiesRes.ok ? companiesRes.data : [];

      matchedPartner = findBestMatchingPartner(extracted.partnerName, partners);
      matchedCompany = findBestMatchingCompany(extracted.companyName, companies);

      const trimmedPartnerName = extracted.partnerName?.trim() ?? "";

      // Idempotency: nếu fuzzy match chưa khớp nhưng danh sách đã có đối tác cùng tên chính xác
      if (!matchedPartner && trimmedPartnerName.length > 0) {
        const exactMatch = partners.find(
          (p) => p.name.trim().toLowerCase() === trimmedPartnerName.toLowerCase(),
        );
        if (exactMatch) {
          matchedPartner = { id: exactMatch.id, name: exactMatch.name };
        }
      }

      // Nếu trong danh bạ chưa có đối tác này, AI đọc được tên đối tác và TUYỆT ĐỐI không phải công ty nội bộ:
      // Tự động tìm hoặc tạo mới đối tác với cơ chế nguyên tử (Postgres advisory lock + in-process mutex)
      // nếu vẫn còn ít nhất 4.0s trước deadline.
      if (
        !matchedPartner &&
        trimmedPartnerName.length > 0 &&
        !isInternalCompany(trimmedPartnerName) &&
        actionDeadline - Date.now() >= 4_000
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

          const createBudgetMs = Math.min(2_500, Math.max(1_000, actionDeadline - Date.now() - 1_500));
          const aiPartnerRes = await findOrCreatePartnerForAi(
            {
              name: trimmedPartnerName,
              taxCode: taxCode || undefined,
              address: extracted.partnerAddress?.trim() || undefined,
              companyIds: targetCompanyIds,
            },
            { organizationId: access.user.organizationId },
            { abortSignal: AbortSignal.timeout(createBudgetMs) },
          );

          if (aiPartnerRes.ok) {
            matchedPartner = {
              id: aiPartnerRes.data.id,
              name: aiPartnerRes.data.name,
            };
            isNewPartner = aiPartnerRes.data.isNew;
          }
        }
      }

      if (extracted.contractNumber && actionDeadline - Date.now() >= 1_500) {
        duplicate = await withIoAbort(
          (signal) =>
            findDuplicateContract(
              {
                contractNumber: extracted.contractNumber,
                signedDate: extracted.signedDate,
                expiryDate: extracted.expiryDate,
                organizationId: access.user.organizationId,
              },
              { abortSignal: signal },
            ),
          1_000,
          null,
        );
      }
    }

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
  } catch (error) {
    aiLog.error("extractContractAction thất bại", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      code: "internal_error",
      message:
        error instanceof Error
          ? error.message
          : "Hệ thống gặp sự cố trong quá trình phân tích tài liệu bằng AI.",
    };
  } finally {
    // G2 v2: cleanup Gemini file tạm sau khi extract xong (dù thành công hay fail).
    // File Gemini có TTL 48h → xoá ngay để tránh tốn quota.
    if (geminiFileName && apiKey) {
      await deleteGeminiFile(geminiFileName, apiKey);
    }
  }
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
