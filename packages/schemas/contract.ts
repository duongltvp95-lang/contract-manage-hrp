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

/**
 * An optional partner link (feature round 2).
 *
 * `""` is accepted and means "no partner", the same convention every other
 * optional field here uses: an untouched `<select>` submits an empty string, and
 * the service normalises it to SQL NULL. A non-empty value must be a UUID, so a
 * crafted payload cannot smuggle a filter fragment into a PostgREST query.
 *
 * The organization that owns the partner is NOT checked here — that is the
 * service's job, because it is the layer that knows the caller's session.
 */
const optionalPartnerId = z
  .string()
  .optional()
  .refine(
    (value) => !value || z.guid().safeParse(value).success,
    "Đối tác được chọn không hợp lệ",
  );

/**
 * An optional company link (round 33).
 *
 * Exactly the same convention as `optionalPartnerId`: `""` is accepted and means
 * "not chosen" (the service normalises it to SQL NULL), and a non-empty value
 * must be a UUID so a crafted payload cannot smuggle a filter fragment into a
 * PostgREST query.
 *
 * There is deliberately NO "required" rule here. The owner decision is that the
 * company is mandatory when CREATING a contract but optional when editing an old
 * one — and those are two different rules at two different layers. Encoding
 * "required on create" here would also break editing: `UpdateContractSchema` is
 * the same object, so a contract created before round 33 (whose `companyId` is
 * `""`) could never be saved again. `createContract` is the layer that enforces
 * it, because that is the layer an API caller cannot bypass.
 */
const optionalCompanyId = z
  .string()
  .optional()
  .refine(
    (value) => !value || z.guid().safeParse(value).success,
    "Công ty được chọn không hợp lệ",
  );

/** Plan section 45 — the fields of the Add Contract form. */
export const CreateContractSchema = z.object({
  contractNumber: optionalText(100, "Số hợp đồng"),
  signedDate: optionalDate("Ngày ký"),
  durationText: optionalText(200, "Thời hạn"),
  expiryDate: optionalDate("Ngày hết hạn"),
  partnerText: optionalText(300, "Đối tác"),
  partnerId: optionalPartnerId,
  /** Round 33 — company this contract is signed for (HRP / HR VN). */
  companyId: optionalCompanyId,
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

export interface ContractDateConfirmationWarning {
  type: "no_expiry" | "same_day" | "expiry_before_signed";
  title: string;
  message: string;
}

/**
 * Checks for date conditions that require warning and user confirmation before saving:
 * 1. Missing expiry date (contract is open-ended or AI couldn't detect it).
 * 2. Signed date equals expiry date (0-day duration).
 * 3. Expiry date precedes signed date.
 */
export function getContractDateConfirmationWarnings(input: {
  signedDate?: string | null;
  expiryDate?: string | null;
}): ContractDateConfirmationWarning[] {
  const warnings: ContractDateConfirmationWarning[] = [];
  const signed = input.signedDate?.trim();
  const expiry = input.expiryDate?.trim();

  // 1. Không có ngày hết hạn
  if (!expiry) {
    warnings.push({
      type: "no_expiry",
      title: "Hợp đồng chưa có ngày hết hạn",
      message:
        "Hợp đồng không có ngày hết hạn (hệ thống sẽ lưu dưới dạng không xác định thời hạn).",
    });
  }

  // 2. Ngày ký trùng với ngày hết hạn
  if (
    signed &&
    expiry &&
    DATE_ONLY_RE.test(signed) &&
    DATE_ONLY_RE.test(expiry) &&
    signed === expiry
  ) {
    warnings.push({
      type: "same_day",
      title: "Ngày ký trùng với ngày hết hạn",
      message: `Ngày ký và ngày hết hạn của hợp đồng đang trùng nhau (${signed}). Thời hạn hiệu lực là 0 ngày.`,
    });
  }

  // 3. Ngày hết hạn sớm hơn ngày ký
  if (
    signed &&
    expiry &&
    DATE_ONLY_RE.test(signed) &&
    DATE_ONLY_RE.test(expiry) &&
    expiry < signed
  ) {
    warnings.push({
      type: "expiry_before_signed",
      title: "Ngày hết hạn trước ngày ký",
      message: `Ngày hết hạn (${expiry}) đang sớm hơn ngày ký (${signed}).`,
    });
  }

  return warnings;
}

/**
 * Schema for AI-extracted contract information (from PDF or images).
 */
export const ExtractedContractSchema = z.object({
  contractNumber: z.string().optional().default(""),
  signedDate: z.string().optional().default(""),
  expiryDate: z.string().optional().default(""),
  durationText: z.string().optional().default(""),
  partnerName: z.string().optional().default(""),
  partnerTaxCode: z.string().optional().default(""),
  partnerAddress: z.string().optional().default(""),
  companyName: z.string().optional().default(""),
  summary: z.string().optional().default(""),
  // Document classification & appendix metadata
  firstPageTitle: z.string().optional().default(""),
  documentType: z.enum(["contract", "appendix"]).optional().default("contract"),
  baseContractNumber: z.string().optional().default(""),
  appendixNumber: z.string().optional().default(""),
});

export type ExtractedContract = z.infer<typeof ExtractedContractSchema>;

export type MatchedBaseContract = {
  id: string;
  contractNumber: string;
  partnerName?: string | null;
  signedDate?: string | null;
  expiryDate?: string | null;
};

export type ExtractedContractResult = ExtractedContract & {
  matchedPartnerId?: string | null;
  matchedCompanyId?: string | null;
  matchedPartnerName?: string | null;
  matchedCompanyName?: string | null;
  isDuplicate?: boolean;
  duplicateContractId?: string | null;
  matchedBaseContract?: MatchedBaseContract | null;
};

/** Schema for manual contract renewal */
export const RenewContractSchema = z.object({
  contractId: z.string().uuid("ID hợp đồng không hợp lệ"),
  newExpiryDate: z
    .string()
    .refine((value) => Boolean(value) && isRealCalendarDate(value), "Ngày hết hạn mới phải theo định dạng YYYY-MM-DD và là ngày hợp lệ"),
  newDurationText: optionalText(200, "Thời hạn"),
  notes: optionalText(5000, "Ghi chú"),
});

export type RenewContractInput = z.infer<typeof RenewContractSchema>;
