/**
 * Shared configuration for the integration suite.
 *
 * Kept out of `global-setup.ts` because Vitest runs global setup in a separate
 * module graph; a test cannot import a value from it.
 */

export const TEST_PORT = Number(process.env.TEST_PORT ?? 3100);

export const BASE_URL = process.env.TEST_BASE_URL ?? `http://localhost:${TEST_PORT}`;

/** The organization seeded by the M2 migration. */
export const ORG_A = "11111111-1111-1111-1111-111111111111";

/** A second tenant, created and destroyed by the suite. */
export const ORG_B = "22222222-2222-2222-2222-222222222222";

/** Marks every row this suite creates, so cleanup can never miss one. */
export const TEST_PREFIX = "W1TEST-";
