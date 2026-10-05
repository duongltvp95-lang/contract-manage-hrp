import { randomBytes } from "node:crypto";

/**
 * Temporary password for a newly provisioned user (feature round 2, part 3).
 *
 * Server-side only by construction: it uses `node:crypto`, and the module is
 * imported exclusively by the server-only user service.
 *
 * The value is shown to the administrator exactly once and never stored — the
 * account's real password is whatever the user sets through
 * `/auth/update-password`. `randomBytes` (CSPRNG) rather than `Math.random`,
 * because this is a live credential for a real account.
 *
 * Shape: 24 base64url characters from 18 random bytes, plus a fixed suffix that
 * guarantees at least one lower-case letter, one upper-case letter, one digit
 * and one symbol. That mix survives any password policy the project turns on
 * later without this function having to be revisited.
 */
export function generateTemporaryPassword(): string {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}
