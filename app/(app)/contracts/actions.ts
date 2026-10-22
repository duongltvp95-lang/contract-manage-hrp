"use server";

import { after } from "next/server";

import {
  AI_GEMINI_FILES_API_MIN_BYTES,
  CompleteUploadSchema,
  normalizeContractNumber,
  type FileKind,
  type CompleteUploadInput,
  hasAppendixKeyword,
} from "@schemas/file";

import {
  archiveContract,
  createContract,
  deleteContract,
  deleteContracts,
  findBaseContractByNumber,
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
import { canDeleteEntities } from "@/lib/delete-permissions";
import { err } from "@/lib/services/types";
import type {
  ExtractedContract,
  ExtractedContractResult,
  MatchedBaseContract,
} from "@schemas/contract";
import {
  ALLOWED_MIME_TYPES,
  extractContractFromBuffer,
  MAX_AI_FILE_SIZE_BYTES,
  MAX_AI_FILE_SIZE_MB,
  resolveMimeType,
} from "@/lib/ai/gemini";
import { deleteGeminiFile, uploadToGeminiFiles } from "@/lib/ai/gemini-files";
import { aiLog } from "@/lib/ai/log";
import { consumeRateLimit } from "@/lib/rate-limit";
import { rateLimitMessage } from "@/lib/rate-limit-policy";
import {
  calculateExpiryDateFromDuration,
  cleanEntityName,
  findBestMatchingCompany,
  findBestMatchingPartner,
  normalizeDurationText,
  reconcileContractParties,
} from "@/lib/ai/matching";
import {
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
  uploadIntents: unknown,
): Promise<ActionResult<ContractRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (!Array.isArray(uploadIntents)) {
    return validationFailure("Không thể xác nhận loại tệp cần lưu", [
      { path: "files", message: "Vui lòng tải lại biểu mẫu rồi thử lại" },
    ]);
  }

  const parsedIntents: Array<{
    kind: FileKind;
    aiDocumentType: FileKind | null;
    baseContractNumber: string;
    aiContractNumber: string;
    matchedBaseContractId: string;
    filename: string;
    isAppendix: boolean;
  }> = [];

  for (const intent of uploadIntents) {
    if (!intent || typeof intent !== "object") {
      return validationFailure("Thông tin tệp không hợp lệ", [
        { path: "files", message: "Vui lòng tải lại tệp rồi thử lại" },
      ]);
    }

    const candidate = intent as Record<string, unknown>;
    const kind = candidate.kind;
    const aiDocumentType = candidate.aiDocumentType;
    if (
      (kind !== "document" && kind !== "appendix") ||
      (aiDocumentType !== undefined && aiDocumentType !== null &&
        aiDocumentType !== "document" && aiDocumentType !== "appendix")
    ) {
      return validationFailure("Thông tin phân loại tệp không hợp lệ", [
        { path: "files", message: "Vui lòng tải lại tệp rồi thử lại" },
      ]);
    }

    const filename = typeof candidate.filename === "string" ? candidate.filename.trim() : "";
    const baseContractNumber = typeof candidate.baseContractNumber === "string"
      ? candidate.baseContractNumber.trim()
      : "";
    const aiContractNumber = typeof candidate.aiContractNumber === "string"
      ? candidate.aiContractNumber.trim()
      : "";
    const matchedBaseContractId = typeof candidate.matchedBaseContractId === "string"
      ? candidate.matchedBaseContractId
      : "";

    // FAIL-CLOSED: Nhận diện phụ lục không chỉ qua intent.kind do trình duyệt gửi.
    // Nếu tệp có từ khoá phụ lục trong tên tệp HOẶC có số HĐ gốc,
    // hoặc người dùng/AI đã đánh dấu là phụ lục -> BẮT BUỘC coi là phụ lục.
    const isAppendix =
      kind === "appendix" ||
      aiDocumentType === "appendix" ||
      hasAppendixKeyword(filename) ||
      Boolean(baseContractNumber) ||
      Boolean(matchedBaseContractId);

    parsedIntents.push({
      kind: isAppendix ? "appendix" : "document",
      aiDocumentType: aiDocumentType === "document" || aiDocumentType === "appendix"
        ? aiDocumentType
        : null,
      baseContractNumber,
      aiContractNumber,
      matchedBaseContractId,
      filename,
      isAppendix,
    });
  }

  const appendixIntents = parsedIntents.filter((intent) => intent.isAppendix);
  if (appendixIntents.length > 0) {
    const mainIntents = parsedIntents.filter((intent) => !intent.isAppendix);
    if (mainIntents.length === 0) {
      return validationFailure(
        "Không thể lưu hợp đồng khi chưa có hợp đồng gốc được tải lên hệ thống từ trước. Vui lòng tải lên và tạo hợp đồng gốc trước.",
        [{ path: "files", message: "Phụ lục không thể tạo hồ sơ hợp đồng độc lập khi chưa có hợp đồng gốc" }],
      );
    }

    const values = input && typeof input === "object"
      ? input as Record<string, unknown>
      : {};
    const formContractNumber = normalizeContractNumber(
      typeof values.contractNumber === "string" ? values.contractNumber : "",
    );

    for (const appendix of appendixIntents) {
      const baseNumber = appendix.baseContractNumber;
      const normalizedBaseNumber = normalizeContractNumber(baseNumber);
      const hasMatchingMainFile = Boolean(
        normalizedBaseNumber &&
        parsedIntents.some((intent) =>
          !intent.isAppendix &&
          normalizeContractNumber(intent.aiContractNumber) === normalizedBaseNumber,
        ),
      );
      const existingBase = baseNumber
        ? await findBaseContractByNumber({
            contractNumber: baseNumber,
            organizationId: access.user.organizationId,
          })
        : null;

      if (appendix.matchedBaseContractId || existingBase) {
        return validationFailure(
          `Phụ lục thuộc hợp đồng gốc${baseNumber ? ` số ${baseNumber}` : " đã có"} trên hệ thống. Hãy gán phụ lục trực tiếp vào hợp đồng đó.`,
          [{ path: "files", message: "Không tạo hồ sơ mới từ phụ lục của hợp đồng đã tồn tại" }],
        );
      }

      if (
        !baseNumber ||
        !hasMatchingMainFile ||
        !formContractNumber ||
        formContractNumber !== normalizedBaseNumber
      ) {
        return validationFailure(
          "Không thể lưu phụ lục khi chưa có hợp đồng gốc tương ứng được tải lên từ trước. Hãy tải lên và tạo hợp đồng gốc trước khi lưu.",
          [{ path: "files", message: "Phụ lục cần một tệp hợp đồng chính có số hợp đồng khớp" }],
        );
      }
    }
  }

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
  const access = await authorized({ timeoutMs: 5_000 });
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
    userEmail: access.user.email,
    contractId: payload.contractId,
    fileId: payload.fileId,
    objectKey: payload.objectKey,
    uploadReservation: payload.uploadReservation,
    filename: payload.filename,
    mimeType: payload.mimeType,
    fileSize: payload.fileSize,
    kind: payload.kind,
    baseContractNumber: payload.baseContractNumber,
  });

  return fromService(result);
}

