import type { ServiceErrorCode, ServiceErr, ServiceIssue } from "@/lib/services/types";

/**
 * Danh mục mã lỗi định danh toàn hệ thống (Task #5).
 * Chuẩn hóa các câu thông báo tiếng Việt tập trung, phục vụ UX nhất quán,
 * debug dễ dàng và mở rộng logging/i18n trong tương lai.
 */

export const STATIC_ERROR_CATALOG = {
  // --- AUTH & PERMISSIONS ---
  AUTH_REQUIRED: {
    code: "unauthenticated" as ServiceErrorCode,
    message: "Bạn cần đăng nhập để thực hiện thao tác này",
  },
  AUTH_SESSION_EXPIRED: {
    code: "unauthenticated" as ServiceErrorCode,
    message: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
  },
  ACCOUNT_DISABLED: {
    code: "forbidden" as ServiceErrorCode,
    message: "Tài khoản đã bị vô hiệu hoá",
  },
  FORBIDDEN_ACTION: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không có quyền thực hiện thao tác này",
  },
  FORBIDDEN_ADMIN_ONLY: {
    code: "forbidden" as ServiceErrorCode,
    message: "Chỉ quản trị viên mới có quyền thực hiện thao tác này",
  },
  FORBIDDEN_DELETE_SELF: {
    code: "forbidden" as ServiceErrorCode,
    message: "Bạn không thể xoá chính mình",
  },
  FORBIDDEN_DEMOTE_LAST_ADMIN: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không thể hạ quyền quản trị viên cuối cùng của tổ chức",
  },
  FORBIDDEN_DEACTIVATE_LAST_ADMIN: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không thể vô hiệu hoá quản trị viên cuối cùng của tổ chức",
  },
  FORBIDDEN_DELETE_LAST_ADMIN: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không thể xoá quản trị viên cuối cùng của tổ chức",
  },
  FORBIDDEN_DELETE_PARTNER: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không có quyền xoá đối tác",
  },
  FORBIDDEN_DELETE_CONTRACT: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không có quyền xoá hợp đồng",
  },
  FORBIDDEN_UNARCHIVE_CONTRACT: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không có quyền bỏ lưu trữ hợp đồng",
  },
  FORBIDDEN_CROSS_ORG_USER: {
    code: "forbidden" as ServiceErrorCode,
    message: "Không thể xem người dùng của tổ chức khác",
  },
  FORBIDDEN_CROSS_ORG_CONTRACT: {
    code: "forbidden" as ServiceErrorCode,
    message: "Hợp đồng không thuộc tổ chức của bạn",
  },
  FORBIDDEN_CROSS_ORG_FILE: {
    code: "forbidden" as ServiceErrorCode,
    message: "Tệp không thuộc tổ chức của bạn",
  },
  FORBIDDEN_FILE_CONTRACT_MISMATCH: {
    code: "forbidden" as ServiceErrorCode,
    message: "Tệp không thuộc hợp đồng này",
  },
  FORBIDDEN_OBJECT_KEY_MISMATCH: {
    code: "forbidden" as ServiceErrorCode,
    message: "objectKey không khớp với hợp đồng",
  },

  // --- NOT FOUND ---
  NOT_FOUND_CONTRACT: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy hợp đồng",
  },
  NOT_FOUND_PARTNER: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy đối tác",
  },
  NOT_FOUND_COMPANY: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy công ty",
  },
  NOT_FOUND_USER: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy người dùng trong tổ chức",
  },
  NOT_FOUND_USER_EMAIL: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy email của người dùng",
  },
  NOT_FOUND_PROFILE: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy hồ sơ của bạn",
  },
  NOT_FOUND_ORGANIZATION: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy tổ chức",
  },
  NOT_FOUND_FILE: {
    code: "not_found" as ServiceErrorCode,
    message: "Không tìm thấy tệp tài liệu",
  },

  // --- VALIDATION ---
  VALIDATION_NO_CHANGES: {
    code: "validation" as ServiceErrorCode,
    message: "Không có thay đổi nào để lưu",
  },
  VALIDATION_PARTNER_REQUIRED: {
    code: "validation" as ServiceErrorCode,
    message: "Vui lòng chọn đối tác cho hợp đồng",
  },
  VALIDATION_COMPANY_REQUIRED: {
    code: "validation" as ServiceErrorCode,
    message: "Vui lòng chọn công ty cho hợp đồng",
  },
  VALIDATION_PARTNER_CROSS_ORG: {
    code: "validation" as ServiceErrorCode,
    message: "Đối tác được chọn không thuộc tổ chức của bạn",
  },
  VALIDATION_COMPANY_CROSS_ORG: {
    code: "validation" as ServiceErrorCode,
    message: "Công ty được chọn không thuộc tổ chức của bạn",
  },
  VALIDATION_EMAIL_CONFIRM_MISMATCH: {
    code: "validation" as ServiceErrorCode,
    message: "Email xác nhận không khớp với email người dùng",
  },
  VALIDATION_CONTRACT_NOT_ARCHIVED: {
    code: "validation" as ServiceErrorCode,
    message: "Hợp đồng chưa được lưu trữ nên không thể bỏ lưu trữ",
  },
  VALIDATION_INVALID_JSON: {
    code: "validation" as ServiceErrorCode,
    message: "Body phải là JSON hợp lệ",
  },
  VALIDATION_GENERIC: {
    code: "validation" as ServiceErrorCode,
    message: "Yêu cầu không hợp lệ",
  },
  VALIDATION_FILE_TOO_LARGE: {
    code: "validation" as ServiceErrorCode,
    message: "Dung lượng tệp vượt quá giới hạn cho phép",
  },
  VALIDATION_FILE_TYPE_UNSUPPORTED: {
    code: "validation" as ServiceErrorCode,
    message: "Định dạng tệp không được hỗ trợ",
  },

  // --- UPLOAD ---
  UPLOAD_INCOMPLETE: {
    code: "upload_incomplete" as ServiceErrorCode,
    message: "Chưa tải lên đủ các tệp yêu cầu",
  },

  // --- DATABASE & SYSTEM ---
  DB_ERROR: {
    code: "db_error" as ServiceErrorCode,
    message: "Không xử lý được yêu cầu. Vui lòng thử lại sau ít phút.",
  },
  DB_UNAVAILABLE: {
    code: "db_error" as ServiceErrorCode,
    message: "Hệ thống đang bận. Vui lòng thử lại sau giây lát.",
  },
  RATE_LIMIT_EXCEEDED: {
    code: "forbidden" as ServiceErrorCode,
    message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.",
  },
} as const;

