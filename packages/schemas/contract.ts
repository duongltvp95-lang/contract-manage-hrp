import { z } from "zod";

/**
 * Shared contract schemas — plan sections 14, 31, 74.
 *
 * Used by the form (client) and the service layer (server) so both sides apply
 * identical rules. Dates travel as `YYYY-MM-DD` strings and land in PostgreSQL
 * `date` columns (plan sections 19, 45).
 *
 * Every field is optional. An untouched form input arrives as `""`, which is
 * accepted here and normalised to SQL `NULL` by the service layer — the schema
 * deliberately does not use `z.preprocess`, so its input and output types stay
 * identical and React Hook Form can infer them without casts.
 *
 * No `organizationId` field on purpose: the organization always comes from the
 * session on the server, never from the client.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects 2026-02-30 and friends, which `Date` would silently roll over. */
export function isRealCalendarDate(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} tối đa ${max} ký tự`).optional();

const optionalDate = (label: string) =>
  z
    .string()
    .optional()
    .refine(
      (value) => !value || isRealCalendarDate(value),
      `${label} phải theo định dạng YYYY-MM-DD và là ngày hợp lệ`,
    );

/** Plan section 45 — the fields of the Add Contract form. */
export const CreateContractSchema = z.object({
  contractNumber: optionalText(100, "Số hợp đồng"),
  signedDate: optionalDate("Ngày ký"),
  durationText: optionalText(200, "Thời hạn"),
  expiryDate: optionalDate("Ngày hết hạn"),
  partnerText: optionalText(300, "Đối tác"),
  notes: optionalText(5000, "Ghi chú"),
});

/** Plan section 65 — same shape; the edit flow (M6) reuses it. */
export const UpdateContractSchema = CreateContractSchema;

export type CreateContractInput = z.infer<typeof CreateContractSchema>;
export type UpdateContractInput = z.infer<typeof UpdateContractSchema>;

/** `""` and whitespace become SQL NULL; a real value is trimmed. */
export function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Non-blocking business warning — plan section 47: an expiry date earlier than
 * the signed date is surfaced to the user but must NOT prevent saving.
 */
export function getContractWarnings(input: {
  signedDate?: string | null;
  expiryDate?: string | null;
}): string[] {
  const warnings: string[] = [];
  const { signedDate, expiryDate } = input;

  if (
    signedDate &&
    expiryDate &&
    DATE_ONLY_RE.test(signedDate) &&
    DATE_ONLY_RE.test(expiryDate) &&
    expiryDate < signedDate
  ) {
    warnings.push(
      "Ngày hết hạn đang sớm hơn ngày ký. Vui lòng kiểm tra lại trước khi lưu.",
    );
  }

  return warnings;
}
