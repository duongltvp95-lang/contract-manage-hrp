import "server-only";

import { ExtractedContractSchema, type ExtractedContract } from "@schemas/contract";
import {
  hasAppendixKeyword,
  MAX_AI_FILE_SIZE_BYTES,
  MAX_AI_FILE_SIZE_MB,
} from "@schemas/file";
import { err, ok, type ServiceResult } from "@/lib/services/types";
import { calculateExpiryDateFromDuration, normalizeDurationText } from "@/lib/ai/matching";
import { aiLog } from "@/lib/ai/log";

export function getGeminiModels(): string[] {
  const defaults = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
  ];

  const envModelsRaw = process.env.GEMINI_MODELS?.trim();
  if (envModelsRaw) {
    const parsed = Array.from(
      new Set(
        envModelsRaw
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
      ),
    );
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel) {
    return [envModel, ...defaults.filter((m) => m !== envModel)];
  }
  return defaults;
}

const MAX_MODEL_ATTEMPTS = 2;

export type AiInputMode = "pdf-text" | "files-api" | "inline-base64";

export type AiExtractionTelemetry = {
  inputMode: AiInputMode;
  modelUsed?: string;
  attemptCount: number;
  httpStatuses: number[];
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
};

export function computeModelAttemptTimeoutMs({
  remainingTimeMs,
  remainingModelsCount,
  isTextOnly,
}: {
  remainingTimeMs: number;
  remainingModelsCount: number;
  isTextOnly: boolean;
}): number {
  const safeAvailableMs = Math.max(4_000, remainingTimeMs - 1_500);
  if (isTextOnly) {
    const textCapMs = remainingModelsCount > 1 ? 9_000 : 10_000;
    if (remainingModelsCount > 1 && remainingTimeMs >= 13_000) {
      return Math.min(textCapMs, Math.max(4_500, remainingTimeMs - 7_500));
    }
    return Math.min(textCapMs, safeAvailableMs);
  }

  const binaryCapMs = 18_000;
  if (remainingModelsCount > 1) {
    if (remainingTimeMs >= 18_000) {
      // Chừa tối thiểu ~10s (8s cho model dự phòng + 2s biên an toàn)
      return Math.min(binaryCapMs, Math.max(8_000, remainingTimeMs - 10_000));
    }
    if (remainingTimeMs >= 12_000) {
      return Math.max(5_000, Math.floor((remainingTimeMs - 2_000) / remainingModelsCount));
    }
  }
  return Math.min(binaryCapMs, safeAvailableMs);
}

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export { MAX_AI_FILE_SIZE_BYTES, MAX_AI_FILE_SIZE_MB };

const EXTRACTION_SYSTEM_PROMPT = `Bạn là trợ lý AI chuyên gia phân tích hợp đồng kinh tế và pháp lý tại Việt Nam.
Hãy đọc kỹ tài liệu (Hợp đồng chính hoặc Phụ lục hợp đồng) và trích xuất JSON chuẩn theo quy tắc bắt buộc sau:

1. PHÂN LOẠI TÀI LIỆU (documentType & firstPageTitle):
- Nhìn dòng tiêu đề chính ở nửa trên TRANG ĐẦU TIÊN (trang 1):
  + Nếu có "PHỤ LỤC HỢP ĐỒNG", "PHỤ LỤC", "PHỤ LỤC SỐ...", "APPENDIX", "ADDENDUM", "VĂN BẢN SỬA ĐỔI BỔ SUNG", "THỎA THUẬN GIA HẠN", "THỎA THUẬN SỬA ĐỔI":
    * documentType = "appendix" (tuyệt đối không chọn "contract").
    * firstPageTitle = tiêu đề chính xác ở trang 1 (vd: "PHỤ LỤC HỢP ĐỒNG SỐ 01").
    * baseContractNumber = số hợp đồng gốc nêu ở phần căn cứ (vd: "Căn cứ Hợp đồng số 2024.03.01/HRVN - DONGYANG..." -> "2024.03.01/HRVN - DONGYANG"). Đây là số HỢP ĐỒNG GỐC, không phải số phụ lục.
    * appendixNumber = số thứ tự phụ lục nếu có (vd: "01", "02", không có thì "").
    * contractNumber = số riêng của phụ lục (vd: "PL-01"), nếu không có để "" hoặc "PL-" + appendixNumber.
    * summary = bắt đầu bằng "Phụ lục hợp đồng...".
  + Chỉ khi tiêu đề trang 1 là Hợp đồng chính ("HỢP ĐỒNG...", "CONTRACT", "AGREEMENT") và KHÔNG có chữ "PHỤ LỤC" ở trang 1:
    * documentType = "contract", baseContractNumber = "", appendixNumber = "".

2. NGÀY KÝ, NGÀY HẾT HẠN & THỜI HẠN:
- signedDate, expiryDate: định dạng "YYYY-MM-DD" (không có thì "").
- expiryDate: nếu không ghi ngày cụ thể nhưng có ngày ký/bắt đầu + thời hạn (vd ký 24/02/2024, thời hạn 1 năm -> "2025-02-24"; 6 tháng -> "2024-08-24"), BẮT BUỘC tự cộng để điền. Chỉ để "" khi vô thời hạn hoặc thiếu cả hai.
- durationText: chỉ ghi số tháng/năm (vd: "6 tháng", "1 năm", "2 năm", "Không xác định thời hạn", hoặc ""). Không ghi khoảng ngày "Từ ... đến ..."; nếu chỉ có ngày bắt đầu-kết thúc thì quy đổi ra số tháng/năm (12 tháng -> "1 năm", 24 tháng -> "2 năm", 36 tháng -> "3 năm", "01 năm" -> "1 năm").

3. CHỦ THỂ HỢP ĐỒNG:
- Hệ thống có 2 công ty nội bộ: "CÔNG TY TNHH HRP VIỆT NAM" (HRP) và "CÔNG TY TNHH HR PARTNER VIỆT NAM" (HR VN). Dù đứng Bên A hay Bên B, luôn điền công ty nội bộ vào companyName, TUYỆT ĐỐI không điền vào partnerName.
- partnerName, partnerTaxCode, partnerAddress: thông tin pháp nhân ĐỐI TÁC BÊN NGOÀI giao dịch với công ty nội bộ (thiếu trường nào để "").`;

