import "server-only";

/**
 * Delete permissions — round 19.
 *
 * Hard-deleting contracts and partners is an owner-only capability. The allowed
 * emails come from `DELETE_ADMIN_EMAILS` (comma-separated, trimmed, lowercased);
 * when the variable is missing or empty the fallback is the owner's email.
 *
 * Server-only by design: this list is a policy input, not something a client
 * should be able to read.
 */

const DEFAULT_DELETE_ADMINS = ["duongltvp95@gmail.com"];

function readDeleteAdminEmails(): string[] {
  const raw = process.env.DELETE_ADMIN_EMAILS;
  if (!raw) return DEFAULT_DELETE_ADMINS;

  const list = raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return list.length > 0 ? list : DEFAULT_DELETE_ADMINS;
}

export function canDeleteEntities(userEmail: string | null | undefined): boolean {
  if (!userEmail) return false;
  return readDeleteAdminEmails().includes(userEmail.trim().toLowerCase());
}

/** Round 24 — hard cap for one bulk-delete call. */
export const BULK_DELETE_LIMIT = 100;
