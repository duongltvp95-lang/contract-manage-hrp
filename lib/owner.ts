/**
 * Protected system owner definition.
 *
 * `duongltvp95@gmail.com` is the system Owner account.
 * By business requirement: NO ONE (including other admins and the owner themselves)
 * is permitted to edit this account's role, deactivate it, or delete it.
 */

export const OWNER_EMAIL = "duongltvp95@gmail.com";
export const OWNER_USER_ID = "495eb514-82d9-4969-a610-760947a0a79d";

export function isOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === OWNER_EMAIL.toLowerCase();
}

export function isOwnerUserId(userId?: string | null): boolean {
  if (!userId) return false;
  return userId.trim().toLowerCase() === OWNER_USER_ID.toLowerCase();
}