const CONTRACT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    firstPageTitle: {
      type: "STRING",
      description: "Tiêu đề chính ở trang 1",
    },
    documentType: {
      type: "STRING",
      enum: ["contract", "appendix"],
      description: "'appendix' nếu trang 1 là Phụ lục/thỏa thuận sửa đổi gia hạn; 'contract' nếu là Hợp đồng chính",
    },
    baseContractNumber: {
      type: "STRING",
      description: "Số hợp đồng gốc được phụ lục tham chiếu ('' nếu là hợp đồng chính)",
    },
    appendixNumber: {
      type: "STRING",
      description: "Số thứ tự phụ lục (vd '01', '' nếu không có)",
    },
    contractNumber: {
      type: "STRING",
      description: "Số hợp đồng hoặc số phụ lục ('' nếu không có)",
    },
    signedDate: {
      type: "STRING",
      description: "Ngày ký YYYY-MM-DD ('' nếu không có)",
    },
    expiryDate: {
      type: "STRING",
      description: "Ngày hết hạn YYYY-MM-DD ('' nếu không có)",
    },
    durationText: {
      type: "STRING",
      description: "Thời hạn dạng số tháng/năm (vd '1 năm', '6 tháng')",
    },
    companyName: {
      type: "STRING",
      description: "Tên công ty nội bộ (HRP Việt Nam hoặc HR Partner Việt Nam)",
    },
    partnerName: {
      type: "STRING",
      description: "Tên pháp nhân đối tác bên ngoài",
    },
    partnerTaxCode: {
      type: "STRING",
      description: "Mã số thuế đối tác bên ngoài",
    },
    partnerAddress: {
      type: "STRING",
      description: "Địa chỉ trụ sở đối tác bên ngoài",
    },
    summary: {
      type: "STRING",
      description: "Tóm tắt nội dung chính trong 1-2 câu tiếng Việt",
    },
  },
  required: [
    "firstPageTitle",
    "documentType",
    "contractNumber",
    "signedDate",
    "expiryDate",
    "durationText",
    "companyName",
    "partnerName",
    "summary",
  ],
};

/**
 * Safely strips markdown code blocks and extracts JSON object substring.
 */
export function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

/**
 * Resolves accurate mime type using filename extension as fallback.
 */
export function resolveMimeType(filename: string, mimeType?: string): string {
  const cleanMime = mimeType?.toLowerCase().trim();
  if (cleanMime && ALLOWED_MIME_TYPES.has(cleanMime)) {
    return cleanMime;
  }
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return cleanMime || "application/octet-stream";
}

/**
 * Normalizes various date string formats (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY)
 * to standard ISO YYYY-MM-DD accepted by HTML date inputs and database date fields.
 */
