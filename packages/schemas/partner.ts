import { z } from "zod";

/**
 * Partner schemas — feature round 2, part 1.
 *
 * Shared by the form (client) and the service layer (server) so both sides apply
 * identical rules, exactly like `contract.ts`. The name is trimmed before the
 * length rules are applied, which is why a value of only spaces is rejected
 * rather than stored as " ".
 *
 * No `organizationId` field on purpose: the organization always comes from the
 * session on the server, never from the client.
 */

/** The one field a partner has. 1-200 characters after trimming. */
export const partnerNameField = z
  .string()
  .trim()
  .min(1, "Tên đối tác không được để trống")
  .max(200, "Tên đối tác tối đa 200 ký tự");

/** Plan: one required field. */
export const PartnerSchema = z.object({
  name: partnerNameField,
});

/**
 * Update accepts a partial payload; the service writes only the keys the caller
 * actually sent, so an omitted field is left alone rather than cleared.
 */
export const UpdatePartnerSchema = z.object({
  name: partnerNameField.optional(),
});

export type CreatePartnerInput = z.infer<typeof PartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof UpdatePartnerSchema>;