export async function deleteContractFileAction(
  fileId: unknown,
): Promise<ActionResult<{ id: string; contractId: string }>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (!canDeleteEntities(access.user.email)) {
    return fromService(err("forbidden", "Không có quyền xoá tệp hợp đồng"));
  }

  if (typeof fileId !== "string" || fileId.length === 0) {
    return validationFailure("Thiếu thông tin tệp", [
      { path: "fileId", message: "Không xác định được tệp cần xoá" },
    ]);
  }

  return fromService(
    await deleteContractFile(fileId, access.user.organizationId, access.user.email),
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

async function measureAiStage<T>(
  traceId: string,
  stage: string,
  action: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  let outcome: "ok" | "error" = "ok";
  try {
    const result = await action();
    if (
      typeof result === "object" &&
      result !== null &&
      "ok" in result &&
      result.ok === false
    ) {
      outcome = "error";
    }
    return result;
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    aiLog.info("Giai đoạn AI hoàn tất", {
      traceId,
      stage,
      outcome,
      elapsedMs: Date.now() - startedAt,
      ...context,
    });
  }
}

/**
 * AI Contract Extractor — trích xuất tự động thông tin từ tệp PDF/ảnh bằng Google Gemini.
 */
export async function extractContractAction(
  formData: FormData,
): Promise<ActionResult<ExtractedContractResult>> {
  const actionStartTime = Date.now();
  const requestedTraceId = formData.get("traceId");
  const traceId =
    typeof requestedTraceId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedTraceId)
      ? requestedTraceId
      : crypto.randomUUID();
  const TOTAL_ACTION_BUDGET_MS = 48_000; // 48s: chừa tối thiểu 12s biên an toàn trước 60s của Vercel
  const actionDeadline = actionStartTime + TOTAL_ACTION_BUDGET_MS;
  let actionStatus: "success" | "returned_error" = "returned_error";
  let inputSizeBytes: number | null = null;
  const source = typeof formData.get("objectKey") === "string" ? "r2" : "server-action";

  aiLog.info("Bắt đầu trích xuất hợp đồng", { traceId, source });

  // G2 v2: khai báo ngoài try để finally có thể truy cập cleanup & metrics thống kê.
  let geminiFileName: string | null = null;
  let geminiFileUri: string | null = null;
  let r2KeyToClean: string | null = null;
  let extractedData: ExtractedContract | null = null;
  let preExtractedPdfTextLength: number | null = null;
  let pdfTextExtractionAttempted = false;
  let pdfTextCharacters: number | null = null;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const objectKey = formData.get("objectKey");

  const cleanupR2 = (key: string) => {
    // Đăng ký dọn tệp tạm sau khi phản hồi để không kéo dài thời gian AI.
    try {
      after(async () => {
        await deleteObject(key, { timeoutMs: 5_000 }).catch(() => {});
      });
    } catch {
      void deleteObject(key, { timeoutMs: 5_000 }).catch(() => {});
    }
  };

  const triggerR2Cleanup = (key: string) => {
    if (r2KeyToClean === key) {
      r2KeyToClean = null;
    }
    cleanupR2(key);
  };

  try {
    const authTimeoutMs = Math.min(5_000, Math.max(1_000, actionDeadline - Date.now() - 40_000));
    const access = await authorized({ timeoutMs: authTimeoutMs });
    if (!access.ok) return access.result;

    const ownedObjectKey =
      typeof objectKey === "string" &&
      objectKey.startsWith(`ai-temp/${access.user.organizationId}/`)
        ? objectKey
        : null;
    if (ownedObjectKey) {
      r2KeyToClean = ownedObjectKey;
    }
    const rateLimitTimeoutMs = Math.min(
      3_000,
      Math.max(500, actionDeadline - Date.now() - 10_000),
    );
    const rateLimit = await measureAiStage(
      traceId,
      "rate_limit",
      () =>
        consumeRateLimit("ai:extract", {
          abortSignal: AbortSignal.timeout(rateLimitTimeoutMs),
        }),
    );
    if (!rateLimit.ok) {
      if (ownedObjectKey) triggerR2Cleanup(ownedObjectKey);
      aiLog.error("Không kiểm tra được giới hạn trích xuất AI; từ chối yêu cầu", {
        traceId,
        errorMessage: rateLimit.message,
      });
      return {
        ok: false,
        code: "rate_limit_unavailable",
        message: "Dịch vụ giới hạn tần suất tạm thời không khả dụng, vui lòng thử lại sau.",
      };
    }
    if (!rateLimit.data.allowed) {
      if (ownedObjectKey) triggerR2Cleanup(ownedObjectKey);
      return {
        ok: false,
        code: "rate_limited",
        message: rateLimitMessage(rateLimit.data),
      };
    }

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
        triggerR2Cleanup(objectKey);
        return validationFailure("Hệ thống hết thời gian xử lý", [
          {
            path: "file",
            message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
          },
        ]);
      }

      // Kiểm tra Content-Length thực tế bằng HEAD trước khi tải toàn bộ object vào bộ nhớ
      const headTimeoutMs = Math.min(5_000, Math.max(1_000, actionDeadline - Date.now() - 15_000));
      const head = await measureAiStage(
        traceId,
        "r2_head",
        () => headObject(objectKey, { timeoutMs: headTimeoutMs }),
      );
      if (!head.exists || head.contentLength === null) {
        triggerR2Cleanup(objectKey);
        return validationFailure("Không tìm thấy tệp", [
          { path: "objectKey", message: "Không thể đọc tệp từ kho lưu trữ đám mây" },
        ]);
      }

      if (head.contentLength > MAX_AI_FILE_SIZE_BYTES) {
        triggerR2Cleanup(objectKey);
        return validationFailure("Dung lượng tệp quá lớn", [
          {
            path: "file",
            message: `Dung lượng tệp vượt quá giới hạn ${MAX_AI_FILE_SIZE_MB} MB cho phép đối với phân tích AI.`,
          },
        ]);
      }

      // Kiểm tra lại ngân sách trước khi bắt đầu tải toàn bộ buffer từ R2
      if (actionDeadline - Date.now() < 12_000) {
        triggerR2Cleanup(objectKey);
        return validationFailure("Hệ thống hết thời gian xử lý", [
          {
            path: "file",
            message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
          },
        ]);
      }

      const downloadTimeoutMs = Math.min(18_000, Math.max(1_000, actionDeadline - Date.now() - 12_000));
      const downloaded = await measureAiStage(
        traceId,
        "r2_download",
        () => getObjectBuffer(objectKey, { timeoutMs: downloadTimeoutMs }),
      );
      triggerR2Cleanup(objectKey);

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
      inputSizeBytes = buffer.length;
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
            message: `Dung lượng tệp vượt quá giới hạn ${MAX_AI_FILE_SIZE_MB} MB cho phép đối với phân tích AI.`,
          },
        ]);
      }

      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      inputSizeBytes = buffer.length;
      filename = file.name;
      mimeType = file.type;
    }

    // Kiểm tra định dạng tệp trước khi upload lên Gemini Files API
    const resolvedMime = resolveMimeType(filename, mimeType);
    const clientR2UploadValue = formData.get("clientR2UploadMs");
    const rawClientR2UploadMs =
      typeof clientR2UploadValue === "string" ? Number(clientR2UploadValue) : Number.NaN;
    const clientR2UploadMs =
      Number.isFinite(rawClientR2UploadMs) &&
      rawClientR2UploadMs >= 0 &&
      rawClientR2UploadMs <= 300_000
        ? rawClientR2UploadMs
        : undefined;
    aiLog.info("Tệp AI đã được nhận", {
      traceId,
      sizeBytes: inputSizeBytes,
      mimeType: resolvedMime,
      source,
      clientR2UploadMs,
    });
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

    // Thử trích xuất nhanh lớp văn bản PDF trước.
    // Với các tệp PDF có text layer (kể cả >= 2 MB), việc trích xuất văn bản cục bộ
    // chỉ mất ~100-300ms và cho phép gửi văn bản trực tiếp cho Gemini, tránh hoàn toàn
    // việc upload tệp lớn lên Gemini Files API (tiết kiệm 5-15s và quota mạng).
    let preExtractedPdfText: string | null = null;
    if (resolvedMime === "application/pdf") {
      const pdfBudget = Math.min(1_200, Math.max(500, remainingAiBudgetMs - 8_000));
      if (pdfBudget >= 800) {
        try {
          const { extractPdfText, isUsableContractPdfText } = await import("@/lib/ai/pdf-text");
          pdfTextExtractionAttempted = true;
          const pdfResult = await measureAiStage(
            traceId,
            "pdf_text_extract",
            () =>
              extractPdfText(buffer, pdfBudget, {
                maxPages: 10,
                maxCharacters: 12_000,
              }),
            { sizeBytes: buffer.length },
          );
          pdfTextCharacters = pdfResult?.text.length ?? null;
          if (pdfResult && isUsableContractPdfText(pdfResult.text, { isTruncated: pdfResult.isTruncated })) {
            preExtractedPdfText = pdfResult.text;
            preExtractedPdfTextLength = pdfResult.text.length;
            aiLog.info("Đã đọc trước lớp văn bản PDF, bỏ qua Gemini Files API", {
              traceId,
              textCharacters: pdfResult.text.length,
              pageCount: pdfResult.pageCount,
              sizeBytes: buffer.length,
            });
          }
        } catch (pdfErr) {
          aiLog.warn("Đọc trước lớp văn bản PDF không thành công, tiếp tục quy trình chuẩn", {
            traceId,
            errorName: pdfErr instanceof Error ? pdfErr.name : "UnknownError",
          });
        }
      }
    }

    // Các tệp lớn không có text layer (ảnh lớn hoặc PDF scan) dùng Files API;
    // lỗi upload trả về ngay thay vì âm thầm gửi body base64 lớn.
    if (apiKey && !preExtractedPdfText && buffer.length >= AI_GEMINI_FILES_API_MIN_BYTES) {
      const uploadRes = await measureAiStage(
        traceId,
        "gemini_files_upload",
        () =>
          uploadToGeminiFiles({
            buffer,
            mimeType,
            filename,
            apiKey,
            traceId,
            timeoutMs: Math.min(
              20_000,
              Math.max(1_000, remainingAiBudgetMs - 6_000),
            ),
          }),
        { sizeBytes: buffer.length },
      );
      if (uploadRes.ok) {
        geminiFileName = uploadRes.data.name;
        geminiFileUri = uploadRes.data.uri;
      } else {
        aiLog.error("Không upload được tệp lớn lên Gemini Files", {
          traceId,
          sizeBytes: buffer.length,
          mimeType,
          errorMessage: uploadRes.message,
        });
        return {
          ok: false,
          code: uploadRes.code,
          message: uploadRes.message,
          issues: uploadRes.issues,
        };
      }
    }

    const remainingExtractBudgetMs = actionDeadline - Date.now() - 5_000;
    if (remainingExtractBudgetMs < 6_000) {
      return validationFailure("Hệ thống hết thời gian xử lý", [
        {
          path: "file",
          message: "Quá thời gian xử lý cho phép của hệ thống. Vui lòng thử lại với tệp tài liệu ngắn hơn.",
        },
      ]);
    }

    const extractionResult = await measureAiStage(
      traceId,
      "gemini_extract",
      () =>
        extractContractFromBuffer({
          buffer,
          mimeType,
          filename,
          geminiFileName: geminiFileUri ? geminiFileName ?? undefined : undefined,
          geminiFileUri: geminiFileUri ?? undefined,
          pdfText: preExtractedPdfText ?? undefined,
          pdfTextAttempted: pdfTextExtractionAttempted,
          remainingBudgetMs: remainingExtractBudgetMs,
          traceId,
        }),
      { sizeBytes: buffer.length, mimeType: resolvedMime },
    );

    if (!extractionResult.ok) {
      return fromService(extractionResult);
    }

    const extracted = extractionResult.data;
    extractedData = extracted;

    // Chuẩn hóa thời hạn hợp đồng thành số tháng hoặc năm (ví dụ: "6 tháng", "1 năm", "2 năm")
    extracted.durationText = normalizeDurationText({
      durationText: extracted.durationText,
      signedDate: extracted.signedDate,
      expiryDate: extracted.expiryDate,
    });

    // Tự động tính ngày hết hạn nếu thiếu nhưng có ngày ký và thời hạn
    if (!extracted.expiryDate && extracted.signedDate && extracted.durationText) {
      extracted.expiryDate = calculateExpiryDateFromDuration(
        extracted.signedDate,
        extracted.durationText,
      );
    }

    // Phân định quy cách rõ ràng giữa Công ty nội bộ (HRP / HR VN) và Đối tác:
    // Nếu thấy 1 trong 2 công ty của chúng ta (bất kể hợp đồng ghi Bên A hay Bên B) -> điền vào companyName.
    // Bên còn lại là công ty khác -> đó chính là partnerName!
    const reconciled = reconcileContractParties({
      partnerName: extracted.partnerName,
      companyName: extracted.companyName,
    });
    extracted.partnerName = reconciled.partnerName;
    extracted.companyName = reconciled.companyName;

    // Tìm các dữ liệu tham chiếu độc lập song song. Không tạo partner tại đây:
    // việc tạo chỉ xảy ra sau khi người dùng chủ động xác nhận trong form.
    let matchedPartner: { id: string; name: string } | null = null;
    let matchedCompany: { id: string; name: string } | null = null;
    let duplicate: Awaited<ReturnType<typeof findDuplicateContract>> = null;
    let matchedBaseContract: MatchedBaseContract | null = null;

    const searchTerm = extracted.partnerName ? cleanEntityName(extracted.partnerName) : "";
    const baseContractTarget =
      extracted.baseContractNumber ||
      (extracted.documentType === "appendix" ? extracted.contractNumber : "");
    const remainingForDb = actionDeadline - Date.now() - 1_000;
    if (remainingForDb >= 500) {
      const lookupTimeoutMs = Math.min(1_500, remainingForDb);
      const [partnersRes, companiesRes, duplicateResult, baseContractResult] = await measureAiStage(
        traceId,
        "db_enrichment",
        () => Promise.all([
          searchTerm
            ? withIoAbort(
                (signal) => searchPartners(searchTerm, { abortSignal: signal }),
                lookupTimeoutMs,
                { ok: false } as Awaited<ReturnType<typeof searchPartners>>,
              )
            : Promise.resolve({ ok: false } as Awaited<ReturnType<typeof searchPartners>>),
          withIoAbort(
            (signal) =>
              listCompanies(
                { organizationId: access.user.organizationId },
                { abortSignal: signal },
              ),
            lookupTimeoutMs,
            { ok: false } as Awaited<ReturnType<typeof listCompanies>>,
          ),
          extracted.documentType !== "appendix" && extracted.contractNumber
            ? withIoAbort(
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
                Math.min(1_000, lookupTimeoutMs),
                null,
              )
            : Promise.resolve(null),
          baseContractTarget
            ? withIoAbort(
                (signal) =>
                  findBaseContractByNumber(
                    {
                      contractNumber: baseContractTarget,
                      organizationId: access.user.organizationId,
                    },
                    { abortSignal: signal },
                  ),
                Math.min(1_000, lookupTimeoutMs),
                null,
              )
            : Promise.resolve(null),
        ]),
        { lookupTimeoutMs },
      );

      const partners = partnersRes.ok ? partnersRes.data : [];
      const companies = companiesRes.ok ? companiesRes.data : [];
      matchedPartner = findBestMatchingPartner(extracted.partnerName, partners);
      matchedCompany = findBestMatchingCompany(extracted.companyName, companies);
      duplicate = duplicateResult;
      matchedBaseContract = baseContractResult;
    }

    const result: ExtractedContractResult = {
      ...extracted,
      matchedPartnerId: matchedPartner?.id ?? null,
      matchedPartnerName: matchedPartner?.name ?? null,
      matchedCompanyId: matchedCompany?.id ?? null,
      matchedCompanyName: matchedCompany?.name ?? null,
      isDuplicate: Boolean(duplicate),
      duplicateContractId: duplicate?.id ?? null,
      matchedBaseContract: matchedBaseContract ?? null,
    };

    actionStatus = "success";
    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    aiLog.error("extractContractAction thất bại", {
      traceId,
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
    // Dọn tệp R2 tạm nếu request gặp lỗi / exception trước khi bước dọn dẹp thường lệ được gọi
    if (r2KeyToClean) {
      const key = r2KeyToClean;
      r2KeyToClean = null;
      cleanupR2(key);
    }
    // G2 v2: cleanup Gemini file tạm sau khi extract xong (dù thành công hay fail).
    // File Gemini có TTL 48h → xoá ngay để tránh tốn quota.
    if (geminiFileName && apiKey) {
      const fileToDelete = geminiFileName;
      geminiFileName = null;
      const cleanup = () => deleteGeminiFile(fileToDelete, apiKey, { traceId });
      try {
        after(cleanup);
      } catch {
        void cleanup();
      }
    }
    aiLog.info("Trích xuất hợp đồng kết thúc", {
      traceId,
      outcome: actionStatus,
      elapsedMs: Date.now() - actionStartTime,
      sizeBytes: inputSizeBytes,
      source,
      documentType: extractedData?.documentType ?? "unknown",
      hasContractNumber: Boolean(extractedData?.contractNumber),
      hasSignedDate: Boolean(extractedData?.signedDate),
      hasExpiryDate: Boolean(extractedData?.expiryDate),
      hasDurationText: Boolean(extractedData?.durationText),
      usedPdfText: preExtractedPdfTextLength !== null,
      pdfTextCharacters: pdfTextCharacters ?? undefined,
      usedFilesApi: Boolean(geminiFileUri),
    });
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