export function normalizeDateToIso(dateStr?: string): string {
  if (!dateStr) return "";
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === trimmed
      ? trimmed
      : "";
  }
  const viMatch = trimmed.match(/ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i);
  if (viMatch) {
    const day = viMatch[1].padStart(2, "0");
    const month = viMatch[2].padStart(2, "0");
    const year = viMatch[3];
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate
      ? candidate
      : "";
  }
  const dmyMatch = trimmed.match(/^(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate
      ? candidate
      : "";
  }
  const ymdMatch = trimmed.match(/^(\d{4})[/\.-](\d{1,2})[/\.-](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate
      ? candidate
      : "";
  }
  return "";
}

/**
 * Phân tích đa lớp (AI + Heuristics + Filename + Text) để đảm bảo không bỏ sót Phụ lục hợp đồng.
 * Quy ước: Phụ lục hợp đồng sẽ có tiêu đề "PHỤ LỤC HỢP ĐỒNG" (hoặc "PHỤ LỤC") ở trang đầu tiên.
 */
export function detectAppendixMetadata({
  filename = "",
  pdfText = "",
  rawExtracted,
}: {
  filename?: string;
  pdfText?: string | null;
  rawExtracted: {
    firstPageTitle?: string;
    documentType?: string;
    contractNumber?: string;
    baseContractNumber?: string;
    appendixNumber?: string;
    summary?: string;
  };
}): {
  firstPageTitle: string;
  documentType: "contract" | "appendix";
  baseContractNumber: string;
  appendixNumber: string;
  contractNumber: string;
} {
  const normFilename = (filename || "").toLowerCase();
  const normSummary = (rawExtracted.summary || "").toLowerCase();
  const normDocType = (rawExtracted.documentType || "").toLowerCase();
  const normTitle = (rawExtracted.firstPageTitle || "").toLowerCase();
  const page1Text = (pdfText || "").slice(0, 800).toLowerCase();

  const explicitAppendixPatterns = [
    /(?:phu|phụ)[\s_\-]*(?:luc|lục)/i,
    /appendix/i,
    /addendum/i,
    /plhd/i,
  ];
  const filenameAppendixPatterns = [
    ...explicitAppendixPatterns,
    /(?:^|[^a-z0-9])pl(?:[-_\s]?\d+)?(?:[^a-z0-9]|$)/i,
  ];
  const amendmentTitlePatterns = [
    /(?:sua|sửa)[\s_\-]*(?:doi|đổi)/i,
    /(?:bo|bổ)[\s_\-]*sung/i,
    /gia[\s_\-]*(?:han|hạn)/i,
  ];

  const hasAppendixInTitle =
    explicitAppendixPatterns.some((pattern) => pattern.test(normTitle)) ||
    amendmentTitlePatterns.some((pattern) => pattern.test(normTitle));
  const page1Heading = page1Text.slice(0, 800);
  const hasAppendixOnPage1 = explicitAppendixPatterns.some((pattern) => pattern.test(page1Heading));
  const hasAppendixInFilename = filenameAppendixPatterns.some((pattern) => pattern.test(normFilename));
  const hasAppendixInSummary = /^(?:phu|phụ)[\s_\-]*(?:luc|lục)|^(?:appendix|addendum)\b/i.test(normSummary.trim());
  const isDocTypeAppendix = normDocType.includes("appendix") || normDocType.includes("phụ lục");
  const hasAppendixNumber = Boolean(rawExtracted.appendixNumber && rawExtracted.appendixNumber.trim().length > 0);
  const hasBaseContract = Boolean(rawExtracted.baseContractNumber && rawExtracted.baseContractNumber.trim().length > 0);

  const isAppendix =
    hasAppendixInTitle ||
    hasAppendixOnPage1 ||
    isDocTypeAppendix ||
    hasAppendixInFilename ||
    hasAppendixInSummary ||
    hasAppendixNumber ||
    hasBaseContract;

  if (!isAppendix) {
    return {
      firstPageTitle: rawExtracted.firstPageTitle || "",
      documentType: "contract",
      baseContractNumber: "",
      appendixNumber: "",
      contractNumber: rawExtracted.contractNumber || "",
    };
  }

  let baseContractNumber = (rawExtracted.baseContractNumber || "").trim();
  let appendixNumber = (rawExtracted.appendixNumber || "").trim();
  let contractNumber = (rawExtracted.contractNumber || "").trim();

  // 1. Trích xuất appendixNumber nếu chưa có
  if (!appendixNumber) {
    const appNumMatch =
      normTitle.match(
        /(?:phu|phụ)[\s_\-]*(?:luc|lục)(?:[\s_\-]*(?:hop|hợp)[\s_\-]*(?:dong|đồng))?[_\s\-]*(?:so|số)?[:\s_\-]*([0-9a-zA-Z]+)/i,
      ) ||
      normFilename.match(
        /(?:phu|phụ)[\s_\-]*(?:luc|lục)(?:[\s_\-]*(?:hop|hợp)[\s_\-]*(?:dong|đồng))?[_\s\-]*(?:so|số)?[:\s_\-]*([0-9a-zA-Z]+)/i,
      ) ||
      normFilename.match(/(?:pl|appendix)[_\s\-]*(?:so|số)?[_\s\-]*([0-9a-zA-Z]+)/i) ||
      page1Text.match(/(?:phụ\s*lục(?:\s*hợp\s*đồng)?|phu\s*luc)\s*(?:số|so)?\s*[:\s]*([0-9a-zA-Z\-_]+)/i);
    if (appNumMatch && appNumMatch[1]) {
      appendixNumber = appNumMatch[1].trim();
    }
  }

  // 2. Trích xuất baseContractNumber từ text PDF hoặc fallback từ contractNumber / filename
  if (!baseContractNumber) {
    const baseMatch = (pdfText || "").match(
      /(?:căn\s*cứ\s*(?:vào\s*)?hợp\s*đồng[^\n:]*[:\s]+|kèm\s*theo\s*hợp\s*đồng[^\n:]*[:\s]+|bộ\s*phận\s*không\s*tách\s*rời\s*của\s*hợp\s*đồng[^\n:]*[:\s]+|sửa\s*đổi[^\n:]*hợp\s*đồng[^\n:]*[:\s]+)([A-Za-z0-9_\-\.\/\s]{3,60}?)(?:[\n,;]|ký\s*ngày|giữa)/i,
    );
    if (baseMatch && baseMatch[1]) {
      baseContractNumber = baseMatch[1].trim();
    } else if (
      contractNumber &&
      !contractNumber.toLowerCase().includes("phụ lục") &&
      !contractNumber.toLowerCase().startsWith("pl")
    ) {
      baseContractNumber = contractNumber;
    } else {
      const filenameBaseMatch = normFilename.match(
        /(?:hd|hđ|hop[\s_\-]*dong|hợp[\s_\-]*đồng)[_\s\-:]*([0-9a-zA-Z\-_.\/]+)/i,
      );
      if (filenameBaseMatch && filenameBaseMatch[1]) {
        baseContractNumber = filenameBaseMatch[1].trim().replace(/\.pdf$/i, "");
      }
    }
  }

  // 3. Nếu contractNumber đang trùng với baseContractNumber mà có appendixNumber, định dạng lại số phụ lục
  if (contractNumber === baseContractNumber && appendixNumber) {
    contractNumber = `PL-${appendixNumber}`;
  } else if (!contractNumber && appendixNumber) {
    contractNumber = `PL-${appendixNumber}`;
  } else if (!contractNumber) {
    contractNumber = "Phụ lục";
  }

  return {
    firstPageTitle:
      rawExtracted.firstPageTitle ||
      (appendixNumber ? `Phụ lục hợp đồng số ${appendixNumber}` : "Phụ lục hợp đồng"),
    documentType: "appendix",
    baseContractNumber,
    appendixNumber,
    contractNumber,
  };
}

export function hasUsableExtractedContractData(extracted: ExtractedContract): boolean {
  if (extracted.documentType === "appendix") {
    return Boolean(
      extracted.appendixNumber.trim() ||
        extracted.baseContractNumber.trim() ||
        extracted.contractNumber.trim() ||
        extracted.signedDate.trim() ||
        extracted.expiryDate.trim() ||
        extracted.partnerName.trim() ||
        extracted.partnerTaxCode.trim() ||
        extracted.companyName.trim() ||
        extracted.summary.trim(),
    );
  }

  return Boolean(
    extracted.contractNumber.trim() ||
      extracted.signedDate.trim() ||
      extracted.expiryDate.trim() ||
      extracted.durationText.trim() ||
      extracted.partnerName.trim() ||
      extracted.partnerTaxCode.trim() ||
      extracted.companyName.trim() ||
      extracted.summary.trim(),
  );
}

function isNonProductionAiStubEnabled(): boolean {
  return (
    !process.env.VERCEL &&
    process.env.NODE_ENV !== "production" &&
    process.env.HRP_AI_TEST_MODE === "stub"
  );
}

function buildStubGeminiResponse(filename?: string): Response {
  const rawBase = (filename ?? "document.pdf").replace(/\.[^.]+$/, "");
  const safeStem = rawBase.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48) || "DOC";
  const isAppendix = hasAppendixKeyword(filename ?? "");

  const payload = isAppendix
    ? {
        firstPageTitle: "PHỤ LỤC HỢP ĐỒNG SỐ 01",
        documentType: "appendix",
        appendixNumber: "01",
        baseContractNumber: `STUB-BASE-${safeStem}`,
        contractNumber: "PL-01",
        signedDate: "2026-01-15",
        expiryDate: "2027-01-15",
        durationText: "12 tháng",
        partnerName: "Công ty TNHH Đối tác Kiểm thử",
        partnerTaxCode: "0101234567",
        partnerAddress: "Hà Nội",
        companyName: "HRP",
        summary: "Phụ lục trích xuất tự động (chế độ stub kiểm thử)",
      }
    : {
        firstPageTitle: "HỢP ĐỒNG DỊCH VỤ",
        documentType: "contract",
        contractNumber: `STUB-${safeStem}`,
        signedDate: "2026-01-15",
        expiryDate: "2027-01-15",
        durationText: "12 tháng",
        partnerName: "Công ty TNHH Đối tác Kiểm thử",
        partnerTaxCode: "0101234567",
        partnerAddress: "Hà Nội",
        companyName: "HRP",
        summary: "Hợp đồng trích xuất tự động (chế độ stub kiểm thử)",
      };

  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: JSON.stringify(payload) }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 80,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Extracts contract metadata and parties from a file buffer using Google Gemini.
 *
 * Hỗ trợ 2 luồng (G2 v2):
 * 1. `geminiFileName` + `geminiFileUri` (ưu tiên) — dùng `fileData`, body nhỏ.
 * 2. Buffer truyền thống — dùng `inlineData` base64 (fallback cho test/dev không có Files API).
 */