export type StaticAppErrorCode = keyof typeof STATIC_ERROR_CATALOG;

/**
 * Các hàm tạo thông báo động theo tham số
 */
export const DYNAMIC_ERROR_BUILDERS = {
  VALIDATION_EMAIL_EXISTS: (email: string) => ({
    code: "validation" as ServiceErrorCode,
    message: `Email ${email} đã tồn tại trong hệ thống`,
  }),
  VALIDATION_PARTNER_HAS_CONTRACTS: (count: number) => ({
    code: "validation" as ServiceErrorCode,
    message: `Đối tác đang có ${count} hợp đồng, không thể xoá — hãy xoá hợp đồng trước`,
  }),
  VALIDATION_TAX_CODE_EXISTS: (taxCode: string) => ({
    code: "validation" as ServiceErrorCode,
    message: `Mã số thuế ${taxCode} đã tồn tại cho đối tác khác`,
  }),
  VALIDATION_BULK_DELETE_LIMIT: (limit: number) => ({
    code: "validation" as ServiceErrorCode,
    message: `Chỉ được xoá tối đa ${limit} mục mỗi lần`,
  }),
} as const;

export type DynamicAppErrorCode = keyof typeof DYNAMIC_ERROR_BUILDERS;
export type AppErrorCode = StaticAppErrorCode | DynamicAppErrorCode;

/**
 * Tra cứu thông báo lỗi tiếng Việt tĩnh
 */
export function getErrorMessage(appCode: StaticAppErrorCode): string {
  return STATIC_ERROR_CATALOG[appCode].message;
}

/**
 * Tạo đối tượng ServiceErr chuẩn hóa từ mã lỗi tĩnh
 */
export function catalogErr(
  appCode: StaticAppErrorCode,
  issues?: ServiceIssue[],
): ServiceErr {
  const item = STATIC_ERROR_CATALOG[appCode];
  return {
    ok: false,
    code: item.code,
    appCode,
    message: item.message,
    issues,
  };
}

/**
 * Tạo đối tượng ServiceErr chuẩn hóa từ mã lỗi động có tham số
 */
export function dynamicCatalogErr<K extends DynamicAppErrorCode>(
  appCode: K,
  buildFnArgs: Parameters<(typeof DYNAMIC_ERROR_BUILDERS)[K]>,
  issues?: ServiceIssue[],
): ServiceErr {
  const builder = DYNAMIC_ERROR_BUILDERS[appCode] as (
    ...args: unknown[]
  ) => { code: ServiceErrorCode; message: string };
  const item = builder(...(buildFnArgs as unknown[]));
  return {
    ok: false,
    code: item.code,
    appCode,
    message: item.message,
    issues,
  };
}
