import "server-only";

import { type ExtractedContract } from "@schemas/contract";
import { MAX_AI_FILE_SIZE_BYTES, MAX_AI_FILE_SIZE_MB } from "@schemas/file";
import { err, ok, type ServiceResult } from "@/lib/services/types";
import { calculateExpiryDateFromDuration, normalizeDurationText } from "@/lib/ai/matching";
import { aiLog } from "@/lib/ai/log";

export function getGeminiModels(): string[] {
  const envModel = process.env.GEMINI_MODEL?.trim();
  const defaults = [
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
  ];
  if (envModel) {
    return [envModel, ...defaults.filter((m) => m !== envModel)];
  }
  return defaults;
}

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export { MAX_AI_FILE_SIZE_BYTES, MAX_AI_FILE_SIZE_MB };

const EXTRACTION_SYSTEM_PROMPT = `Bạn là trợ lý AI chuyên gia phân tích hợp đồng kinh tế và pháp lý tại Việt Nam.
Hãy đọc kỹ tài liệu đính kèm (có thể là văn bản Hợp đồng chính hoặc Phụ lục hợp đồng) và trích xuất các thông tin sau thành JSON cấu trúc chuẩn:

QUY TẮC BẮT BUỘC ĐỂ PHÂN LOẠI HỢP ĐỒNG VÀ PHỤ LỤC (CỰC KỲ QUAN TRỌNG):
1. PHỤ LỤC HỢP ĐỒNG (documentType = "appendix"):
- Dấu hiệu nhận biết:
  + Tiêu đề văn bản ghi: "PHỤ LỤC", "PHỤ LỤC HỢP ĐỒNG", "PHỤ LỤC SỐ...", "VĂN BẢN SỬA ĐỔI BỔ SUNG", "THỎA THUẬN GIA HẠN", "THỎA THUẬN SỬA ĐỔI", "APPENDIX", "ADDENDUM", "AMENDMENT"...
  + Hoặc tên tệp đính kèm có chứa các từ khóa: "phu luc", "phụ lục", "pl", "plhd", "appendix", "addendum"...
  + Hoặc nội dung có các điều khoản dẫn chiếu căn cứ hợp đồng: "Căn cứ Hợp đồng số...", "Căn cứ Hợp đồng kinh tế số...", "Phụ lục này là bộ phận không thể tách rời của Hợp đồng số...", "Hai bên đồng ý sửa đổi, bổ sung Điều... của Hợp đồng số...".
- KHI LÀ PHỤ LỤC:
  + "documentType": BẮT BUỘC chọn "appendix". TUYỆT ĐỐI KHÔNG ĐƯỢC CHỌN "contract" dù trong nội dung có xuất hiện nhiều lần từ "Hợp đồng"!
  + "baseContractNumber": BẮT BUỘC trích xuất chính xác Số hợp đồng gốc được nhắc đến trong phần căn cứ (ví dụ: "Căn cứ Hợp đồng số 2024.03.01/HRVN - DONGYANG..." -> điền "2024.03.01/HRVN - DONGYANG"). Nếu là hợp đồng chính thì để trống "".
  + "appendixNumber": Số thứ tự của phụ lục nếu có (ví dụ: "01", "02", "1", "PL-01", để trống "" nếu không ghi rõ).
  + "contractNumber": Số của phụ lục nếu có số riêng (ví dụ "PL-01/2024"); nếu không có số riêng thì điền số của hợp đồng gốc.

2. HỢP ĐỒNG CHÍNH (documentType = "contract"):
- Tiêu đề là "HỢP ĐỒNG", "HỢP ĐỒNG KINH TẾ", "HỢP ĐỒNG DỊCH VỤ", "HỢP ĐỒNG NGUYÊN TẮC", "HỢP ĐỒNG MUA BÁN", "CONTRACT", "AGREEMENT"... và KHÔNG PHẢI là phụ lục.
- Đặt documentType = "contract", baseContractNumber = "", appendixNumber = "".

CÁC TRƯỜNG THÔNG TIN KHÁC:
- signedDate: Ngày ký tài liệu theo định dạng chuẩn "YYYY-MM-DD" (ví dụ: "2026-03-15", để trống "" nếu không tìm thấy)
- expiryDate: Ngày hết hạn theo định dạng chuẩn "YYYY-MM-DD" (ví dụ: "2027-03-15").
  QUY TẮC BẮT BUỘC VỀ NGÀY HẾT HẠN:
  + Nếu tài liệu ghi rõ ngày hết hạn cụ thể, hãy điền ngày đó.
  + Nếu tài liệu KHÔNG ghi ngày hết hạn cụ thể nhưng có ngày ký/bắt đầu và thời hạn (ví dụ: ngày ký 24/02/2024, thời hạn 1 năm), bạn PHẢI tự tính toán ngày hết hạn tương ứng để điền vào đây (ví dụ: 2024-02-24 + 1 năm -> "2025-02-24", hoặc 6 tháng -> "2024-08-24"). TUYỆT ĐỐI không để trống nếu đã có ngày ký và thời hạn!
  + Chỉ để trống "" nếu tài liệu không có cả ngày hết hạn lẫn thời hạn, hoặc ghi "Không xác định thời hạn".
- durationText: Thời hạn hiệu lực ghi dạng khoảng thời gian như số tháng hoặc số năm (ví dụ: "6 tháng", "1 năm", "2 năm", "3 năm", "Không xác định thời hạn", để trống "" nếu không có).
  QUY TẮC BẮT BUỘC VỀ THỜI HẠN:
  + TUYỆT ĐỐI KHÔNG ghi dạng khoảng ngày "Từ ngày ... đến ngày ..." hay ngày tháng cụ thể vào trường này.
  + Nếu tài liệu chỉ ghi khoảng ngày bắt đầu và kết thúc (ví dụ: từ ngày 20/12/2025 đến ngày 20/12/2026), bạn PHẢI tự tính toán và quy đổi ra số tháng hoặc số năm tương ứng (ví dụ: tròn 12 tháng -> "1 năm", 24 tháng -> "2 năm", 6 tháng -> "6 tháng").
  + Chuẩn hóa cách ghi: 12 tháng -> "1 năm", 24 tháng -> "2 năm", 36 tháng -> "3 năm", "01 năm" -> "1 năm", "02 năm" -> "2 năm".
- companyName: Tên công ty nội bộ của chúng tôi (dù tài liệu ghi là Bên A hay Bên B).
  QUY TẮC QUAN TRỌNG: Chúng tôi có 2 công ty nội bộ trên hệ thống:
  1) "CÔNG TY TNHH HRP VIỆT NAM" (quy ước viết tắt là HRP)
  2) "CÔNG TY TNHH HR PARTNER VIỆT NAM" (quy ước viết tắt là HR VN)
  Bất kể tài liệu ghi công ty của chúng tôi là Bên A hay Bên B, hãy điền tên công ty của chúng tôi vào "companyName". TUYỆT ĐỐI KHÔNG ĐIỀN VÀO "partnerName"!
- partnerName: Tên công ty/pháp nhân ĐỐI TÁC BÊN NGOÀI (bên còn lại giao dịch với công ty của chúng tôi, dù là Bên A hay Bên B). TUYỆT ĐỐI KHÔNG điền HRP, HRP Việt Nam, HR VN hay HR Partner Việt Nam vào đây.
- partnerTaxCode: Mã số thuế của ĐỐI TÁC BÊN NGOÀI nếu có (chuỗi số, ví dụ: "0101234567", để trống "" nếu không có)
- partnerAddress: Địa chỉ trụ sở của ĐỐI TÁC BÊN NGOÀI nếu có (để trống "" nếu không có)
- summary: Tóm tắt ngắn gọn nội dung và phạm vi của văn bản trong 1-2 câu tiếng Việt.

Chỉ trả về JSON hợp lệ khớp với cấu trúc trên.`;

