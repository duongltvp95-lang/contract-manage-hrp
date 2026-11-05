/**
 * Các hằng số và bộ kiểm định chất lượng văn bản PDF dùng chung cho cả Server và Browser.
 *
 * KHÔNG import `server-only` hoặc `pdfjs-dist` tại đây để có thể dùng an toàn ở cả
 * `lib/ai/pdf-text.ts` (Node server) và `lib/ai/pdf-text-client.ts` (trình duyệt).
 */

export type PdfTextResult = {
  text: string;
  pageCount: number;
  isTruncated?: boolean;
  /** Độ dài văn bản (sau trim) trên từng trang đã đọc (1..pagesRead). */
  pageCharCounts?: number[];
};

export type PdfTextLimits = {
  maxPages?: number;
  maxCharacters?: number;
};

export const MIN_PDF_TEXT_LENGTH = 50; // < 50 ký tự coi như scan
export const PDF_TEXT_MAX_PAGES = 30;
export const PDF_TEXT_MAX_CHARACTERS = 50_000;
export const MIN_FIRST_PAGE_CHARS = 80;
export const MIN_ANY_PAGE_CHARS = 30;

export interface UsableTextOptions {
  isTruncated?: boolean;
  pageCharCounts?: number[];
}

/**
 * Kiểm tra xem lớp văn bản trích xuất từ PDF có đủ chất lượng và nội dung pháp lý
 * để thay thế việc gửi hình ảnh/file gốc lên Gemini không.
 * Nếu text bị cắt ngắn (isTruncated), có trang scan trộn lẫn (pageCharCounts có trang rỗng),
 * quá ngắn (< 250 ký tự), OCR nhiễu/rác, hoặc thiếu các cấu trúc pháp lý cơ bản
 * (tiêu đề, các bên, điều khoản), trả về false để hệ thống gửi tệp gốc cho Gemini
 * nhận diện thị giác/file đầy đủ.
 */
export function isUsableContractPdfText(
  text: string | null | undefined,
  options?: UsableTextOptions,
): boolean {
  if (options?.isTruncated) {
    // Tài liệu vượt quá ngưỡng trang/ký tự an toàn (30 trang / 50.000 ký tự):
    // gửi file gốc lên Gemini để xử lý toàn bộ các trang, tránh mất điều khoản/chữ ký cuối.
    return false;
  }
  if (options?.pageCharCounts && options.pageCharCounts.length > 0) {
    // Bảo vệ PDF lai (trộn trang Word + trang scan):
    // - Trang 1 phải đủ văn bản để nhận diện tiêu đề (Hợp đồng vs Phụ lục) & số hiệu.
    // - Mọi trang trong phạm vi đọc phải có lớp chữ tối thiểu; nếu bất kỳ trang nào
    //   gần như rỗng (< 30 ký tự, vd trang bìa/trang ký đóng dấu scan hoặc watermark),
    //   chuyển sang gửi toàn bộ PDF gốc để Gemini đọc thị giác đầy đủ.
    if (options.pageCharCounts[0] < MIN_FIRST_PAGE_CHARS) {
      return false;
    }
    if (options.pageCharCounts.some((count) => count < MIN_ANY_PAGE_CHARS)) {
      return false;
    }
  }
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 250) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 25) return false;

  // Lọc nhiễu OCR: tỷ lệ ký tự chữ và số so với tổng ký tự không khoảng trắng >= 65%
  const cleanAlphaNum = trimmed.replace(/[^\p{L}\p{N}]/gu, "").length;
  const nonWhitespace = trimmed.replace(/\s+/g, "").length;
  if (nonWhitespace === 0 || cleanAlphaNum / nonWhitespace < 0.65) {
    return false;
  }

  // Lọc chuỗi dính liền bất thường (OCR hỏng khoảng trắng)
  const abnormalLongWords = words.filter((w) => w.length > 35).length;
  if (abnormalLongWords > 0 && abnormalLongWords / words.length > 0.05) {
    return false;
  }

  // Yêu cầu tối thiểu 2 trong 3 nhóm dấu hiệu cấu trúc pháp lý hợp đồng:
  // 1. Tiêu đề / bản chất văn bản
  const hasTitle = /(?:h[ợo]p\s*đ[ồo]ng|ph[ụu]\s*l[ụu]c|tho[ảa]\s*thu[ậa]n|contract|agreement|addendum|annex)/i.test(trimmed);
  // 2. Chủ thể tham gia / đại diện / quốc hiệu
  const hasParties = /(?:b[êe]n\s*[ab]|c[ộo]ng\s*h[òo]a\s*x[ãa]\s*h[ộo]i|đ[ộo]c\s*l[ậa]p\s*-\s*t[ựu]\s*do|đ[ạa]i\s*di[ệe]n|công\s*ty|party\s*[ab]|company)/i.test(trimmed);
  // 3. Điều khoản / giá trị / thanh toán / chữ ký
  const hasTerms = /(?:đi[ềe]u\s*\d+|đi[ềe]u\s*kho[ảa]n|quy[ềe]n\s*v[àa]\s*ngh[iĩ]a\s*v[ụu]|gi[áa]\s*tr[ịi]|thanh\s*to[áa]n|hi[ệe]u\s*l[ựu]c|ch[ữu]\s*k[ýy]|article\s*\d+|terms\s*(?:and|&)\s*conditions)/i.test(trimmed);

  const matchedGroups = (hasTitle ? 1 : 0) + (hasParties ? 1 : 0) + (hasTerms ? 1 : 0);
  return matchedGroups >= 2;
}
