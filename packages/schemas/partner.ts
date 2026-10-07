import { z } from "zod";

/**
 * Partner schemas — feature round 2, part 1 + part 3.
 *
 * Shared by the form (client) and the service layer (server) so both sides apply
 * identical rules, exactly like `contract.ts`. The name is trimmed before the
 * length rules are applied, which is why a value of only spaces is rejected
 * rather than stored as " ".
 *
 * Round 2 part 3 adds two OPTIONAL fields per the Owner decision (T6):
 *   * `address`  — a free-form postal address, up to 500 characters;
 *   * `taxCode`  — a tax / registration code, up to 14 characters, with the
 *                  Vietnamese shape enforced when a value is entered.
 *
 * The two fields are optional because existing partners (created in round 2
 * part 1) must stay usable without forcing a back-fill. The form treats them
 * the same way (optional inputs), so what the user sees matches what the
 * server accepts.
 *
 * No `organizationId` field on purpose: the organization always comes from the
 * session on the server, never from the client.
 */

/** The one required field a partner has. 1-200 characters after trimming. */
export const partnerNameField = z
  .string()
  .trim()
  .min(1, "Tên đối tác không được để trống")
  .max(200, "Tên đối tác tối đa 200 ký tự");

/**
 * Free-form postal address. Optional; up to 500 characters. Whitespace is
 * trimmed at the boundary so a value of only spaces is treated as "empty"
 * rather than stored verbatim. Empty after trimming is allowed because the
 * field is optional.
 */
export const partnerAddressField = z
  .string()
  .trim()
  .max(500, "Địa chỉ tối đa 500 ký tự")
  .optional()
  .or(z.literal(""));

/**
 * Vietnamese tax / registration code. Optional; up to 14 characters:
 * 10 digits for the main entity, with an optional `-NNN` suffix for a branch
 * (the longest legit input is therefore 14 chars). The form does not allow
 * other shapes; non-VN partners stay possible by leaving the field blank and
 * carrying the code in `address` or the contract notes.
 *
 * Empty after trimming is allowed; the `or(z.literal(""))` accepts an
 * explicit empty string without forcing the caller to omit the key.
 */
export const partnerTaxCodeField = z
  .string()
  .trim()
  .regex(
    /^\d{10}(-\d{3})?$/,
    "Mã số thuế phải gồm 10 chữ số (thêm -NNN cho mã chi nhánh)",
  )
  .max(14, "Mã số thuế tối đa 14 ký tự")
  .optional()
  .or(z.literal(""));

/**
 * Collaboration status — round 10. `active` = đang hợp tác (default),
 * `stopped` = đã dừng hợp tác. A stopped partner stays in the directory and on
 * its contracts but is hidden from the new-contract combobox.
 */
export const PARTNER_STATUSES = ["active", "stopped"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  active: "Đang hợp tác",
  stopped: "Đã dừng hợp tác",
};

export const partnerStatusField = z.enum(PARTNER_STATUSES).optional();

/**
 * At least one company (HRP / HR VN) must be chosen; both are allowed.
 * `companyIds` are uuids — the service verifies they belong to the caller's
 * organization.
 */
export const partnerCompanyIdsField = z
  .array(z.string().uuid())
  .min(1, "Chọn ít nhất một công ty");

/**
 * Plan: one required field, two optional fields, plus status + companies.
 *
 * `status` is optional here and defaults to `active` at the service layer
 * (a `.default()` would change the schema's input/output types and break
 * react-hook-form's resolver inference).
 */
export const PartnerSchema = z.object({
  name: partnerNameField,
  address: partnerAddressField,
  taxCode: partnerTaxCodeField,
  status: partnerStatusField,
  companyIds: partnerCompanyIdsField,
});

/**
 * Update accepts a partial payload; the service writes only the keys the caller
 * actually sent, so an omitted field is left alone rather than cleared.
 */
export const UpdatePartnerSchema = z.object({
  name: partnerNameField.optional(),
  address: partnerAddressField,
  taxCode: partnerTaxCodeField,
  status: z.enum(PARTNER_STATUSES).optional(),
  companyIds: z
    .array(z.string().uuid())
    .min(1, "Chọn ít nhất một công ty")
    .optional(),
});

export type CreatePartnerInput = z.infer<typeof PartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof UpdatePartnerSchema>;