const CONTRACT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    documentType: {
      type: "STRING",
      enum: ["contract", "appendix"],
      description: "Phân loại tài liệu: 'appendix' (Phụ lục hợp đồng) hoặc 'contract' (Hợp đồng chính)",
    },
    baseContractNumber: {
      type: "STRING",
      description: "Số hợp đồng gốc mà phụ lục tham chiếu tới, để trống '' nếu là hợp đồng chính",
    },
    appendixNumber: {
      type: "STRING",
      description: "Số thứ tự phụ lục nếu có (vd '01', '02'), để trống '' nếu không có",
    },
    contractNumber: {
      type: "STRING",
      description: "Số hợp đồng hoặc số phụ lục, để trống '' nếu không có",
    },
    signedDate: {
      type: "STRING",
      description: "Ngày ký hợp đồng YYYY-MM-DD, để trống '' nếu không tìm thấy",
    },
    expiryDate: {
      type: "STRING",
      description: "Ngày hết hạn hợp đồng YYYY-MM-DD, để trống '' nếu không có",
    },
    durationText: {
      type: "STRING",
      description: "Thời hạn hiệu lực ghi dạng số tháng hoặc số năm (vd '1 năm', '6 tháng')",
    },
    companyName: {
      type: "STRING",
      description: "Tên công ty nội bộ: 'CÔNG TY TNHH HRP VIỆT NAM' hoặc 'CÔNG TY TNHH HR PARTNER VIỆT NAM'",
    },
    partnerName: {
      type: "STRING",
      description: "Tên công ty đối tác bên ngoài",
    },
    partnerTaxCode: {
      type: "STRING",
      description: "Mã số thuế của đối tác bên ngoài",
    },
    partnerAddress: {
      type: "STRING",
      description: "Địa chỉ của đối tác bên ngoài",
    },
    summary: {
      type: "STRING",
      description: "Tóm tắt ngắn gọn nội dung và phạm vi tài liệu trong 1-2 câu",
    },
  },
  required: [
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
 */
export function detectAppendixMetadata({
  filename = "",
  pdfText = "",
  rawExtracted,
}: {
  filename?: string;
  pdfText?: string | null;
  rawExtracted: {
    documentType?: string;
    contractNumber?: string;
    baseContractNumber?: string;
    appendixNumber?: string;
    summary?: string;
  };
}): {
  documentType: "contract" | "appendix";
  baseContractNumber: string;
  appendixNumber: string;
  contractNumber: string;
} {
  const normFilename = (filename || "").toLowerCase();
  const normSummary = (rawExtracted.summary || "").toLowerCase();
  const normDocType = (rawExtracted.documentType || "").toLowerCase();
  const textSample = (pdfText || "").slice(0, 4000).toLowerCase();

  const appendixPatterns = [
    /(?:phu|phụ)[\s_\-]*(?:luc|lục)/i,
    /appendix/i,
    /addendum/i,
    /plhd/i,
    /\bpl\b/i,
    /pl[\-_0-9]/i,
    /(?:sua|sửa)[\s_\-]*(?:doi|đổi)/i,
    /(?:bo|bổ)[\s_\-]*sung/i,
    /(?:gia|gia)[\s_\-]*(?:han|hạn)/i,
  ];

  const hasAppendixInFilename = appendixPatterns.some((p) => p.test(normFilename));
  const hasAppendixInSummary = appendixPatterns.some((p) => p.test(normSummary));
  const hasAppendixInText = appendixPatterns.some((p) => p.test(textSample));
  const isDocTypeAppendix = normDocType.includes("appendix") || normDocType.includes("phụ lục");
  const hasAppendixNumber = Boolean(rawExtracted.appendixNumber && rawExtracted.appendixNumber.trim().length > 0);
  const hasBaseContract = Boolean(rawExtracted.baseContractNumber && rawExtracted.baseContractNumber.trim().length > 0);

  const isAppendix =
    isDocTypeAppendix ||
    hasAppendixInFilename ||
    hasAppendixInSummary ||
    hasAppendixInText ||
    hasAppendixNumber ||
    hasBaseContract;

  if (!isAppendix) {
    return {
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
      normFilename.match(/(?:phu|phụ)[\s_\-]*(?:luc|lục)[_\s\-]*(?:so|số)?[_\s\-]*([0-9a-zA-Z]+)/i) ||
      normFilename.match(/(?:pl|appendix)[_\s\-]*(?:so|số)?[_\s\-]*([0-9a-zA-Z]+)/i) ||
      textSample.match(/(?:phụ\s*lục(?:\s*hợp\s*đồng)?|phu\s*luc)\s*(?:số|so)?\s*[:\s]*([0-9a-zA-Z\-_]+)/i);
    if (appNumMatch && appNumMatch[1]) {
      appendixNumber = appNumMatch[1].trim();
    }
  }

  // 2. Trích xuất baseContractNumber từ text PDF hoặc fallback từ contractNumber / filename
  if (!baseContractNumber) {
    const baseMatch = (pdfText || "").match(
      /(?:căn\s*cứ\s*hợp\s*đồng[^\n:]*[:\s]+|kèm\s*theo\s*hợp\s*đồng[^\n:]*[:\s]+|bộ\s*phận\s*không\s*tách\s*rời\s*của\s*hợp\s*đồng[^\n:]*[:\s]+)([A-Za-z0-9_\-\.\/\s]{3,60}?)(?:[\n,;]|ký\s*ngày|giữa)/i,
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
  }

  return {
    documentType: "appendix",
    baseContractNumber,
    appendixNumber,
    contractNumber,
  };
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
  remainingBudgetMs = 32_000,
}: {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  /** Optional: tên file đã upload lên Gemini Files API (vd "files/abc123") */
  geminiFileName?: string;
  /** Optional: URI của file đã upload (dùng trong fileData.fileUri) */
  geminiFileUri?: string;
  /** Ngân sách thời gian tối đa còn lại cho bước extract (ms) */
  remainingBudgetMs?: number;
}): Promise<ServiceResult<ExtractedContract>> {
  const extractStartTime = Date.now();
  const extractDeadline = extractStartTime + remainingBudgetMs;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
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
  // - Có geminiFileName/Uri (G2 v2 — Files API) → dùng fileData, body vài KB.
  // - Không có → thử trích text từ PDF (BUG-1 sửa); nếu fail → fallback base64.
  const useFilesApi = Boolean(geminiFileName && geminiFileUri);

  let base64Data: string | null = null;
  let pdfTextForModel: string | null = null;

  if (!useFilesApi && resolvedMime === "application/pdf") {
    try {
      // Dành tối thiểu 6s cho bước gọi model Gemini phía sau
      const remainingBeforePdf = extractDeadline - Date.now() - 6_000;
      if (remainingBeforePdf >= 2_000) {
        const { extractPdfText } = await import("@/lib/ai/pdf-text");
        const pdfTimeout = Math.min(8_000, remainingBeforePdf);
        const pdfResult = await extractPdfText(buffer, pdfTimeout);
        if (pdfResult) {
          pdfTextForModel = pdfResult.text;
        }
      }
    } catch {
      // PDF.js lỗi → fallback xuống luồng base64
    }
  }

  if (!useFilesApi && !pdfTextForModel) {
    base64Data = buffer.toString("base64");
  }

  let lastError = "Không thể kết nối tới dịch vụ AI Google Gemini.";

  // Thử tối đa các models trong danh sách nếu ngân sách thời gian thực tế vẫn còn đủ
  const models = getGeminiModels().slice(0, 3);

  for (const model of models) {
    const remainingTime = extractDeadline - Date.now();

    // Nếu thời gian còn lại dưới 6 giây, dừng ngay để không vượt quá giới hạn 60s của Vercel
    if (remainingTime < 6_000) {
      aiLog.warn("Hết ngân sách thời gian trích xuất AI, dừng fallback", {
        model,
        elapsedSoFar: Date.now() - extractStartTime,
        remainingBudgetMs,
      });
      lastError = "Quá thời gian thực thi cho phép. Vui lòng bấm trích xuất lại hoặc sử dụng tệp tài liệu ngắn hơn.";
      break;
    }

    const modelTimeoutMs = Math.min(15_000, remainingTime);
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
        responseMimeType: "application/json",
        responseSchema: CONTRACT_RESPONSE_SCHEMA,
      },
    };

    try {
      aiLog.info("Đang trích xuất với model", {
        model,
        useFilesApi,
        modelTimeoutMs,
        elapsedMs: Date.now() - startTime,
      });
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(modelTimeoutMs),
      });

      if (response.ok) {
        const result = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };

        const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          aiLog.warn("Model trả về nội dung rỗng", {
            model,
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
            pdfText: pdfTextForModel,
            rawExtracted: {
              documentType: docTypeCandidate,
              contractNumber: String(parsedJson.contractNumber ?? "").trim(),
              baseContractNumber: String(parsedJson.baseContractNumber ?? "").trim(),
              appendixNumber: String(parsedJson.appendixNumber ?? "").trim(),
              summary: String(parsedJson.summary ?? "").trim(),
            },
          });

          const extracted: ExtractedContract = {
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

          aiLog.info("Trích xuất thành công", {
            model,
            elapsedMs: Date.now() - startTime,
            useFilesApi,
          });
          return ok(extracted);
        } catch (parseErr) {
          aiLog.error("Parse JSON thất bại", {
            model,
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
      if (response.status === 503 || response.status === 404 || response.status === 429) {
        aiLog.warn("Model gặp lỗi HTTP, chuyển fallback", {
          model,
          statusCode: response.status,
          lastError,
          elapsedMs: Date.now() - startTime,
        });
        continue;
      }

      // Other client error (e.g. 400 or 401)
      return err("validation", `AI lỗi (${response.status}): ${lastError}`);
    } catch (networkError) {
      const isTimeout =
        networkError instanceof Error &&
        (networkError.name === "TimeoutError" || networkError.message.includes("timeout"));
      lastError = isTimeout
        ? `Quá thời gian chờ phản hồi (${Math.round(modelTimeoutMs / 1000)}s) từ model ${model}`
        : networkError instanceof Error
          ? networkError.message
          : "Lỗi kết nối mạng";
      aiLog.warn("Model gặp lỗi mạng, chuyển fallback", {
        model,
        lastError,
        elapsedMs: Date.now() - startTime,
      });
    }
  }

  const friendlyError = lastError.toLowerCase().includes("high demand")
    ? "Hệ thống Google Gemini hiện đang quá tải truy vấn tạm thời. Bạn vui lòng bấm nút trích xuất lại sau vài giây."
    : lastError;

  return err("validation", `Trích xuất AI thất bại: ${friendlyError}`);
}