export async function extractContractFromBuffer({
  buffer,
  mimeType,
  filename = "",
  geminiFileName,
  geminiFileUri,
  pdfText,
  pdfTextAttempted,
  remainingBudgetMs = 32_000,
  traceId,
  onTelemetry,
}: {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  /** Optional: tên file đã upload lên Gemini Files API (vd "files/abc123") */
  geminiFileName?: string;
  /** Optional: URI của file đã upload (dùng trong fileData.fileUri) */
  geminiFileUri?: string;
  /** Optional: Lớp văn bản PDF đã được trích xuất trước để bỏ qua Gemini Files API */
  pdfText?: string;
  /** Optional: Đánh dấu caller đã thử parse PDF text rồi, không lặp lại parse cục bộ */
  pdfTextAttempted?: boolean;
  /** Ngân sách thời gian tối đa còn lại cho bước extract (ms) */
  remainingBudgetMs?: number;
  /** Correlates stage logs for one extraction without logging contract content. */
  traceId?: string;
  /** Callback nhận thông số đo lường model/token/attempt (không chứa nội dung hợp đồng). */
  onTelemetry?: (telemetry: AiExtractionTelemetry) => void;
}): Promise<ServiceResult<ExtractedContract>> {
  const extractStartTime = Date.now();
  const extractDeadline = extractStartTime + remainingBudgetMs;

  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    (isNonProductionAiStubEnabled() ? "e2e-stub-gemini-key" : "");
  if (!apiKey) {
    return err(
      "validation",
      "Chưa cấu hình GEMINI_API_KEY trên máy chủ (Vercel). Vui lòng thêm biến môi trường GEMINI_API_KEY vào Project Settings trên Vercel.",
    );
  }

  const resolvedMime = resolveMimeType(filename, mimeType);

  if (!ALLOWED_MIME_TYPES.has(resolvedMime)) {
    return err(
      "validation",
      `Định dạng tệp (${resolvedMime || "không rõ"}) chưa được hỗ trợ. AI chỉ hỗ trợ phân tích PDF hoặc hình ảnh (PNG, JPG, WebP).`,
    );
  }

  if (buffer.length > MAX_AI_FILE_SIZE_BYTES) {
    return err(
      "validation",
      `Dung lượng tệp vượt quá giới hạn ${MAX_AI_FILE_SIZE_MB} MB cho phép đối với phân tích AI.`,
    );
  }

  // Quyết định luồng xử lý:
  // - Nếu có pdfText hoặc trích xuất được text layer: dùng text, body vài KB, phản hồi trong 1-2s.
  // - Có geminiFileName/Uri (Files API) và không có text layer: dùng fileData.
  // - Còn lại: fallback base64 inlineData.
  const useFilesApi = Boolean(!pdfText && geminiFileName && geminiFileUri);

  let base64Data: string | null = null;
  let pdfTextForModel: string | null = pdfText ?? null;
  let extractedPdfText: string | null = pdfText ?? null;

  if (resolvedMime === "application/pdf" && !useFilesApi && !pdfTextForModel && !pdfTextAttempted) {
    const pdfStartTime = Date.now();
    try {
      // Giới hạn parse cục bộ để tiết kiệm ngân sách
      const remainingBeforePdf = extractDeadline - Date.now() - 6_000;
      if (remainingBeforePdf >= 2_000) {
        const {
          extractPdfText,
          isUsableContractPdfText,
          PDF_TEXT_MAX_CHARACTERS,
          PDF_TEXT_MAX_PAGES,
        } = await import("@/lib/ai/pdf-text");
        const pdfTimeout = Math.min(2_500, remainingBeforePdf);
        const pdfResult = await extractPdfText(
          buffer,
          pdfTimeout,
          { maxPages: PDF_TEXT_MAX_PAGES, maxCharacters: PDF_TEXT_MAX_CHARACTERS },
        );
        if (
          pdfResult &&
          isUsableContractPdfText(pdfResult.text, {
            isTruncated: pdfResult.isTruncated,
            pageCharCounts: pdfResult.pageCharCounts,
          })
        ) {
          extractedPdfText = pdfResult.text;
          pdfTextForModel = pdfResult.text;
          aiLog.info("Đọc lớp văn bản PDF hoàn tất", {
            traceId,
            elapsedMs: Date.now() - pdfStartTime,
            sizeBytes: buffer.length,
            pageCount: pdfResult.pageCount,
            textCharacters: pdfResult.text.length,
            isTruncated: Boolean(pdfResult.isTruncated),
            usedFilesApi: false,
          });
        } else {
          aiLog.info("PDF không có lớp văn bản dùng được", {
            traceId,
            elapsedMs: Date.now() - pdfStartTime,
            sizeBytes: buffer.length,
            pageCount: pdfResult?.pageCount,
            isTruncated: Boolean(pdfResult?.isTruncated),
            usedFilesApi: false,
          });
        }
      } else {
        aiLog.warn("Bỏ qua đọc lớp văn bản PDF do hết ngân sách", {
          traceId,
          elapsedMs: Date.now() - pdfStartTime,
          usedFilesApi: false,
        });
      }
    } catch (error) {
      // PDF.js lỗi → fallback xuống luồng base64
      aiLog.warn("Đọc lớp văn bản PDF thất bại, tiếp tục bằng tài liệu gốc", {
        traceId,
        elapsedMs: Date.now() - pdfStartTime,
        errorName: error instanceof Error ? error.name : "UnknownError",
        usedFilesApi: false,
      });
    }
  } else if (resolvedMime === "application/pdf" && useFilesApi) {
    aiLog.info("Bỏ qua PDF parser cục bộ vì tệp dùng Gemini Files API", {
      traceId,
      sizeBytes: buffer.length,
      usedFilesApi: true,
    });
  } else if (resolvedMime === "application/pdf" && pdfTextForModel) {
    aiLog.info("Bỏ qua PDF parser cục bộ vì đã có text trích xuất", {
      traceId,
      sizeBytes: buffer.length,
      textCharacters: pdfTextForModel.length,
      usedFilesApi: false,
    });
  } else if (resolvedMime === "application/pdf" && pdfTextAttempted) {
    aiLog.info("Bỏ qua PDF parser lặp vì caller đã thử đọc trước đó", {
      traceId,
      sizeBytes: buffer.length,
      usedFilesApi: false,
    });
  }

  if (!useFilesApi && !pdfTextForModel) {
    base64Data = buffer.toString("base64");
  }

  const inputMode: AiInputMode = pdfTextForModel
    ? "pdf-text"
    : useFilesApi
      ? "files-api"
      : "inline-base64";
  const telemetry: AiExtractionTelemetry = {
    inputMode,
    attemptCount: 0,
    httpStatuses: [],
  };

  let lastError = "Không thể kết nối tới dịch vụ AI Google Gemini.";

  // Thử tối đa các models trong danh sách nếu ngân sách thời gian thực tế vẫn còn đủ
  const models = getGeminiModels().slice(0, MAX_MODEL_ATTEMPTS);

  try {
    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const model = models[modelIndex];
      const remainingTime = extractDeadline - Date.now();

      // Nếu thời gian còn lại dưới 5 giây, dừng ngay để không vượt quá giới hạn 60s của Vercel
      if (remainingTime < 5_000) {
        aiLog.warn("Hết ngân sách thời gian trích xuất AI, dừng fallback", {
          traceId,
          model,
          elapsedSoFar: Date.now() - extractStartTime,
          remainingBudgetMs,
        });
        lastError = "Quá thời gian thực thi cho phép. Vui lòng bấm trích xuất lại hoặc sử dụng tệp tài liệu ngắn hơn.";
        break;
      }

      const remainingModelsCount = models.length - modelIndex;
      const modelTimeoutMs = computeModelAttemptTimeoutMs({
        remainingTimeMs: remainingTime,
        remainingModelsCount,
        isTextOnly: Boolean(pdfTextForModel),
      });
      const startTime = Date.now();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const filenameHint = filename ? `Tên tệp đính kèm: "${filename}"\n\n` : "";

      // Build parts dựa trên luồng đã chọn.
      const parts: Array<Record<string, unknown>> = [];

      if (useFilesApi) {
        // Files API: chỉ cần fileData + prompt. Body vài KB.
        parts.push({
          fileData: {
            mimeType: resolvedMime,
            fileUri: geminiFileUri,
          },
        });
        parts.push({ text: `${filenameHint}${EXTRACTION_SYSTEM_PROMPT}` });
      } else if (pdfTextForModel) {
        // PDF có text layer: gửi văn bản thuần kèm system prompt đầy đủ.
        parts.push({
          text: `${filenameHint}Đây là nội dung văn bản được trích xuất từ tài liệu PDF:\n\n${pdfTextForModel}\n\n---\nYêu cầu trích xuất thông tin từ nội dung trên:`,
        });
        parts.push({ text: EXTRACTION_SYSTEM_PROMPT });
      } else {
        // Fallback: gửi base64 (ảnh hoặc PDF scan).
        parts.push({
          inlineData: {
            mimeType: resolvedMime,
            data: base64Data!,
          },
        });
        parts.push({ text: `${filenameHint}${EXTRACTION_SYSTEM_PROMPT}` });
      }

      const requestBody = {
        contents: [{ parts }],
        generationConfig: {
          // Giữ mức 2.048 token để không bao giờ bị cắt JSON khi tên/địa chỉ song ngữ dài.
          maxOutputTokens: 2_048,
          responseMimeType: "application/json",
          responseSchema: CONTRACT_RESPONSE_SCHEMA,
        },
      };

      telemetry.attemptCount += 1;
      telemetry.modelUsed = model;

      try {
        aiLog.info("Đang trích xuất với model", {
          traceId,
          model,
          attempt: telemetry.attemptCount,
          inputMode,
          useFilesApi,
          modelTimeoutMs,
          elapsedMs: Date.now() - startTime,
        });
        const response = isNonProductionAiStubEnabled()
          ? buildStubGeminiResponse(filename)
          : await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify(requestBody),
              signal: AbortSignal.timeout(modelTimeoutMs),
            });
        telemetry.httpStatuses.push(response.status);

        if (response.ok) {
          const result = (await response.json()) as {
            candidates?: Array<{
              finishReason?: string;
              content?: {
                parts?: Array<{ text?: string }>;
              };
            }>;
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              thoughtsTokenCount?: number;
            };
          };

          const finishReason = result.candidates?.[0]?.finishReason;
          telemetry.finishReason = finishReason;
          telemetry.inputTokens = result.usageMetadata?.promptTokenCount;
          telemetry.outputTokens = result.usageMetadata?.candidatesTokenCount;
          telemetry.thoughtTokens = result.usageMetadata?.thoughtsTokenCount;

          if (finishReason === "MAX_TOKENS") {
            lastError =
              "Phản hồi AI bị cắt ngang do vượt giới hạn độ dài đầu ra (MAX_TOKENS). Vui lòng bấm trích xuất lại.";
            aiLog.warn("Model dừng do chạm giới hạn token (MAX_TOKENS), chuyển fallback", {
              traceId,
              model,
              attempt: telemetry.attemptCount,
              finishReason,
              elapsedMs: Date.now() - startTime,
            });
            continue;
          }

          if (finishReason && finishReason !== "STOP") {
            lastError = `Mô hình AI kết thúc sớm (${finishReason}) trước khi hoàn tất JSON hợp đồng.`;
            aiLog.warn("Model kết thúc bất thường, chuyển fallback", {
              traceId,
              model,
              attempt: telemetry.attemptCount,
              finishReason,
              elapsedMs: Date.now() - startTime,
            });
            continue;
          }

          const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) {
            lastError = "Mô hình AI trả về nội dung rỗng.";
            aiLog.warn("Model trả về nội dung rỗng", {
              traceId,
              model,
              attempt: telemetry.attemptCount,
              finishReason,
              elapsedMs: Date.now() - startTime,
            });
            continue;
          }

          try {
            const cleanedText = cleanJsonText(rawText);
            const parsedJson = (JSON.parse(cleanedText) ?? {}) as Record<string, unknown>;

            const signedIso = normalizeDateToIso(String(parsedJson.signedDate ?? ""));
            let expiryIso = normalizeDateToIso(String(parsedJson.expiryDate ?? ""));
            const normalizedDuration = normalizeDurationText({
              durationText: String(parsedJson.durationText ?? "").trim(),
              signedDate: signedIso,
              expiryDate: expiryIso,
            });

            // Tự động tính ngày hết hạn nếu chưa có nhưng đã có ngày ký và thời hạn
            if (!expiryIso && signedIso && normalizedDuration) {
              expiryIso = calculateExpiryDateFromDuration(signedIso, normalizedDuration);
            }

            const docTypeRaw = String(parsedJson.documentType ?? "contract").toLowerCase();
            const docTypeCandidate =
              docTypeRaw.includes("appendix") || docTypeRaw.includes("phụ lục")
                ? ("appendix" as const)
                : ("contract" as const);

            // Tinh chỉnh và chuẩn hóa phân loại Hợp đồng / Phụ lục qua bộ lọc đa lớp (AI + Heuristic + Filename + Text)
            const classification = detectAppendixMetadata({
              filename,
              pdfText: extractedPdfText || pdfTextForModel,
              rawExtracted: {
                firstPageTitle: String(parsedJson.firstPageTitle ?? "").trim(),
                documentType: docTypeCandidate,
                contractNumber: String(parsedJson.contractNumber ?? "").trim(),
                baseContractNumber: String(parsedJson.baseContractNumber ?? "").trim(),
                appendixNumber: String(parsedJson.appendixNumber ?? "").trim(),
                summary: String(parsedJson.summary ?? "").trim(),
              },
            });

            const extracted: ExtractedContract = {
              firstPageTitle: classification.firstPageTitle,
              documentType: classification.documentType,
              baseContractNumber: classification.baseContractNumber,
              appendixNumber: classification.appendixNumber,
              contractNumber: classification.contractNumber,
              signedDate: signedIso,
              expiryDate: expiryIso,
              durationText: normalizedDuration,
              partnerName: String(parsedJson.partnerName ?? "").trim(),
              partnerTaxCode: String(parsedJson.partnerTaxCode ?? "").trim(),
              partnerAddress: String(parsedJson.partnerAddress ?? "").trim(),
              companyName: String(parsedJson.companyName ?? "").trim(),
              summary: String(parsedJson.summary ?? "").trim(),
            };

            const validated = ExtractedContractSchema.safeParse(extracted);
            if (!validated.success) {
              throw new Error("Dữ liệu trích xuất không khớp schema hợp đồng");
            }

            if (!hasUsableExtractedContractData(validated.data)) {
              lastError =
                "AI không nhận diện được thông tin hợp đồng nào từ tài liệu này. Vui lòng kiểm tra chất lượng bản scan hoặc nhập thủ công.";
              aiLog.warn("Model trả về JSON hợp lệ nhưng rỗng về mặt nghiệp vụ", {
                traceId,
                model,
                attempt: telemetry.attemptCount,
                finishReason,
                elapsedMs: Date.now() - startTime,
              });
              continue;
            }

            aiLog.info("Trích xuất thành công", {
              traceId,
              model,
              attempt: telemetry.attemptCount,
              inputMode,
              elapsedMs: Date.now() - startTime,
              useFilesApi,
              finishReason,
              inputTokens: telemetry.inputTokens,
              outputTokens: telemetry.outputTokens,
              thoughtTokens: telemetry.thoughtTokens,
            });
            return ok(validated.data);
          } catch (parseErr) {
            lastError = "Phản hồi JSON từ mô hình AI bị lỗi định dạng hoặc không hợp lệ.";
            aiLog.error("Parse JSON thất bại", {
              traceId,
              model,
              attempt: telemetry.attemptCount,
              finishReason,
              rawTextLength: rawText.length,
              errorMessage: String(parseErr),
            });
            continue;
          }
        }

        const errorPayload = (await response.json().catch(() => null)) as {
          error?: { message?: string; status?: string };
        } | null;

        lastError = errorPayload?.error?.message ?? `Lỗi HTTP ${response.status} từ Gemini API`;

        // If the model is 503 (high demand) or 404 (model unavailable) or 429, continue to next fallback model
        if (response.status === 404 || response.status === 429 || response.status >= 500) {
          aiLog.warn("Model gặp lỗi HTTP, chuyển fallback", {
            traceId,
            model,
            attempt: telemetry.attemptCount,
            statusCode: response.status,
            lastError,
            elapsedMs: Date.now() - startTime,
          });
          continue;
        }

        // Other client error (e.g. 400 or 401)
        return err("validation", `AI lỗi (${response.status}): ${lastError}`);
      } catch (networkError) {
        telemetry.httpStatuses.push(0);
        const isTimeout =
          networkError instanceof Error &&
          (networkError.name === "TimeoutError" || networkError.message.includes("timeout"));
        lastError = isTimeout
          ? `Quá thời gian chờ phản hồi (${Math.round(modelTimeoutMs / 1000)}s) từ model ${model}`
          : networkError instanceof Error
            ? networkError.message
            : "Lỗi kết nối mạng";
        aiLog.warn("Model gặp lỗi mạng, chuyển fallback", {
          traceId,
          model,
          attempt: telemetry.attemptCount,
          lastError,
          elapsedMs: Date.now() - startTime,
        });
      }
    }

    const friendlyError = lastError.toLowerCase().includes("high demand")
      ? "Hệ thống Google Gemini hiện đang quá tải truy vấn tạm thời. Bạn vui lòng bấm nút trích xuất lại sau vài giây."
      : lastError;

    return err("validation", `Trích xuất AI thất bại: ${friendlyError}`);
  } finally {
    onTelemetry?.(telemetry);
  }
}
